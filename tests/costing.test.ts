import { describe, expect, it } from "vitest";
import {
  CostingError,
  composition,
  computeCost,
  defaultTiers,
  needsApproval,
  rateAt,
  type CostInputs,
  type RateRow,
} from "../src/lib/costing";

let nextId = 1;
const row = (
  kind: RateRow["kind"],
  code: string,
  value: number,
  effective_from = "2026-04-01",
): RateRow => ({ id: nextId++, kind, code, label: code, unit: "u", value, effective_from });

function rateBook(): RateRow[] {
  nextId = 1;
  return [
    row("material", "EN8", 70),
    row("material", "EN8-SCRAP", 28),
    row("work_centre", "TURN-STD", 850),
    row("param", "OVERHEAD_PCT", 15),
    row("param", "FREIGHT_PER_KG", 3),
    row("param", "GST_PCT", 18),
    row("param", "LOT_MONTHS", 1),
    row("param", "TOOLING_YEARS", 3),
  ];
}

const spindle: CostInputs = {
  pricingDate: "2026-11-07",
  materialCode: "EN8",
  grossWtKg: 0.61,
  netWtKg: 0.5,
  annualVolume: 180000,
  volumes: [90000, 180000, 270000],
  toolingCost: 0,
  packingPerUnit: 2,
  marginPct: 12,
  ops: [{ seq: 1, workCentreCode: "TURN-STD", cycleMin: 3.2, setupMin: 60 }],
};

describe("computeCost", () => {
  it("matches a hand-worked unit cost for the spindle", () => {
    const { base } = computeCost(spindle, rateBook());
    const byKey = Object.fromEntries(base.lines.map((l) => [l.key, l.amount]));
    // 0.61 x 70 - 0.11 x 28 = 39.62
    expect(byKey.material).toBe(39.62);
    // 3.2/60 x 850 = 45.3333 + (60/60 x 850) / 15000 lot = 0.0567 -> 45.39
    expect(byKey["op-1"]).toBe(45.39);
    expect(byKey.overhead).toBe(6.81);
    expect(byKey.freight).toBe(1.83);
    expect(base.cost).toBe(95.65);
    // 95.65 / 0.88
    expect(base.price).toBe(108.69);
    expect(base.gst).toBe(19.56);
    expect(base.priceInclGst).toBe(128.25);
    expect(base.annualValue).toBe(19564200);
  });

  it("always prints a breakup that adds up to the cost", () => {
    const { tiers } = computeCost(spindle, rateBook());
    for (const t of tiers) {
      const sum = t.lines.reduce((s, l) => s + l.amount, 0);
      expect(Math.round(sum * 100)).toBe(Math.round(t.cost * 100));
    }
  });

  it("prices lower volumes higher because setup and tooling spread over fewer pieces", () => {
    const withTooling = { ...spindle, toolingCost: 600000, volumes: [20000, 60000, 180000] };
    const { tiers } = computeCost(withTooling, rateBook());
    expect(tiers.map((t) => t.volume)).toEqual([20000, 60000, 180000]);
    expect(tiers[0].price).toBeGreaterThan(tiers[1].price);
    expect(tiers[1].price).toBeGreaterThan(tiers[2].price);
  });

  it("adds the annual volume as a tier if the caller left it out", () => {
    const { tiers, base } = computeCost({ ...spindle, volumes: [50000] }, rateBook());
    expect(tiers.map((t) => t.volume)).toEqual([50000, 180000]);
    expect(base.volume).toBe(180000);
  });

  it("values scrap at zero and warns when there is no scrap rate", () => {
    const rates = rateBook().filter((r) => r.code !== "EN8-SCRAP");
    const result = computeCost(spindle, rates);
    expect(result.warnings[0]).toMatch(/scrap/i);
    expect(result.base.lines[0].amount).toBe(42.7);
  });
});

