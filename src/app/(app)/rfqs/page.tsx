import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/Badge";
import { dateLabel, inrShort } from "@/lib/format";
import { listRfqs, type RfqRow } from "@/lib/services";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "RFQs" };
export const dynamic = "force-dynamic";

const FILTERS = [
  ["all", "All"],
  ["estimating", "Estimating"],
  ["pending_approval", "Awaiting approval"],
  ["approved", "Approved"],
  ["sent", "Sent"],
  ["won", "Won"],
  ["lost", "Lost"],
] as const;

function Due({ r }: { r: RfqRow }) {
  const open = ["estimating", "pending_approval", "approved"].includes(r.status);
  if (!open) return <span className="muted">{dateLabel(r.due_on)}</span>;
  const d = r.days_to_due;
  const tone = d < 0 ? "bad" : d <= 2 ? "warn" : "";
  const text = d < 0 ? `Overdue ${-d}d` : d === 0 ? "Due today" : `${d}d left`;
  return (
    <span>
      {dateLabel(r.due_on)} <span className={`badge ${tone}`}>{text}</span>
    </span>
  );
}

export default async function RfqRegister({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; mine?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = sp.status ?? "all";
  const q = (sp.q ?? "").slice(0, 80);
  const mine = sp.mine === "1";
  const [rows, everything] = await Promise.all([
    listRfqs({ status, q, mine: mine ? user.id : undefined }),
    listRfqs({}),
  ]);

  const open = everything.filter((r) => ["estimating", "pending_approval", "approved"].includes(r.status));
  const dueSoon = open.filter((r) => r.days_to_due <= 2).length;
  const waiting = everything.filter((r) => r.status === "pending_approval").length;

  const href = (s: string) => {
    const p = new URLSearchParams();
    if (s !== "all") p.set("status", s);
    if (q) p.set("q", q);
    if (mine) p.set("mine", "1");
    const qs = p.toString();
    return qs ? `/rfqs?${qs}` : "/rfqs";
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>RFQs</h1>
          <p className="sub">
            {open.length} open · {dueSoon} due within 2 days · {waiting} awaiting approval
          </p>
        </div>
        <Link className="btn primary" href="/rfqs/new">
          New RFQ
        </Link>
      </div>

      <div className="row">
        <nav className="row" aria-label="Filter by status" style={{ gap: 4 }}>
          {FILTERS.map(([key, label]) => (
            <Link
              key={key}
              href={href(key)}
              className={`btn sm ${status === key ? "primary" : ""}`}
              aria-current={status === key ? "true" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form className="row grow" style={{ justifyContent: "flex-end" }} role="search">
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <label className="row small muted" style={{ margin: 0, fontWeight: 400 }}>
            <input type="checkbox" name="mine" value="1" defaultChecked={mine} style={{ width: "auto" }} />
            Mine only
          </label>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search RFQ no, customer or part"
            aria-label="Search RFQs"
            style={{ maxWidth: 280 }}
          />
          <button className="btn">Search</button>
        </form>
      </div>

      <div className="card scroll">
        {rows.length === 0 ? (
          <div className="empty">
            <strong>No RFQs match</strong>
            {q || status !== "all" || mine ? (
              <Link href="/rfqs">Clear filters</Link>
            ) : (
              "Create one from an email or part list."
            )}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>RFQ</th>
                <th>Customer</th>
                <th className="num">Parts</th>
                <th>Owner</th>
                <th>Due</th>
                <th>Status</th>
                <th className="num">Annual value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="link">
                  <td>
                    <Link href={`/rfqs/${r.id}`}>
                      <strong>{r.rfq_no}</strong>
                    </Link>
                  </td>
                  <td>{r.customer}</td>
                  <td className="num">{r.part_count}</td>
                  <td>{r.owner_name ?? "Unassigned"}</td>
                  <td>
                    <Due r={r} />
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.status === "lost" && r.lost_reason ? (
                      <span className="small muted"> · {r.lost_reason}</span>
                    ) : null}
                  </td>
                  <td className="num">{r.quote_value ? inrShort(r.quote_value) : <span className="muted">Not quoted</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
