/**
 * RFQ intake extraction. Deterministic rules come first and are always available.
 * An LLM is an optional fallback for free-text emails the rules cannot read; it is never
 * used for any cost maths. Every extracted value carries its source, so the estimator can see
 * where it came from, and nothing is trusted until the estimator accepts it.
 */
import { z } from "zod";

export interface Extracted<T> {
  value: T;
  source: string; // human-readable, shown next to the field
  confidence: number; // 0..1
  origin: "excel" | "email" | "title_block" | "llm" | "assumption";
}

export interface ExtractedPart {
  name?: Extracted<string>;
  materialCode?: Extracted<string>;
  grossWtKg?: Extracted<number>;
  netWtKg?: Extracted<number>;
  annualVolume?: Extracted<number>;
}

export interface ExtractedRfq {
  customer?: Extracted<string>;
  dueOn?: Extracted<string>; // YYYY-MM-DD
  parts: ExtractedPart[];
  notes: string[];
  method: "rules" | "rules+llm";
}

export interface ExtractOptions {
  email: string;
  titleBlock?: string;
  rows?: string[][]; // first row is the header
  knownMaterials: string[]; // codes in the rate master, without -SCRAP
  today: string; // YYYY-MM-DD
  llm?: (email: string) => Promise<LlmRfq | null>;
}

// ---------- normalising ----------

const MATERIAL_ALIASES: [RegExp, string][] = [
  [/\ben[\s-]?8\b/i, "EN8"],
  [/\b40\s?cr\s?4\b/i, "40Cr4-F"],
  [/\b20\s?mn\s?cr\s?5\b/i, "20MnCr5"],
];

export function normaliseMaterial(raw: string, known: string[]): string | undefined {
  for (const [re, code] of MATERIAL_ALIASES) {
    if (re.test(raw) && known.includes(code)) return code;
  }
  const direct = known.find((k) => k.toLowerCase() === raw.trim().toLowerCase());
  return direct;
}

/** "1,80,000", "180,000", "1.8 lakh" and "180000 pcs" all become 180000. */
export function parseNumber(raw: string): number | undefined {
  const s = raw.toLowerCase().replace(/[₹,\s]/g, "");
  const lakh = s.match(/^(\d+(?:\.\d+)?)lakh/);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100000);
  const m = s.match(/^(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseDate(text: string, today: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const dmy = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const named = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(20\d{2}))?/i,
  );
  if (named) {
    const month = MONTHS.indexOf(named[2].toLowerCase()) + 1;
    let year = named[3] ? parseInt(named[3], 10) : parseInt(today.slice(0, 4), 10);
    let candidate = `${year}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
    if (!named[3] && candidate < today) {
      year += 1;
      candidate = `${year}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
    }
    return candidate;
  }
  return undefined;
}

// ---------- spreadsheet ----------

const HEADER_SYNONYMS: Record<keyof ExtractedPart, RegExp> = {
  name: /^(part|part name|description|item|component|drawing title)\b/i,
  materialCode: /\b(material|grade|mat\.?)\b/i,
  grossWtKg: /\b(gross|rough|forged|blank)\b.*\b(wt|weight)\b|^(gross|weight)\b/i,
  netWtKg: /\b(net|finish(ed)?)\b.*\b(wt|weight)\b|^net\b/i,
  annualVolume: /\b(annual|yearly|eav|volume|qty|quantity|pcs)\b/i,
};