describe("rate masters with effective dates", () => {
  it("uses the rate in force on the pricing date, so old quotes keep old rates", () => {
    const rates = [...rateBook(), row("material", "EN8", 80, "2026-12-01")];
    const oldQuote = computeCost({ ...spindle, pricingDate: "2026-11-15" }, rates);
    const newQuote = computeCost({ ...spindle, pricingDate: "2026-12-05" }, rates);
    expect(oldQuote.base.lines[0].amount).toBe(39.62);
    expect(newQuote.base.lines[0].amount).toBe(0.61 * 80 - 0.11 * 28);
    const oldEn8 = oldQuote.ratesUsed.find((r) => r.code === "EN8")!;
    const newEn8 = newQuote.ratesUsed.find((r) => r.code === "EN8")!;
    expect(oldEn8.value).toBe(70);
    expect(newEn8.value).toBe(80);
    expect(oldEn8.id).not.toBe(newEn8.id);
  });

  it("does not use a rate that starts after the pricing date", () => {
    const rates = [row("material", "EN8", 99, "2027-01-01")];
    expect(rateAt(rates, "material", "EN8", "2026-12-31")).toBeUndefined();
    expect(rateAt(rates, "material", "EN8", "2027-01-01")?.value).toBe(99);
  });

  it("picks the latest of several rates on the same side of the date", () => {
    const rates = [
      row("material", "EN8", 60, "2026-01-01"),
      row("material", "EN8", 65, "2026-06-01"),
      row("material", "EN8", 70, "2026-09-01"),
    ];
    expect(rateAt(rates, "material", "EN8", "2026-07-15")?.value).toBe(65);
  });

  it("lists exactly the rate rows used, for traceability", () => {
    const { ratesUsed } = computeCost(spindle, rateBook());
    const codes = ratesUsed.map((r) => r.code).sort();
    expect(codes).toEqual(
      [
        "EN8",
        "EN8-SCRAP",
        "FREIGHT_PER_KG",
        "GST_PCT",
        "LOT_MONTHS",
        "OVERHEAD_PCT",
        "TOOLING_YEARS",
        "TURN-STD",
      ].sort(),
    );
  });
});

describe("validation", () => {
  it("rejects net weight above gross weight", () => {
    expect(() => computeCost({ ...spindle, netWtKg: 0.9 }, rateBook())).toThrow(CostingError);
  });

  it("reports every problem at once", () => {
    try {
      computeCost({ ...spindle, grossWtKg: 0, marginPct: 80, ops: [] }, rateBook());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CostingError);
      expect((e as CostingError).issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("names the missing rate instead of silently pricing at zero", () => {
    const rates = rateBook().filter((r) => r.code !== "TURN-STD");
    expect(() => computeCost(spindle, rates)).toThrow(/TURN-STD/);
  });

  it("refuses to price before a rate exists", () => {
    expect(() => computeCost({ ...spindle, pricingDate: "2025-01-01" }, rateBook())).toThrow(
      CostingError,
    );
  });
});

describe("approval rule", () => {
  it("needs approval only strictly above the threshold", () => {
    expect(needsApproval(2_500_000, 2_500_000)).toBe(false);
    expect(needsApproval(2_500_000.01, 2_500_000)).toBe(true);
    expect(needsApproval(19_564_200, 2_500_000)).toBe(true);
    expect(needsApproval(100, 2_500_000)).toBe(false);
  });
});

describe("defaultTiers", () => {
  it("gives half, base and one-and-a-half times, rounded to 100", () => {
    expect(defaultTiers(180000)).toEqual([90000, 180000, 270000]);
    expect(defaultTiers(24000)).toEqual([12000, 24000, 36000]);
  });
  it("never produces a tier below 100 or a duplicate", () => {
    const t = defaultTiers(120);
    expect(new Set(t).size).toBe(t.length);
    expect(t.every((v) => v >= 100)).toBe(true);
  });
});

describe("line traceability and composition", () => {
  it("records the rate rows behind every priced line", () => {
    const rates = rateBook();
    const { base, ratesUsed } = computeCost(spindle, rates);
    const byKey = Object.fromEntries(base.lines.map((l) => [l.key, l]));
    const code = (id: number) => ratesUsed.find((r) => r.id === id)!.code;
    expect(byKey.material.rateIds!.map(code)).toEqual(["EN8", "EN8-SCRAP"]);
    expect(byKey["op-1"].rateIds!.map(code)).toEqual(["TURN-STD"]);
    expect(byKey.overhead.rateIds!.map(code)).toEqual(["OVERHEAD_PCT"]);
    expect(byKey.freight.rateIds!.map(code)).toEqual(["FREIGHT_PER_KG"]);
    expect(byKey.packing.rateIds).toBeUndefined(); // an input, not a rate
  });

  it("splits the price into parts that add back up to it", () => {
    const { base } = computeCost({ ...spindle, toolingCost: 600000 }, rateBook());
    const parts = composition(base);
    expect(parts.map((p) => p.key)).toEqual(["material", "machining", "overhead", "tooling", "packing_freight", "margin"]);
    const total = parts.reduce((s, p) => s + p.amount, 0);
    expect(Math.round(total * 100)).toBe(Math.round(base.price * 100));
    expect(parts.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1, 6);
    expect(parts.find((p) => p.key === "margin")!.amount).toBe(Math.round((base.price - base.cost) * 100) / 100);
  });

  it("leaves out parts that are zero", () => {
    const { base } = computeCost({ ...spindle, packingPerUnit: 0, toolingCost: 0 }, rateBook());
    const keys = composition(base).map((p) => p.key);
    expect(keys).not.toContain("tooling");
    expect(keys).toContain("packing_freight"); // freight is still there
  });
});
