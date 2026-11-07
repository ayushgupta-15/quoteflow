import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/Badge";
import {
  costingHistory,
  getPart,
  getRfq,
  loadRates,
  searchPast,
  today,
} from "@/lib/services";
import { requireUser } from "@/lib/session";
import { CostingEditor } from "./CostingEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Costing" };

export default async function PartCosting({ params }: { params: Promise<{ id: string; partId: string }> }) {
  await requireUser();
  const { id, partId } = await params;
  const rfq = await getRfq(Number(id));
  const part = await getPart(Number(partId));
  if (!rfq || !part || part.rfq_id !== rfq.id) notFound();

  const [rates, history, suggestions, now] = await Promise.all([
    loadRates(),
    costingHistory(part.id),
    searchPast({
      similarTo: { name: part.name, materialCode: part.material_code, grossWtKg: part.gross_wt_kg },
      limit: 3,
    }),
    today(),
  ]);
  const locked = ["pending_approval", "approved", "sent", "won", "lost"].includes(rfq.status);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="crumb">
            <Link href="/rfqs">RFQs</Link> / <Link href={`/rfqs/${rfq.id}`}>{rfq.rfq_no}</Link> / Part {part.line_no}
          </div>
          <h1>{part.name}</h1>
          <p className="sub">
            {rfq.customer} · <StatusBadge status={rfq.status} />
          </p>
        </div>
      </div>
      <CostingEditor
        rfqId={rfq.id}
        part={part}
        rates={rates}
        today={now}
        locked={locked}
        suggestions={suggestions}
        history={history.map((h) => ({
          id: h.id,
          version: h.version,
          pricing_date: h.pricing_date,
          created_at: String(h.created_at),
          created_by_name: h.created_by_name,
          annualValue: h.result.annualValue,
          basePrice: h.result.base.price,
        }))}
      />
    </div>
  );
}