export function extractFromRows(rows: string[][], known: string[]): ExtractedPart[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h ?? "").trim());
  const colFor = (field: keyof ExtractedPart): number => {
    // Net weight must be matched before gross so "Net Wt" is not read as gross.
    return header.findIndex((h) => HEADER_SYNONYMS[field].test(h));
  };
  const cols = {
    name: colFor("name"),
    materialCode: colFor("materialCode"),
    netWtKg: colFor("netWtKg"),
    grossWtKg: header.findIndex((h, i) => HEADER_SYNONYMS.grossWtKg.test(h) && i !== colFor("netWtKg")),
    annualVolume: colFor("annualVolume"),
  };
  const out: ExtractedPart[] = [];
  rows.slice(1).forEach((r, i) => {
    if (r.every((c) => String(c ?? "").trim() === "")) return;
    const rowNo = i + 2;
    const src = (col: number) => `Excel row ${rowNo}, column "${header[col]}"`;
    const part: ExtractedPart = {};
    const cell = (c: number) => String(r[c] ?? "").trim();
    if (cols.name >= 0 && cell(cols.name))
      part.name = { value: cell(cols.name), source: src(cols.name), confidence: 0.95, origin: "excel" };
    if (cols.materialCode >= 0 && cell(cols.materialCode)) {
      const code = normaliseMaterial(cell(cols.materialCode), known);
      part.materialCode = code
        ? { value: code, source: `${src(cols.materialCode)} ("${cell(cols.materialCode)}")`, confidence: 0.9, origin: "excel" }
        : { value: cell(cols.materialCode).toUpperCase(), source: `${src(cols.materialCode)}: not in the material master`, confidence: 0.3, origin: "excel" };
    }
    for (const f of ["grossWtKg", "netWtKg", "annualVolume"] as const) {
      const c = cols[f];
      if (c >= 0) {
        const n = parseNumber(cell(c));
        if (n !== undefined && n > 0)
          part[f] = { value: n, source: src(c), confidence: 0.95, origin: "excel" };
      }
    }
    if (Object.keys(part).length > 0) out.push(part);
  });
  return out;
}

// ---------- drawing title block (pasted text) ----------

export function extractFromTitleBlock(text: string, known: string[]): ExtractedPart {
  const part: ExtractedPart = {};
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/^\s*([A-Za-z .\/]+?)\s*[:=]\s*(.+?)\s*$/);
    if (!m) return;
    const key = m[1].toLowerCase();
    const val = m[2];
    const src = `drawing title block, line ${i + 1} (${m[1].trim()})`;
    if (/^(part name|description|title|part)$/.test(key))
      part.name = { value: val, source: src, confidence: 0.85, origin: "title_block" };
    else if (/^(material|mat)$/.test(key)) {
      const code = normaliseMaterial(val, known);
      part.materialCode = code
        ? { value: code, source: src, confidence: 0.85, origin: "title_block" }
        : { value: val.toUpperCase(), source: `${src}: not in the material master`, confidence: 0.3, origin: "title_block" };
    } else if (/^(weight|wt|gross wt|gross weight)$/.test(key)) {
      const n = parseNumber(val);
      if (n) part.grossWtKg = { value: /\bg\b|gm|gram/i.test(val) && !/kg/i.test(val) ? n / 1000 : n, source: src, confidence: 0.8, origin: "title_block" };
    } else if (/^(net wt|net weight|finish wt|finished weight)$/.test(key)) {
      const n = parseNumber(val);
      if (n) part.netWtKg = { value: n, source: src, confidence: 0.8, origin: "title_block" };
    }
  });
  return part;
}

// ---------- email text ----------

const GENERIC_GRADE = /\b(?:EN\s?\d{1,2}[A-Z]?|SAE\s?\d{4}|\d{2}[A-Za-z]{2,3}\d{1,2}[A-Za-z]*)\b/;

const LINE_VOLUME = /(\d[\d,]*(?:\.\d+)?\s*(?:lakh)?)\s*(?:pcs|nos|pieces|units|no\.?)?\s*(?:\/|per)?\s*(?:yr|year|annum|annual)?/i;

