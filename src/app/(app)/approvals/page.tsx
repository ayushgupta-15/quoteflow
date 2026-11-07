import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dateTimeLabel, inrShort } from "@/lib/format";
import { pendingApprovals } from "@/lib/services";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function Approvals() {
  const user = await requireUser();
  if (user.role !== "sales_head") notFound();
  const rows = await pendingApprovals();
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="sub">Quotes above the approval limit wait here for the sales head.</p>
        </div>
      </div>
      <div className="card scroll">
        {rows.length === 0 ? (
          <div className="empty">
            <strong>Nothing waiting</strong>New quotes above the limit will appear here.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Quote</th>
                <th>Customer</th>
                <th className="num">Parts</th>
                <th className="num">Annual value</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id} className="link">
                  <td>
                    <Link href={`/quotes/${q.id}`}>
                      <strong>{q.quote_no}</strong>
                    </Link>
                    <div className="small muted">{q.rfq_no}</div>
                  </td>
                  <td>{q.customer}</td>
                  <td className="num">{q.part_count}</td>
                  <td className="num">{inrShort(q.annual_value)}</td>
                  <td>
                    {q.submitted_by_name}
                    <div className="small muted">{dateTimeLabel(q.submitted_at)}</div>
                  </td>
                  <td className="num">
                    <Link className="btn sm primary" href={`/quotes/${q.id}`}>
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
