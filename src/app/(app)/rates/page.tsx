import type { Metadata } from "next";
import { dateLabel, num } from "@/lib/format";
import { loadRates, today } from "@/lib/services";
import { requireUser } from "@/lib/session";
import type { RateRow } from "@/lib/costing";
import { RateForm } from "./RateForm";

export const metadata: Metadata = { title: "Rate masters" };
export const dynamic = "force-dynamic";

const GROUPS: { kind: RateRow["kind"]; title: string; note: string }[] = [
  { kind: "material", title: "Materials", note: "Rupees per kg. A -SCRAP row is the recovery value of scrap." },
  { kind: "work_centre", title: "Machine hour rates", note: "Rupees per machine hour." },
  { kind: "param", title: "Commercial parameters", note: "Overhead, freight, GST, lot size, tooling life and the approval limit." },
];

export default async function Rates() {
  const user = await requireUser();
  const [rates, now] = await Promise.all([loadRates(), today()]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Rate masters</h1>
          <p className="sub">
            One source of rates. A change never edits the old row, it adds a new one from a start date, so every saved
            quote keeps the rates it was priced with.
          </p>
        </div>
      </div>

      <div className="two-col">
        <div className="stack">
          {GROUPS.map((g) => {
            const codes = [...new Set(rates.filter((r) => r.kind === g.kind).map((r) => r.code))].sort();
            return (
              <div className="card scroll" key={g.kind}>
                <div className="card-head">
                  <h2>{g.title}</h2>
                  <span className="small muted">{g.note}</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Description</th>
                      <th className="num">Current</th>
                      <th>Since</th>
                      <th>Coming</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((code) => {
                      const rows = rates.filter((r) => r.kind === g.kind && r.code === code);
                      const current = rows.filter((r) => r.effective_from <= now).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
                      const upcoming = rows.filter((r) => r.effective_from > now).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
                      return (
                        <tr key={code}>
                          <td>
                            <strong>{code}</strong>
                          </td>
                          <td>{current?.label ?? rows[0].label}</td>
                          <td className="num">
                            {current ? (
                              <>
                                {num(current.value, 2)} <span className="muted small">{current.unit}</span>
                              </>
                            ) : (
                              <span className="muted">not started</span>
                            )}
                          </td>
                          <td>{current ? dateLabel(current.effective_from) : "—"}</td>
                          <td>
                            {upcoming ? (
                              <span className="badge warn">
                                {num(upcoming.value, 2)} from {dateLabel(upcoming.effective_from)}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        <div className="stack">
          {user.role === "sales_head" ? (
            <RateForm
              today={now}
              existing={[...new Map(rates.map((r) => [`${r.kind}:${r.code}`, r])).values()].map((r) => ({
                kind: r.kind,
                code: r.code,
                label: r.label,
                unit: r.unit,
              }))}
            />
          ) : (
            <div className="notice">Only the sales head can change rates. You can see every rate and when it starts.</div>
          )}
          <div className="card">
            <div className="card-head">
              <h2>Rate history</h2>
            </div>
            <div className="scroll" style={{ maxHeight: 360, overflowY: "auto" }}>
              <table>
                <tbody>
                  {[...rates]
                    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id)
                    .slice(0, 14)
                    .map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.code}
                          <div className="small muted">from {dateLabel(r.effective_from)}</div>
                        </td>
                        <td className="num">{num(r.value, 2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
