import { getUser } from "@/lib/session";
import { renderQuotePdf } from "@/lib/pdf";
import { getQuote, getQuoteLines, getRfq, loadRates } from "@/lib/services";
import { PARAM, rateAt } from "@/lib/costing";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new Response("Not found", { status: 404 });
  const quote = await getQuote(id);
  if (!quote) return new Response("Not found", { status: 404 });
  const [rfq, lines, rates] = await Promise.all([getRfq(quote.rfq_id), getQuoteLines(id), loadRates()]);
  if (!rfq) return new Response("Not found", { status: 404 });
  // GST as it was when the quote was costed (the pricing date of its lines), not today's.
  const pricingDate = lines[0]?.costing.pricing_date ?? new Date().toISOString().slice(0, 10);
  const gstPct = rateAt(rates, "param", PARAM.GST_PCT, pricingDate)?.value ?? 18;
  const pdf = await renderQuotePdf({ quote, rfq, lines, gstPct, validityDays: 30 });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${quote.quote_no}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