export function extractFromEmailLines(email: string, known: string[]): ExtractedPart[] {
  const out: ExtractedPart[] = [];
  email.split(/\r?\n/).forEach((line, i) => {
    const alias = MATERIAL_ALIASES.find(([re]) => re.test(line));
    // A grade we have no alias for (EN19, SAE 1045, 42CrMo4...) is still read, but flagged.
    const generic = alias ? null : line.match(GENERIC_GRADE);
    const material: [RegExp, string] | undefined = alias ?? (generic ? [GENERIC_GRADE, generic[0].replace(/\s+/g, "")] : undefined);
    const weight = line.match(/(\d+(?:\.\d+)?)\s*kgs?\b/i);
    if (!material || !weight) return; // a part line names a material and a weight
    const code = known.includes(material[1]) ? material[1] : undefined;
    const src = `email, line ${i + 1}`;
    const part: ExtractedPart = {};
    const name = line
      .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "")
      .split(/[,;|–—]|\s-\s/)[0]
      .trim();
    if (name && !MATERIAL_ALIASES.some(([re]) => re.test(name)))
      part.name = { value: name, source: src, confidence: 0.7, origin: "email" };
    part.materialCode = code
      ? { value: code, source: src, confidence: 0.75, origin: "email" }
      : { value: material[1].toUpperCase(), source: `${src}: not in the material master`, confidence: 0.3, origin: "email" };
    part.grossWtKg = { value: parseFloat(weight[1]), source: src, confidence: 0.7, origin: "email" };
    const rest = line.replace(weight[0], " ").replace(material[0], " ");
    const vol = rest.match(/(\d[\d,]*(?:\.\d+)?\s*(?:lakh)?)\s*(?:pcs|nos|pieces|units|no\.?|\/\s*(?:yr|year)|per\s+(?:yr|year|annum)|annual)/i)
      ?? rest.match(LINE_VOLUME);
    const n = vol ? parseNumber(vol[1]) : undefined;
    if (n && n >= 10) part.annualVolume = { value: n, source: src, confidence: 0.7, origin: "email" };
    out.push(part);
  });
  return out;
}

export function extractCustomer(email: string): Extracted<string> | undefined {
  const explicit = email.match(/^\s*(?:customer|company)\s*[:\-]\s*(.+)$/im);
  if (explicit) return { value: explicit[1].trim(), source: "email, customer line", confidence: 0.9, origin: "email" };
  const from = email.match(/^\s*from\s*:\s*(?:"?([^"<\n]+?)"?\s*)?<?[\w.+-]+@([\w-]+)\./im);
  if (from) {
    const domain = from[2].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { value: domain, source: `email, From address domain${from[1] ? ` (sender ${from[1].trim()})` : ""}`, confidence: 0.5, origin: "email" };
  }
  return undefined;
}

export function extractDue(email: string, today: string): Extracted<string> | undefined {
  for (const line of email.split(/\r?\n/)) {
    if (/\b(by|before|due|deadline|latest|quote\s+by|submit)\b/i.test(line)) {
      const d = parseDate(line, today);
      if (d) return { value: d, source: `email: "${line.trim().slice(0, 80)}"`, confidence: 0.75, origin: "email" };
    }
  }
  return undefined;
}

// ---------- optional LLM fallback ----------

export const llmRfqSchema = z.object({
  customer: z.string().max(120).nullish(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  parts: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        material: z.string().max(60).nullish(),
        gross_wt_kg: z.number().positive().max(5000).nullish(),
        annual_volume: z.number().int().positive().max(100_000_000).nullish(),
      }),
    )
    .max(50),
});
export type LlmRfq = z.infer<typeof llmRfqSchema>;

/**
 * Calls the Anthropic Messages API with a forced tool call so the reply is structured JSON.
 * Only the email text is sent (never drawings). API traffic is not used to train models by
 * default; see the TDD. Returns null on any failure so the caller falls back to rules.
 */
