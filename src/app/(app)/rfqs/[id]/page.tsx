import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/Badge";
import { dateLabel, dateTimeLabel, inr, inrShort, num } from "@/lib/format";
import {
  approvalThreshold,
  costState,
  getActivity,
  getParts,
  getQuotes,
  getRfq,
  latestCostings,
  loadRates,
  type Quote,
} from "@/lib/services";
import { requireUser } from "@/lib/session";
import { AddPartForm } from "./AddPartForm";
import { DecideButtons, OutcomeButtons, SendButton, SubmitQuoteButton } from "./QuoteActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const rfq = await getRfq(Number((await params).id) || 0);
  return { title: rfq?.rfq_no ?? "RFQ" };
}

const ACTION_LABEL: Record<string, string> = {
  "rfq.created": "RFQ created",
  "part.added": "Part added",
  "part.updated": "Part inputs updated",
  "costing.saved": "Costing saved",
  "quote.submitted": "Quote submitted for approval",
  "quote.auto_approved": "Quote submitted, within estimator authority",
  "quote.approved": "Quote approved",
  "quote.rejected": "Quote sent back",
  "quote.sent": "Quote marked as sent",
  "rfq.won": "Marked won",
  "rfq.lost": "Marked lost",
};

export default async function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const rfq = await getRfq(id);
  if (!rfq) notFound();

  const [parts, quotes, activity, rates] = await Promise.all([getParts(id), getQuotes(id), getActivity(id), loadRates()]);
  const costings = await latestCostings(parts.map((p) => p.id));
  const threshold = await approvalThreshold();
  const materials = [...new Set(rates.filter((r) => r.kind === "material" && !r.code.endsWith("-SCRAP")).map((r) => r.code))];

  const states = parts.map((p) => ({ p, c: costings.get(p.id), s: costState(p, costings.get(p.id)) }));
  const allCosted = states.length > 0 && states.every((x) => x.s === "current");
  const total = states.reduce((sum, x) => sum + (x.s === "current" ? x.c!.result.annualValue : 0), 0);
  const needs = total > threshold;
  const live = quotes.find((q) => q.status !== "superseded" && q.status !== "rejected");
  const lastRejected = live ? undefined : quotes.find((q) => q.status === "rejected");
  const locked = ["pending_approval", "approved", "sent", "won", "lost"].includes(rfq.status);
  const problems = states
    .filter((x) => x.s !== "current")
    .map((x) => `${x.p.name}: ${x.s === "none" ? "not costed yet" : "inputs changed, save the costing again"}`);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="crumb">
            <Link href="/rfqs">RFQs</Link> / {rfq.rfq_no}
          </div>
          <h1>
            {rfq.rfq_no} <StatusBadge status={rfq.status} />
          </h1>
          <p className="sub">
            {rfq.customer} · due {dateLabel(rfq.due_on)} · owner {rfq.owner_name ?? "unassigned"}
            {rfq.status === "lost" && rfq.lost_reason ? ` · lost: ${rfq.lost_reason}` : ""}
          </p>
        </div>
      </div>

      <div className="two-col">
        <div className="stack">
          <div className="card scroll">
            <div className="card-head">
              <h2>Parts</h2>
              <span className="small muted">Prices ex-GST, at the annual volume</span>
            </div>
            {parts.length === 0 ? (
              <div className="empty">
                <strong>No parts yet</strong>Add one below.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Part</th>
                    <th>Material</th>
                    <th className="num">Gross kg</th>
                    <th className="num">Annual vol.</th>
                    <th>Costing</th>
                    <th className="num">Unit price</th>
                    <th className="num">Annual value</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {states.map(({ p, c, s }) => (
                    <tr key={p.id} className="link">
                      <td className="muted">{p.line_no}</td>
                      <td>
                        <Link href={`/rfqs/${id}/parts/${p.id}`}>
                          <strong>{p.name}</strong>
                        </Link>
                        {Object.values(p.sources).some((x) => !x.accepted) ? (
                          <div className="small" style={{ color: "var(--warn)" }}>
                            Has values waiting for your OK
                          </div>
                        ) : null}
                      </td>
                      <td>{p.material_code}</td>
                      <td className="num">{num(p.gross_wt_kg, 3)}</td>
                      <td className="num">{num(p.annual_volume)}</td>
                      <td>
                        {s === "current" ? (
                          <span className="badge ok">v{c!.version} saved</span>
                        ) : s === "stale" ? (
                          <span className="badge warn">Out of date</span>
                        ) : (
                          <span className="badge">Not costed</span>
                        )}
                      </td>
                      <td className="num">{s === "current" ? inr(c!.result.base.price) : "—"}</td>
                      <td className="num">{s === "current" ? inrShort(c!.result.annualValue) : "—"}</td>
                      <td className="num">
                        <Link className="btn sm" href={`/rfqs/${id}/parts/${p.id}`}>
                          {locked ? "View" : s === "current" ? "Open" : "Cost it"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!locked ? <AddPartForm rfqId={id} materials={materials} /> : null}

          {rfq.source_text ? (
            <details className="card">
              <summary className="card-head" style={{ cursor: "pointer", listStyle: "none" }}>
                <h2>Original RFQ email</h2>
                <span className="small muted">For reference</span>
              </summary>
              <pre className="card-body small" style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--mono)" }}>
                {rfq.source_text}
              </pre>
            </details>
          ) : null}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Quote</h2>
              {live ? <StatusBadge status={live.status} /> : null}
            </div>
            <div className="card-body stack" style={{ gap: 14 }}>
              <dl className="kv">
                <dt>Annual value</dt>
                <dd className="num">
                  <strong>{live ? inr(live.annual_value, 0) : allCosted ? inr(total, 0) : "—"}</strong>
                </dd>
                <dt>Approval</dt>
                <dd>
                  {live
                    ? live.needs_approval
                      ? "Sales head approval needed"
                      : "Within estimator authority"
                    : allCosted
                      ? needs
                        ? `Needs sales head (above ${inrShort(threshold)})`
                        : `Within estimator authority (up to ${inrShort(threshold)})`
                      : `Needed above ${inrShort(threshold)} a year`}
                </dd>
                {live ? (
                  <>
                    <dt>Quote no.</dt>
                    <dd>{live.quote_no}</dd>
                  </>
                ) : null}
              </dl>

              {rfq.status === "estimating" && lastRejected ? (
                <div className="notice warn">
                  Sent back by {lastRejected.decided_by_name ?? "the sales head"}: {lastRejected.decision_note}
                </div>
              ) : null}

              {rfq.status === "estimating" ? (
                <>
                  {!allCosted && parts.length > 0 ? (
                    <div className="notice">
                      Before you can submit:
                      <ul>
                        {problems.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <SubmitQuoteButton
                    rfqId={id}
                    disabled={!allCosted}
                    label={needs || !allCosted ? "Submit for approval" : "Submit quote"}
                  />
                </>
              ) : null}

              {live?.status === "pending_approval" ? (
                user.role === "sales_head" && live.submitted_by !== user.id ? (
                  <DecideButtons quoteId={live.id} />
                ) : (
                  <p className="muted">
                    Waiting for the sales head. Submitted by {live.submitted_by_name} on{" "}
                    {dateTimeLabel(live.submitted_at)}.
                  </p>
                )
              ) : null}

              {live?.status === "approved" ? (
                <div className="row">
                  <Link className="btn" href={`/quotes/${live.id}`}>
                    Preview quote
                  </Link>
                  <SendButton quoteId={live.id} />
                </div>
              ) : null}

              {live?.status === "sent" ? (
                <>
                  <Link className="btn" href={`/quotes/${live.id}`}>
                    View quote
                  </Link>
                  {rfq.status === "sent" ? <OutcomeButtons rfqId={id} /> : null}
                </>
              ) : null}
              {(rfq.status === "won" || rfq.status === "lost") && live ? (
                <Link className="btn" href={`/quotes/${live.id}`}>
                  View quote
                </Link>
              ) : null}
            </div>
          </div>

          {quotes.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <h2>Quote versions</h2>
              </div>
              <table>
                <tbody>
                  {quotes.map((q: Quote) => (
                    <tr key={q.id}>
                      <td>
                        <Link href={`/quotes/${q.id}`}>{q.quote_no}</Link>
                      </td>
                      <td>
                        <StatusBadge status={q.status} />
                      </td>
                      <td className="num">{inrShort(q.annual_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="card">
            <div className="card-head">
              <h2>Activity</h2>
            </div>
            <div className="card-body">
              <ul className="timeline">
                {activity.map((a) => (
                  <li key={a.id}>
                    {ACTION_LABEL[a.action] ?? a.action}
                    {typeof a.detail.note === "string" && a.detail.note ? `: ${a.detail.note}` : ""}
                    <time>
                      {a.user_name ?? "System"} · {dateTimeLabel(a.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
