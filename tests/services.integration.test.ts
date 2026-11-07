/**
 * Integration tests against a real Postgres. They use their own database (quoteflow_test) on the
 * same server as DATABASE_URL, and are skipped with a clear message if no server is reachable.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RATES, RATE_DATE } from "../db/seed-data";

const baseUrl = process.env.DATABASE_URL ?? "postgres://quoteflow:quoteflow@localhost:54329/quoteflow";
const testUrl = baseUrl.replace(/\/[^/?]+(\?|$)/, "/quoteflow_test$1");
const adminUrl = baseUrl.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

let reachable = false;
try {
  const c = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 1500 });
  await c.connect();
  const has = await c.query("select 1 from pg_database where datname = 'quoteflow_test'");
  if (has.rowCount === 0) await c.query("create database quoteflow_test");
  await c.end();
  reachable = true;
} catch {
  console.warn("Postgres not reachable: skipping integration tests. Start it with npm run db:local:start");
}

type Svc = typeof import("../src/lib/services");
type Db = typeof import("../src/lib/db");
let svc: Svc;
let db: Db;
let estimator = 0;
let estimator2 = 0;
let salesHead = 0;

describe.skipIf(!reachable)("services (real database)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    const admin = new Client({ connectionString: testUrl });
    await admin.connect();
    await admin.query("drop schema public cascade; create schema public;");
    await admin.query(readFileSync(join(__dirname, "../db/schema.sql"), "utf8"));
    await admin.end();
    svc = await import("../src/lib/services");
    db = await import("../src/lib/db");
  });

  afterAll(async () => {
    await db?.pool().end();
  });

  beforeEach(async () => {
    await db.query(
      `truncate activity, quote_lines, quotes, costings, routing_ops, parts, rfqs, rate_items, past_parts, users restart identity cascade`,
    );
    const mk = async (email: string, role: string) =>
      (await db.queryOne<{ id: number }>("insert into users (email,name,role,password_hash) values ($1,$1,$2,'x') returning id", [email, role]))!.id;
    estimator = await mk("e1@test", "estimator");
    estimator2 = await mk("e2@test", "estimator");
    salesHead = await mk("sh@test", "sales_head");
    for (const r of RATES.filter((x) => !x.from)) {
      await db.query(
        "insert into rate_items (kind, code, label, unit, value, effective_from, created_by) values ($1,$2,$3,$4,$5,$6,$7)",
        [r.kind, r.code, r.label, r.unit, r.value, RATE_DATE, salesHead],
      );
    }
  });

  const bigPart = {
    name: "Rear wheel spindle",
    materialCode: "EN8",
    grossWtKg: 0.61,
    netWtKg: 0.52,
    annualVolume: 180000,
    packingPerUnit: 1.8,
    ops: [{ workCentreCode: "TURN-STD", cycleMin: 3.2, setupMin: 45 }],
  };
  const smallPart = {
    name: "Spacer bush",
    materialCode: "EN8",
    grossWtKg: 0.09,
    netWtKg: 0.07,
    annualVolume: 12000,
    ops: [{ workCentreCode: "TURN-STD", cycleMin: 0.8, setupMin: 20 }],
  };

  async function costedRfq(part: typeof bigPart | typeof smallPart) {
    const rfqId = await svc.createRfq(estimator, { customer: "Company B", dueOn: "2099-01-01", parts: [part] });
    const [p] = await svc.getParts(rfqId);
    await svc.savePartAndCosting(estimator, p.id, { ...part, acceptedKeys: [] });
    return { rfqId, partId: p.id };
  }

  it("a freshly saved costing is current, and goes stale when an input changes", async () => {
    const { rfqId, partId } = await costedRfq(bigPart); // regression: jsonb reorders keys
    let [part] = await svc.getParts(rfqId);
    const costing = (await svc.latestCostings([partId])).get(partId);
    expect(svc.costState(part, costing)).toBe("current");
    await svc.updatePart(estimator, partId, { ...bigPart, grossWtKg: 0.7, netWtKg: 0.6 });
    [part] = await svc.getParts(rfqId);
    expect(svc.costState(part, costing)).toBe("stale");
  });

  it("canonical() ignores key order", () => {
    expect(svc.canonical({ a: 1, b: { d: 1, c: 2 } })).toBe(svc.canonical({ b: { c: 2, d: 1 }, a: 1 }));
    expect(svc.canonical({ a: [1, 2] })).not.toBe(svc.canonical({ a: [2, 1] }));
  });

  it("sends a quote above the limit for approval, and blocks self-approval", async () => {
    const { rfqId } = await costedRfq(bigPart);
    const quoteId = await svc.submitQuote(estimator, rfqId);
    const q = (await svc.getQuote(quoteId))!;
    expect(q.needs_approval).toBe(true);
    expect(q.status).toBe("pending_approval");
    expect((await svc.getRfq(rfqId))!.status).toBe("pending_approval");
    await expect(svc.decideQuote(estimator, quoteId, "approve", "")).rejects.toThrow(/cannot approve a quote you submitted/);
    await expect(svc.sendQuote(salesHead, quoteId)).rejects.toThrow(/approved/);
    await svc.decideQuote(salesHead, quoteId, "approve", "ok");
    await svc.sendQuote(estimator, quoteId);
    expect((await svc.getRfq(rfqId))!.status).toBe("sent");
    await svc.recordOutcome(estimator, rfqId, "won", "");
    expect((await svc.getRfq(rfqId))!.status).toBe("won");
  });

  it("auto-approves a quote at or below the limit", async () => {
    const { rfqId } = await costedRfq(smallPart);
    const quoteId = await svc.submitQuote(estimator, rfqId);
    const q = (await svc.getQuote(quoteId))!;
    expect(q.needs_approval).toBe(false);
    expect(q.status).toBe("approved");
    expect(q.annual_value).toBeLessThan(2_500_000);
  });

  it("requires a reason to send back or to mark lost", async () => {
    const { rfqId } = await costedRfq(bigPart);
    const quoteId = await svc.submitQuote(estimator, rfqId);
    await expect(svc.decideQuote(salesHead, quoteId, "reject", " ")).rejects.toThrow(/reason/);
    await svc.decideQuote(salesHead, quoteId, "reject", "margin too thin");
    const rfq = (await svc.getRfq(rfqId))!;
    expect(rfq.status).toBe("estimating");
    // a resubmission supersedes the rejected version
    const second = await svc.submitQuote(estimator, rfqId);
    expect((await svc.getQuote(second))!.version).toBe(2);
    await svc.decideQuote(salesHead, second, "approve", "");
    await svc.sendQuote(salesHead, second);
    await expect(svc.recordOutcome(estimator, rfqId, "lost", "")).rejects.toThrow(/reason/);
  });

  it("locks the RFQ while a quote is awaiting approval", async () => {
    const { rfqId, partId } = await costedRfq(bigPart);
    await svc.submitQuote(estimator, rfqId);
    await expect(svc.updatePart(estimator, partId, bigPart)).rejects.toThrow(/locked/);
    await expect(svc.saveCosting(estimator, partId)).rejects.toThrow(/locked/);
    await expect(svc.submitQuote(estimator, rfqId)).rejects.toThrow(/already awaiting/);
  });

  it("will not submit a quote with an uncosted part", async () => {
    const rfqId = await svc.createRfq(estimator, { customer: "Company B", dueOn: "2099-01-01", parts: [bigPart] });
    await expect(svc.submitQuote(estimator, rfqId)).rejects.toThrow(/not costed/);
  });

  it("blocks costing until pre-filled values are accepted", async () => {
    const rfqId = await svc.createRfq(estimator, {
      customer: "Company B",
      dueOn: "2099-01-01",
      parts: [{ ...bigPart, sources: { grossWtKg: { source: "email, line 7", accepted: false, confidence: 0.7 } } }],
    });
    const [p] = await svc.getParts(rfqId);
    await expect(svc.savePartAndCosting(estimator, p.id, { ...bigPart, acceptedKeys: [] })).rejects.toThrow(/Accept the pre-filled values/);
    await svc.savePartAndCosting(estimator, p.id, { ...bigPart, acceptedKeys: ["grossWtKg"] });
    expect((await svc.latestCostings([p.id])).get(p.id)).toBeTruthy();
  });

  it("requires acceptance of a suggested routing", async () => {
    const rfqId = await svc.createRfq(estimator, { customer: "Company B", dueOn: "2099-01-01", parts: [bigPart] });
    const [p] = await svc.getParts(rfqId);
    const suggested = { ...bigPart, ops: [{ ...bigPart.ops[0], suggestedFrom: "Q-2502 Rear wheel spindle" }] };
    await expect(svc.savePartAndCosting(estimator, p.id, { ...suggested, acceptedKeys: [] })).rejects.toThrow(/Accept the suggested routing/);
    await svc.savePartAndCosting(estimator, p.id, { ...suggested, acceptedKeys: ["routing"] });
    const [saved] = await svc.getParts(rfqId);
    expect(saved.ops[0].suggested_from).toBe("Q-2502 Rear wheel spindle");
    expect(saved.sources.routing.accepted).toBe(true);
  });

  it("keeps the rates a quote was priced with when a new rate is added later", async () => {
    const { partId } = await costedRfq(bigPart);
    const before = (await svc.latestCostings([partId])).get(partId)!;
    const en8 = before.result.ratesUsed.find((r) => r.code === "EN8")!;
    const tomorrow = (await db.queryOne<{ d: string }>("select (current_date + 1)::text as d"))!.d;
    await svc.addRate(salesHead, { kind: "material", code: "EN8", label: "EN8 round bar", unit: "₹/kg", value: 95, effectiveFrom: tomorrow });
    const after = (await svc.latestCostings([partId])).get(partId)!;
    expect(after.id).toBe(before.id);
    expect(after.result.ratesUsed.find((r) => r.code === "EN8")!.id).toBe(en8.id);
    expect(after.result.base.price).toBe(before.result.base.price);
    // a re-save today still prices at today's rate, because tomorrow's has not started
    await svc.saveCosting(estimator, partId);
    const resaved = (await svc.latestCostings([partId])).get(partId)!;
    expect(resaved.version).toBe(2);
    expect(resaved.result.ratesUsed.find((r) => r.code === "EN8")!.value).toBe(72);
  });

  it("refuses back-dated and duplicate-dated rates, and unknown parameters", async () => {
    await expect(
      svc.addRate(salesHead, { kind: "material", code: "EN8", label: "x", unit: "u", value: 1, effectiveFrom: "2020-01-01" }),
    ).rejects.toThrow(/past/);
    const today = await svc.today();
    await expect(
      svc.addRate(salesHead, { kind: "material", code: "EN8", label: "x", unit: "u", value: 1, effectiveFrom: RATE_DATE }),
    ).rejects.toThrow(/past|already/);
    await expect(
      svc.addRate(salesHead, { kind: "param", code: "MADE_UP", label: "x", unit: "u", value: 1, effectiveFrom: today }),
    ).rejects.toThrow(/Unknown commercial parameter/);
  });

  it("ranks similar past parts by material, weight and name", async () => {
    await db.query(
      `insert into past_parts (customer, part_name, material_code, gross_wt_kg, annual_volume, quoted_on, quoted_price, outcome, quote_ref)
       values ('c','Rear wheel spindle','EN8',0.62,100000,current_date,100,'won','Q-1'),
              ('c','Gear blank','20MnCr5',1.5,100000,current_date,200,'won','Q-2'),
              ('c','Front axle spindle','EN8',0.9,100000,current_date,120,'lost','Q-3')`,
    );
    const hits = await svc.searchPast({ similarTo: { name: "Rear wheel spindle", materialCode: "EN8", grossWtKg: 0.61 }, limit: 3 });
    expect(hits.map((h) => h.quote_ref)).toEqual(["Q-1", "Q-3", "Q-2"]);
    expect(hits[0].score!).toBeGreaterThan(0.9);
  });

  it("imports 1,400 past quotes from a sheet quickly, and reports the rows it cannot read", async () => {
    const header = ["Quote Ref", "Date", "Customer", "Part", "Material", "Gross Wt kg", "Annual Volume", "Price", "Outcome"];
    const rows: string[][] = [header];
    for (let i = 1; i <= 1400; i++)
      rows.push([`Q-${i}`, "2025-06-01", "Company B", `Part ${i}`, "EN8", String(0.2 + (i % 50) / 100), String(10000 + i), String(50 + (i % 40)), i % 3 ? "won" : "lost"]);
    rows.push(["Q-bad", "2025-06-01", "Company B", "", "EN8", "1", "1", "1", "won"]); // no part name
    rows.push(["Q-bad2", "2025-06-01", "Company B", "Broken", "EN8", "abc", "1", "1", "won"]); // bad weight
    const t0 = Date.now();
    const res = await svc.importPastQuotes(estimator, rows);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(res.imported).toBe(1400);
    expect(res.skipped.map((s) => s.row)).toEqual([1402, 1403]);
    const n = await db.queryOne<{ n: number }>("select count(*) as n from past_parts");
    expect(n!.n).toBe(1400);
  });

  it("refuses an import that lacks the essential columns", async () => {
    const res = await svc.importPastQuotes(estimator, [["Part", "Price"], ["x", "1"]]);
    expect(res.imported).toBe(0);
    expect(res.missingColumns).toEqual(expect.arrayContaining(["material_code", "gross_wt_kg", "annual_volume"]));
  });

  it("numbers RFQs in sequence within the month", async () => {
    const a = await svc.createRfq(estimator, { customer: "A", dueOn: "2099-01-01", parts: [smallPart] });
    const b = await svc.createRfq(estimator2, { customer: "B", dueOn: "2099-01-01", parts: [smallPart] });
    const [ra, rb] = [await svc.getRfq(a), await svc.getRfq(b)];
    expect(ra!.rfq_no).toMatch(/^RFQ-\d{4}-001$/);
    expect(rb!.rfq_no).toMatch(/^RFQ-\d{4}-002$/);
  });
});
