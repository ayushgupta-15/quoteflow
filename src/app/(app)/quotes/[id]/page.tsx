import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/Badge";
import { dateLabel, dateTimeLabel, inr, inrShort, num } from "@/lib/format";
import { getQuote, getQuoteLines, getRfq } from "@/lib/services";
import { requireUser } from "@/lib/session";
import { DecideButtons, SendButton } from "../../rfqs/[id]/QuoteActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Quote" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const quote = await getQuote(id);
  if (!quote) notFound();
  const [rfq, lines] = await Promise.all([getRfq(quote.rfq_id), getQuoteLines(id)]);
  if (!rfq) notFound();

  const canDecide = quote.status === "pending_approval" && user.role === "sales_head" && quote.submitted_by !== user.id;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="crumb">
            <Link href="/rfqs">RFQs</Link> / <Link href={`/rfqs/${rfq.id}`}>{rfq.rfq_no}</Link> / {quote.quote_no}
          </div>
          <h1>
            {quote.quote_no} <StatusBadge status={quote.status} />
          </h1>
          <p className="sub">
            {rfq.customer} · submitted by {quote.submitted_by_name} on {dateTimeLabel(quote.submitted_at)}
          </p>
        </div>
        <a className="btn" href={`/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer">
          Open PDF
        </a>
      </div>

      <div className="two-col">
        <div className="stack">
          {lines.map(({ part, costing }) => (
            <div className="card scroll" key={part.id}>
              <div className="card-head">
                <h2>{part.name}</h2>
                <span className="small muted">
                  {part.material_code} · {num(part.gross_wt_kg, 3)} kg · costing v{costing.version}
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Annual volume</th>
                    <th className="num">Price ex-GST</th>
                    <th className="num">GST</th>
                    <th className="num">Incl. GST</th>
                    <th className="num">Annual value</th>
                  </tr>
                </thead>
                <tbody>
                  {costing.result.tiers.map((t) => (
                    <tr key={t.volume} className={t.volume === part.annual_volume ? "strong" : ""}>
                      <td>
                        {num(t.volume)} pcs {t.volume === part.annual_volume ? <span className="tag">base</span> : null}
                      </td>
                      <td className="num">{inr(t.price)}</td>
                      <td className="num muted">{inr(t.gst)}</td>
                      <td className="num muted">{inr(t.priceInclGst)}</td>
                      <td className="num">{inrShort(t.annualValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <details>
                <summary className="card-head" style={{ cursor: "pointer", listStyle: "none", borderTop: "1px solid var(--line-2)", borderBottom: 0 }}>
                  <h3>Cost breakup at the base volume and the rates behind it</h3>
                </summary>
                <table className="cost-table">
                  <tbody>
                    {costing.result.base.lines.map((l) => (
                      <tr key={l.key}>
                        <td>
                          {l.label}
                          <div className="formula">{l.formula}</div>
                        </td>
                        <td className="num">{num(l.amount, 2)}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td>Cost</td>
                      <td className="num">{num(costing.result.base.cost, 2)}</td>
                    </tr>
                  </tbody>
                </table>
                <table>
                  <thead>
                    <tr>
                      <th>Rate used</th>
                      <th>Starts</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costing.result.ratesUsed.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.label} <span className="muted small">#{r.id}</span>
                        </td>
                        <td>{dateLabel(r.effective_from)}</td>
                        <td className="num">
                          {num(r.value, 2)} <span className="muted small">{r.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          ))}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Decision</h2>
            </div>
            <div className="card-body stack" style={{ gap: 14 }}>
              <dl className="kv">
                <dt>Annual value</dt>
                <dd className="num">
                  <strong>{inr(quote.annual_value, 0)}</strong>
                </dd>
                <dt>Approval</dt>
                <dd>{quote.needs_approval ? "Sales head approval needed" : "Within estimator authority"}</dd>
                {quote.decided_at ? (
                  <>
                    <dt>Decision</dt>
                    <dd>
                      {quote.decided_by_name ? `${quote.decided_by_name}, ` : ""}
                      {dateTimeLabel(quote.decided_at)}
                      {quote.decision_note ? <div className="muted">{quote.decision_note}</div> : null}
                    </dd>
                  </>
                ) : null}
                {quote.sent_at ? (
                  <>
                    <dt>Sent</dt>
                    <dd>{dateTimeLabel(quote.sent_at)} (mocked, no email leaves the system)</dd>
                  </>
                ) : null}
              </dl>
              {canDecide ? <DecideButtons quoteId={quote.id} /> : null}
              {quote.status === "pending_approval" && !canDecide ? (
                <p className="muted">
                  {user.role === "sales_head" ? "You submitted this quote, so someone else must approve it." : "Waiting for the sales head."}
                </p>
              ) : null}
              {quote.status === "approved" ? <SendButton quoteId={quote.id} /> : null}
              {quote.status === "superseded" ? <p className="muted">A newer version of this quote exists.</p> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
