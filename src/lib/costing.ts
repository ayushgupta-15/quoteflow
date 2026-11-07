/**
 * Costing engine. Pure functions only: no database, no AI, no clock.
 * All money is rupees. Every leaf amount is rounded to 2 decimals and everything above is a
 * sum of rounded leaves, so a printed cost breakup always adds up exactly.
 *
 * Assumptions (also listed in the TDD):
 *  - Overhead is a % of conversion cost (machining), not of material.
 *  - Margin is a % of the selling price (price = cost / (1 - margin)).
 *  - Setup time is spread over a production lot = LOT_MONTHS of annual demand.
 *  - Tooling is spread over (volume x TOOLING_YEARS).
 *  - Freight is rupees per kg of gross weight.
 */

export type RateKind = "material" | "work_centre" | "param";

export interface RateRow {
  id: number;
  kind: RateKind;
  code: string;
  label: string;
  unit: string;
  value: number;
  effective_from: string; // YYYY-MM-DD
}

export interface OpInput {
  seq: number;
  workCentreCode: string;
  cycleMin: number;
  setupMin: number;
}

export interface CostInputs {
  pricingDate: string; // YYYY-MM-DD, the date rates are looked up as of
  materialCode: string;
  grossWtKg: number;
  netWtKg: number;
  annualVolume: number;
  volumes: number[]; // price tiers, annual volumes
  toolingCost: number;
  packingPerUnit: number;
  marginPct: number;
  ops: OpInput[];
}

export interface RateRef {
  id: number;
  kind: RateKind;
  code: string;
  label: string;
  unit: string;
  value: number;
  effective_from: string;
}

export interface CostLine {
  key: string;
  label: string;
  formula: string;
  amount: number;
}

export interface TierResult {
  volume: number;
  lotSize: number;
  lines: CostLine[];
  cost: number;
  price: number; // ex-GST unit price
  gst: number;
  priceInclGst: number;
  annualValue: number; // price x volume (ex-GST)
}

export interface CostResult {
  tiers: TierResult[];
  base: TierResult; // the tier at annualVolume
  annualValue: number;
  ratesUsed: RateRef[];
  warnings: string[];
}

export class CostingError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "CostingError";
  }
}