export function makeAnthropicExtractor(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): (email: string) => Promise<LlmRfq | null> {
  return async (email) => {
    try {
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-5-5",
          max_tokens: 1024,
          tools: [
            {
              name: "record_rfq",
              description: "Record the customer, due date and parts requested in an RFQ email.",
              input_schema: {
                type: "object",
                properties: {
                  customer: { type: "string" },
                  due_date: { type: "string", description: "YYYY-MM-DD, only if stated" },
                  parts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        material: { type: "string" },
                        gross_wt_kg: { type: "number" },
                        annual_volume: { type: "integer" },
                      },
                      required: ["name"],
                    },
                  },
                },
                required: ["parts"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "record_rfq" },
          messages: [
            {
              role: "user",
              content:
                "Extract the RFQ details from this email. Only record values that are written in it; " +
                "leave a field out if it is not stated. Do not calculate or guess prices.\n\n<email>\n" +
                email.slice(0, 8000) +
                "\n</email>",
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { content?: { type: string; input?: unknown }[] };
      const block = body.content?.find((b) => b.type === "tool_use");
      const parsed = llmRfqSchema.safeParse(block?.input);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
}

// ---------- orchestration ----------

function fromLlm(v: LlmRfq, known: string[]): ExtractedPart[] {
  return v.parts.map((p) => {
    const part: ExtractedPart = { name: { value: p.name, source: "AI reading of the email", confidence: 0.6, origin: "llm" } };
    if (p.material) {
      const code = normaliseMaterial(p.material, known);
      part.materialCode = code
        ? { value: code, source: `AI reading of the email ("${p.material}")`, confidence: 0.6, origin: "llm" }
        : { value: p.material.toUpperCase(), source: "AI reading of the email: not in the material master", confidence: 0.3, origin: "llm" };
    }
    if (p.gross_wt_kg) part.grossWtKg = { value: p.gross_wt_kg, source: "AI reading of the email", confidence: 0.6, origin: "llm" };
    if (p.annual_volume) part.annualVolume = { value: p.annual_volume, source: "AI reading of the email", confidence: 0.6, origin: "llm" };
    return part;
  });
}

export async function extractRfq(opts: ExtractOptions): Promise<ExtractedRfq> {
  const notes: string[] = [];
  let method: ExtractedRfq["method"] = "rules";

  let parts: ExtractedPart[] = [];
  if (opts.rows && opts.rows.length > 1) {
    parts = extractFromRows(opts.rows, opts.knownMaterials);
    if (parts.length === 0) notes.push("The spreadsheet had no readable part rows. Check the column headings.");
  }
  if (parts.length === 0) parts = extractFromEmailLines(opts.email, opts.knownMaterials);

  let llmCustomer: string | undefined;
  let llmDue: string | undefined;
  if (parts.length === 0 && opts.llm && opts.email.trim()) {
    const llm = await opts.llm(opts.email);
    if (llm) {
      parts = fromLlm(llm, opts.knownMaterials);
      llmCustomer = llm.customer ?? undefined;
      llmDue = llm.due_date ?? undefined;
      method = "rules+llm";
    } else {
      notes.push("The AI reader was unavailable or returned nothing usable, so only the rule-based reader ran.");
    }
  }

  if (opts.titleBlock?.trim()) {
    const tb = extractFromTitleBlock(opts.titleBlock, opts.knownMaterials);
    if (parts.length === 0) parts = [tb];
    else if (parts.length === 1) {
      // Title block fills gaps only; it never overrides a value from the part list.
      const p = parts[0];
      for (const k of Object.keys(tb) as (keyof ExtractedPart)[]) {
        if (!p[k]) (p as Record<string, unknown>)[k] = tb[k];
      }
    } else {
      notes.push("A title block was pasted but the RFQ has several parts, so it was not merged. Paste it per part later.");
    }
  }

  // Net weight is not always supplied. Estimate it, but flag it clearly as an assumption.
  for (const p of parts) {
    if (!p.netWtKg && p.grossWtKg) {
      p.netWtKg = {
        value: Math.round(p.grossWtKg.value * 0.85 * 1000) / 1000,
        source: "assumed 85% of gross weight; no net weight was given",
        confidence: 0.2,
        origin: "assumption",
      };
    }
  }

  const customer = extractCustomer(opts.email) ??
    (llmCustomer ? { value: llmCustomer, source: "AI reading of the email", confidence: 0.6, origin: "llm" as const } : undefined);
  const dueOn = extractDue(opts.email, opts.today) ??
    (llmDue ? { value: llmDue, source: "AI reading of the email", confidence: 0.6, origin: "llm" as const } : undefined);

  if (parts.length === 0) notes.push("No parts were found. Add them by hand below.");
  return { customer, dueOn, parts, notes, method };
}

/** Minimal CSV reader for the intake upload (handles quotes and commas inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}
