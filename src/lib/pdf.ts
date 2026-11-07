import PDFDocument from "pdfkit";
import type { Quote, QuoteLine, Rfq } from "./services";

// Built-in PDF fonts have no rupee glyph, so amounts are printed as "Rs.".
const rs = (n: number, dp = 2) =>
  `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

const INK = "#1c2024";
const MUTED = "#737a82";
const LINE = "#e4e2dc";
const ACCENT = "#1d3f5f";

export interface QuotePdfInput {
  quote: Quote;
  rfq: Rfq;
  lines: QuoteLine[];
  gstPct: number;
  validityDays: number;
}

export function renderQuotePdf({ quote, rfq, lines, gstPct, validityDays }: QuotePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Quotation ${quote.quote_no}`, Author: "Company A" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 48;
    const width = doc.page.width - 96;
    const final = quote.status === "approved" || quote.status === "sent";

    // Header
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text("Company A", left, 48);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Machined and forged components, Chakan, Pune", left, 70);
    doc.font("Helvetica-Bold").fontSize(20).fillColor(ACCENT).text("Quotation", left, 48, { width, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(quote.quote_no, left, 74, { width, align: "right" });
    doc.moveTo(left, 96).lineTo(left + width, 96).strokeColor(LINE).stroke();

    // Meta
    let y = 110;
    const meta: [string, string][] = [
      ["Customer", rfq.customer],
      ["Your RFQ", rfq.rfq_no],
      ["Quote date", new Date(quote.submitted_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })],
      ["Valid for", `${validityDays} days`],
    ];
    for (const [k, v] of meta) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(k, left, y, { width: 90 });
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(v, left + 90, y - 1, { width: width - 90 });
      y += 16;
    }
    if (!final) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#a23b3b").text("DRAFT, not yet approved. Do not send.", left, y + 2);
      y += 18;
    }
    y += 10;

    const ensure = (need: number) => {
      if (y + need > doc.page.height - 70) {
        doc.addPage();
        y = 48;
      }
    };

    const row = (cols: { text: string; x: number; w: number; align?: "left" | "right"; bold?: boolean; color?: string }[], size = 9) => {
      cols.forEach((c) => {
        doc
          .font(c.bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(size)
          .fillColor(c.color ?? INK)
          .text(c.text, c.x, y, { width: c.w, align: c.align ?? "left", lineBreak: false });
      });
      y += size + 7;
    };

    lines.forEach(({ part, costing }, idx) => {
      const r = costing.result;
      ensure(120 + r.base.lines.length * 15);
      doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(`${idx + 1}. ${part.name}`, left, y);
      y += 17;
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(
        `Material ${part.material_code}  |  Gross weight ${part.gross_wt_kg} kg  |  Annual volume ${part.annual_volume.toLocaleString("en-IN")} pcs`,
        left,
        y,
      );
      y += 18;

      // Price table by volume
      const cols = [
        { x: left, w: 120, h: "Annual volume" },
        { x: left + 120, w: 100, h: "Price ex-GST" },
        { x: left + 220, w: 90, h: `GST ${gstPct}%` },
        { x: left + 310, w: 100, h: "Price incl. GST" },
        { x: left + 410, w: width - 410, h: "Annual value ex-GST" },
      ];
      row(cols.map((c, i) => ({ text: c.h, x: c.x, w: c.w, align: i === 0 ? "left" : "right", bold: true, color: MUTED })), 8);
      doc.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor(LINE).stroke();
      r.tiers.forEach((t) => {
        row([
          { text: `${t.volume.toLocaleString("en-IN")} pcs${t.volume === part.annual_volume ? " (base)" : ""}`, x: cols[0].x, w: cols[0].w },
          { text: rs(t.price), x: cols[1].x, w: cols[1].w, align: "right", bold: true },
          { text: rs(t.gst), x: cols[2].x, w: cols[2].w, align: "right" },
          { text: rs(t.priceInclGst), x: cols[3].x, w: cols[3].w, align: "right" },
          { text: rs(t.annualValue, 0), x: cols[4].x, w: cols[4].w, align: "right" },
        ]);
      });
      y += 6;

      // Cost breakup at the base volume
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(`Cost breakup per piece at ${part.annual_volume.toLocaleString("en-IN")} pcs a year`, left, y);
      y += 14;
      r.base.lines.forEach((l) => {
        row([
          { text: l.label, x: left, w: 300 },
          { text: rs(l.amount), x: left + 300, w: 100, align: "right" },
        ]);
      });
      doc.moveTo(left, y - 3).lineTo(left + 400, y - 3).strokeColor(LINE).stroke();
      row([
        { text: "Cost", x: left, w: 300, bold: true },
        { text: rs(r.base.cost), x: left + 300, w: 100, align: "right", bold: true },
      ]);
      row([
        { text: `Margin on price (${part.margin_pct}%)`, x: left, w: 300 },
        { text: rs(r.base.price - r.base.cost), x: left + 300, w: 100, align: "right" },
      ]);
      row([
        { text: "Price per piece, ex-GST", x: left, w: 300, bold: true },
        { text: rs(r.base.price), x: left + 300, w: 100, align: "right", bold: true },
      ]);
      y += 14;
    });

    ensure(110);
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor(LINE).stroke();
    y += 10;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Total annual value, ex-GST", left, y, { width: width - 140 });
    doc.text(rs(quote.annual_value, 0), left + width - 140, y, { width: 140, align: "right" });
    y += 26;

    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text("Terms", left, y);
    y += 13;
    const terms = [
      `Prices are in Indian rupees. GST at ${gstPct}% is shown separately and is extra.`,
      "Prices are per piece, packed, with freight to the customer's plant as in the cost breakup.",
      `This quotation is valid for ${validityDays} days from the quote date.`,
      "Volumes are annual. Prices for other volumes are shown above.",
    ];
    for (const t of terms) {
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(`- ${t}`, left, y, { width });
      y += 12;
    }
    if (quote.decided_by_name && quote.decided_at) {
      y += 6;
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(
        `Approved by ${quote.decided_by_name} on ${new Date(quote.decided_at).toLocaleDateString("en-IN")}`,
        left,
        y,
      );
    }
    doc.end();
  });
}