export const PARAM = {
  OVERHEAD_PCT: "OVERHEAD_PCT",
  FREIGHT_PER_KG: "FREIGHT_PER_KG",
  GST_PCT: "GST_PCT",
  LOT_MONTHS: "LOT_MONTHS",
  TOOLING_YEARS: "TOOLING_YEARS",
  APPROVAL_THRESHOLD: "APPROVAL_THRESHOLD",
} as const;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Latest row for (kind, code) whose effective_from is on or before `date`. */
export function rateAt(
  rows: RateRow[],
  kind: RateKind,
  code: string,
  date: string,
): RateRow | undefined {
  let best: RateRow | undefined;
  for (const r of rows) {
    if (r.kind !== kind || r.code !== code || r.effective_from > date) continue;
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best;
}

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function validateInputs(i: CostInputs): string[] {
  const issues: string[] = [];
  if (!(i.grossWtKg > 0)) issues.push("Gross weight must be greater than 0");
  if (!(i.netWtKg > 0)) issues.push("Net weight must be greater than 0");
  if (i.netWtKg > i.grossWtKg) issues.push("Net weight cannot exceed gross weight");
  if (!(i.annualVolume > 0)) issues.push("Annual volume must be greater than 0");
  if (i.volumes.length === 0) issues.push("Add at least one volume tier");
  if (i.volumes.some((v) => !(v > 0))) issues.push("Every volume tier must be greater than 0");
  if (i.toolingCost < 0) issues.push("Tooling cost cannot be negative");
  if (i.packingPerUnit < 0) issues.push("Packing cost cannot be negative");
  if (!(i.marginPct >= 0 && i.marginPct < 60)) issues.push("Margin must be from 0% to under 60%");
  if (i.ops.length === 0) issues.push("Add at least one routing operation");
  for (const op of i.ops) {
    if (!(op.cycleMin >= 0) || !(op.setupMin >= 0))
      issues.push(`Operation ${op.seq}: times cannot be negative`);
  }
  return issues;
}

export function computeCost(inputs: CostInputs, rates: RateRow[]): CostResult {
  const issues = validateInputs(inputs);
  const warnings: string[] = [];
  const used = new Map<number, RateRef>();

  const need = (kind: RateKind, code: string, what: string): RateRow | undefined => {
    const row = rateAt(rates, kind, code, inputs.pricingDate);
    if (!row) {
      issues.push(`No ${what} rate for "${code}" on or before ${inputs.pricingDate}`);
      return undefined;
    }
    used.set(row.id, {
      id: row.id,
      kind: row.kind,
      code: row.code,
      label: row.label,
      unit: row.unit,
      value: row.value,
      effective_from: row.effective_from,
    });
    return row;
  };

  const materialRate = need("material", inputs.materialCode, "material");
  const scrapRow = rateAt(rates, "material", `${inputs.materialCode}-SCRAP`, inputs.pricingDate);
  if (scrapRow) {
    used.set(scrapRow.id, { ...scrapRow });
  } else {
    warnings.push(`No scrap recovery rate for ${inputs.materialCode}; scrap valued at ₹0`);
  }
  const overheadPct = need("param", PARAM.OVERHEAD_PCT, "overhead");
  const freightPerKg = need("param", PARAM.FREIGHT_PER_KG, "freight");
  const gstPct = need("param", PARAM.GST_PCT, "GST");
  const lotMonths = need("param", PARAM.LOT_MONTHS, "lot size");
  const toolingYears = need("param", PARAM.TOOLING_YEARS, "tooling life");
  const opRates = new Map<string, RateRow>();
  for (const op of inputs.ops) {
    const r = need("work_centre", op.workCentreCode, "machine hour");
    if (r) opRates.set(op.workCentreCode, r);
  }

  if (issues.length > 0) throw new CostingError(issues);

  const scrapRate = scrapRow?.value ?? 0;
  const tierVolumes = Array.from(new Set([...inputs.volumes, inputs.annualVolume])).sort(
    (a, b) => a - b,
  );
  const ops = [...inputs.ops].sort((a, b) => a.seq - b.seq);

  const tiers = tierVolumes.map((volume): TierResult => {
    const lotSize = Math.max(1, (volume / 12) * lotMonths!.value);
    const lines: CostLine[] = [];

    const scrapWt = inputs.grossWtKg - inputs.netWtKg;
    const material = round2(inputs.grossWtKg * materialRate!.value - scrapWt * scrapRate);
    lines.push({
      key: "material",
      label: "Material, net of scrap recovery",
      formula: `${fmt(inputs.grossWtKg, 3)} kg × ₹${fmt(materialRate!.value)} − ${fmt(scrapWt, 3)} kg × ₹${fmt(scrapRate)}`,
      amount: material,
    });

    let conversion = 0;
    for (const op of ops) {
      const hr = opRates.get(op.workCentreCode)!.value;
      const amount = round2((op.cycleMin / 60) * hr + (op.setupMin / 60) * hr / lotSize);
      conversion += amount;
      lines.push({
        key: `op-${op.seq}`,
        label: `Op ${op.seq} · ${op.workCentreCode}`,
        formula: `${fmt(op.cycleMin, 2)} min ÷ 60 × ₹${fmt(hr)}/h + setup ${fmt(op.setupMin, 0)} min over lot of ${fmt(lotSize, 0)}`,
        amount,
      });
    }
    conversion = round2(conversion);

    const overhead = round2((conversion * overheadPct!.value) / 100);
    lines.push({
      key: "overhead",
      label: "Overhead on conversion",
      formula: `₹${fmt(conversion)} × ${fmt(overheadPct!.value, 1)}%`,
      amount: overhead,
    });

    const tooling = round2(inputs.toolingCost / (volume * toolingYears!.value));
    if (inputs.toolingCost > 0) {
      lines.push({
        key: "tooling",
        label: "Tooling amortisation",
        formula: `₹${fmt(inputs.toolingCost, 0)} ÷ (${fmt(volume, 0)} pcs × ${fmt(toolingYears!.value, 0)} yr)`,
        amount: tooling,
      });
    }

    const packing = round2(inputs.packingPerUnit);
    lines.push({ key: "packing", label: "Packing", formula: "per piece", amount: packing });

    const freight = round2(inputs.grossWtKg * freightPerKg!.value);
    lines.push({
      key: "freight",
      label: "Freight",
      formula: `${fmt(inputs.grossWtKg, 3)} kg × ₹${fmt(freightPerKg!.value)}/kg`,
      amount: freight,
    });

    const cost = round2(
      lines.reduce((sum, l) => sum + l.amount, 0),
    );
    const price = round2(cost / (1 - inputs.marginPct / 100));
    const gst = round2((price * gstPct!.value) / 100);
    return {
      volume,
      lotSize: Math.round(lotSize),
      lines,
      cost,
      price,
      gst,
      priceInclGst: round2(price + gst),
      annualValue: round2(price * volume),
    };
  });

  const base = tiers.find((t) => t.volume === inputs.annualVolume)!;
  return {
    tiers,
    base,
    annualValue: base.annualValue,
    ratesUsed: [...used.values()].sort((a, b) => a.id - b.id),
    warnings,
  };
}

/** Quotes strictly above the threshold need the sales head's approval. */
export function needsApproval(annualValue: number, threshold: number): boolean {
  return annualValue > threshold;
}

/** Default price tiers around the annual volume: half, base, one and a half times, rounded to 100. */
export function defaultTiers(annualVolume: number): number[] {
  const r = (n: number) => Math.max(100, Math.round(n / 100) * 100);
  const set = new Set([r(annualVolume * 0.5), annualVolume, r(annualVolume * 1.5)]);
  return [...set].sort((a, b) => a - b);
}
