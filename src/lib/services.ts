/**
 * Business logic and data access. No Next.js imports, so it can be used from scripts and tests.
 * Callers (server actions) are responsible for authentication and role checks, and pass the
 * acting user's id in.
 */
import type { PoolClient } from "pg";
import {
  computeCost,
  CostingError,
  defaultTiers,
  needsApproval,
  PARAM,
  rateAt,
  type CostInputs,
  type CostResult,
  type RateRow,
} from "./costing";
import { query, queryOne, tx } from "./db";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// ---------- types ----------

export type RfqStatus = "estimating" | "pending_approval" | "approved" | "sent" | "won" | "lost";

export interface Rfq {
  id: number;
  rfq_no: string;
  customer: string;
  received_on: string;
  due_on: string;
  owner_id: number | null;
  owner_name: string | null;
  status: RfqStatus;
  lost_reason: string | null;
  source_text: string | null;
}

export interface FieldSource {
  source: string;
  accepted: boolean;
  confidence?: number;
}

export interface Op {
  id: number;
  seq: number;
  work_centre_code: string;
  cycle_min: number;
  setup_min: number;
  suggested_from: string | null;
}

export interface Part {
  id: number;
  rfq_id: number;
  line_no: number;
  name: string;
  material_code: string;
  gross_wt_kg: number;
  net_wt_kg: number;
  annual_volume: number;
  tooling_cost: number;
  packing_per_unit: number;
  margin_pct: number;
  volumes: number[];
  sources: Record<string, FieldSource>;
  ops: Op[];
}

export interface Costing {
  id: number;
  part_id: number;
  version: number;
  pricing_date: string;
  inputs: CostInputs;
  result: CostResult;
  created_at: string;
  created_by_name: string | null;
}

export type CostState = "none" | "stale" | "current";

export interface Quote {
  id: number;
  rfq_id: number;
  version: number;
  quote_no: string;
  status: "pending_approval" | "approved" | "rejected" | "sent" | "superseded";
  annual_value: number;
  needs_approval: boolean;
  submitted_by: number | null;
  submitted_by_name: string | null;
  submitted_at: string;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  sent_at: string | null;
}

// ---------- helpers ----------

export async function today(): Promise<string> {
  return (await queryOne<{ d: string }>("select current_date::text as d"))!.d;
}

export async function loadRates(): Promise<RateRow[]> {
  return query<RateRow>(
    "select id, kind, code, label, unit, value, effective_from from rate_items order by id",
  );
}

async function log(
  c: PoolClient,
  rfqId: number | null,
  userId: number | null,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await c.query("insert into activity (rfq_id, user_id, action, detail) values ($1,$2,$3,$4)", [
    rfqId,
    userId,
    action,
    JSON.stringify(detail),
  ]);
}

export function inputsForPart(part: Part, pricingDate: string): CostInputs {
  return {
    pricingDate,
    materialCode: part.material_code,
    grossWtKg: part.gross_wt_kg,
    netWtKg: part.net_wt_kg,
    annualVolume: part.annual_volume,
    volumes: part.volumes,
    toolingCost: part.tooling_cost,
    packingPerUnit: part.packing_per_unit,
    marginPct: part.margin_pct,
    ops: part.ops.map((o) => ({
      seq: o.seq,
      workCentreCode: o.work_centre_code,
      cycleMin: o.cycle_min,
      setupMin: o.setup_min,
    })),
  };
}

/** A saved costing is "stale" if the part's inputs changed after it was saved. */
export function costState(part: Part, costing: Costing | undefined): CostState {
  if (!costing) return "none";
  const now = inputsForPart(part, costing.pricing_date);
  return JSON.stringify(now) === JSON.stringify(costing.inputs) ? "current" : "stale";
}

// ---------- RFQs ----------

export interface RfqRow extends Rfq {
  part_count: number;
  quote_value: number | null;
  quote_status: Quote["status"] | null;
  days_to_due: number;
}

export async function listRfqs(opts: { status?: string; q?: string; mine?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status && opts.status !== "all") {
    params.push(opts.status);
    where.push(`r.status = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q}%`);
    where.push(
      `(r.rfq_no ilike $${params.length} or r.customer ilike $${params.length}
        or exists (select 1 from parts p where p.rfq_id = r.id and p.name ilike $${params.length}))`,
    );
  }
  if (opts.mine) {
    params.push(opts.mine);
    where.push(`r.owner_id = $${params.length}`);
  }
  return query<RfqRow>(
    `select r.id, r.rfq_no, r.customer, r.received_on, r.due_on, r.owner_id, u.name as owner_name,
            r.status, r.lost_reason, r.source_text,
            (select count(*) from parts p where p.rfq_id = r.id) as part_count,
            q.annual_value as quote_value, q.status as quote_status,
            (r.due_on - current_date) as days_to_due
       from rfqs r
       left join users u on u.id = r.owner_id
       left join lateral (
         select annual_value, status from quotes
          where rfq_id = r.id and status <> 'superseded' order by version desc limit 1
       ) q on true
      ${where.length ? "where " + where.join(" and ") : ""}
      order by (r.status in ('won','lost')), r.due_on asc, r.id desc`,
    params,
  );
}

export async function getRfq(id: number): Promise<Rfq | undefined> {
  return queryOne<Rfq>(
    `select r.id, r.rfq_no, r.customer, r.received_on, r.due_on, r.owner_id, u.name as owner_name,
            r.status, r.lost_reason, r.source_text
       from rfqs r left join users u on u.id = r.owner_id where r.id = $1`,
    [id],
  );
}

export async function getParts(rfqId: number): Promise<Part[]> {
  const parts = await query<Omit<Part, "ops">>(
    "select * from parts where rfq_id = $1 order by line_no",
    [rfqId],
  );
  if (parts.length === 0) return [];
  const ops = await query<Op & { part_id: number }>(
    "select * from routing_ops where part_id = any($1) order by seq",
    [parts.map((p) => p.id)],
  );
  return parts.map((p) => ({ ...p, ops: ops.filter((o) => o.part_id === p.id) }));
}

export async function getPart(partId: number): Promise<Part | undefined> {
  const p = await queryOne<{ rfq_id: number }>("select rfq_id from parts where id = $1", [partId]);
  if (!p) return undefined;
  return (await getParts(p.rfq_id)).find((x) => x.id === partId);
}

export async function latestCostings(partIds: number[]): Promise<Map<number, Costing>> {
  if (partIds.length === 0) return new Map();
  const rows = await query<Costing>(
    `select distinct on (c.part_id) c.id, c.part_id, c.version, c.pricing_date, c.inputs, c.result,
            c.created_at, u.name as created_by_name
       from costings c left join users u on u.id = c.created_by
      where c.part_id = any($1) order by c.part_id, c.version desc`,
    [partIds],
  );
  return new Map(rows.map((r) => [r.part_id, r]));
}

export async function costingHistory(partId: number): Promise<Costing[]> {
  return query<Costing>(
    `select c.id, c.part_id, c.version, c.pricing_date, c.inputs, c.result, c.created_at,
            u.name as created_by_name
       from costings c left join users u on u.id = c.created_by
      where c.part_id = $1 order by c.version desc`,
    [partId],
  );
}

export interface NewPart {
  name: string;
  materialCode: string;
  grossWtKg: number;
  netWtKg: number;
  annualVolume: number;
  toolingCost?: number;
  packingPerUnit?: number;
  marginPct?: number;
  volumes?: number[];
  sources?: Record<string, FieldSource>;
  /** Field keys the estimator explicitly accepted or edited in this save. */
  acceptedKeys?: string[];
  ops?: { workCentreCode: string; cycleMin: number; setupMin: number; suggestedFrom?: string | null }[];
}

async function insertPart(c: PoolClient, rfqId: number, lineNo: number, p: NewPart) {
  const res = await c.query(
    `insert into parts (rfq_id, line_no, name, material_code, gross_wt_kg, net_wt_kg, annual_volume,
       tooling_cost, packing_per_unit, margin_pct, volumes, sources)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [
      rfqId,
      lineNo,
      p.name,
      p.materialCode,
      p.grossWtKg,
      p.netWtKg,
      p.annualVolume,
      p.toolingCost ?? 0,
      p.packingPerUnit ?? 0,
      p.marginPct ?? 12,
      normaliseTiers(p.annualVolume, p.volumes),
      JSON.stringify(p.sources ?? {}),
    ],
  );
  const partId = res.rows[0].id as number;
  let seq = 1;
  for (const op of p.ops ?? []) {
    await c.query(
      `insert into routing_ops (part_id, seq, work_centre_code, cycle_min, setup_min, suggested_from)
       values ($1,$2,$3,$4,$5,$6)`,
      [partId, seq++, op.workCentreCode, op.cycleMin, op.setupMin, op.suggestedFrom ?? null],
    );
  }
  return partId;
}

export async function nextRfqNo(c: PoolClient | null = null): Promise<string> {
  const ym = (await queryOne<{ ym: string }>("select to_char(current_date, 'YYMM') as ym"))!.ym;
  const run = c ? (q: string, p: unknown[]) => c.query(q, p).then((r) => r.rows[0]) : queryOne;
  const last = (await run(
    "select max(substring(rfq_no from '[0-9]+$')::int) as n from rfqs where rfq_no like $1",
    [`RFQ-${ym}-%`],
  )) as { n: number | null };
  return `RFQ-${ym}-${String((last?.n ?? 0) + 1).padStart(3, "0")}`;
}

export async function createRfq(
  userId: number,
  input: { customer: string; dueOn: string; sourceText?: string; parts: NewPart[]; via?: string },
): Promise<number> {
  if (input.parts.length === 0) throw new DomainError("Add at least one part");
  return tx(async (c) => {
    const rfqNo = await nextRfqNo(c);
    const r = await c.query(
      `insert into rfqs (rfq_no, customer, due_on, owner_id, source_text)
       values ($1,$2,$3,$4,$5) returning id`,
      [rfqNo, input.customer, input.dueOn, userId, input.sourceText ?? null],
    );
    const rfqId = r.rows[0].id as number;
    let line = 1;
    for (const p of input.parts) await insertPart(c, rfqId, line++, p);
    await log(c, rfqId, userId, "rfq.created", { via: input.via ?? "manual", parts: input.parts.length });
    return rfqId;
  });
}

export async function addPart(userId: number, rfqId: number, p: NewPart): Promise<number> {
  const rfq = await getRfq(rfqId);
  if (!rfq) throw new DomainError("RFQ not found");
  if (["pending_approval", "sent", "won", "lost"].includes(rfq.status))
    throw new DomainError("This RFQ is locked: its quote is awaiting approval or already sent");
  return tx(async (c) => {
    const n = await c.query("select coalesce(max(line_no),0)+1 as n from parts where rfq_id = $1", [rfqId]);
    const partId = await insertPart(c, rfqId, n.rows[0].n, p);
    await log(c, rfqId, userId, "part.added", { partId, name: p.name });
    return partId;
  });
}

export async function updatePart(userId: number, partId: number, p: NewPart): Promise<void> {
  await tx(async (c) => {
    const cur = await c.query("select rfq_id, sources from parts where id = $1 for update", [partId]);
    if (cur.rowCount === 0) throw new DomainError("Part not found");
    const rfq = await c.query("select status from rfqs where id = $1", [cur.rows[0].rfq_id]);
    if (["pending_approval", "sent", "won", "lost"].includes(rfq.rows[0].status))
      throw new DomainError("This RFQ is locked: its quote is awaiting approval or already sent");
    // A pre-filled value only counts as accepted once the estimator accepted or edited it.
    const sources: Record<string, FieldSource> = { ...(cur.rows[0].sources ?? {}) };
    for (const k of Object.keys(sources)) {
      sources[k] = { ...sources[k], accepted: sources[k].accepted || (p.acceptedKeys ?? []).includes(k) };
    }
    const suggested = (p.ops ?? []).find((o) => o.suggestedFrom);
    if (suggested) {
      if (!(p.acceptedKeys ?? []).includes("routing"))
        throw new DomainError("Accept the suggested routing, or edit it, before saving");
      sources.routing = { source: `suggested from past part ${suggested.suggestedFrom}`, accepted: true };
    }
    await c.query(
      `update parts set name=$2, material_code=$3, gross_wt_kg=$4, net_wt_kg=$5, annual_volume=$6,
         tooling_cost=$7, packing_per_unit=$8, margin_pct=$9, volumes=$10, sources=$11 where id=$1`,
      [
        partId,
        p.name,
        p.materialCode,
        p.grossWtKg,
        p.netWtKg,
        p.annualVolume,
        p.toolingCost ?? 0,
        p.packingPerUnit ?? 0,
        p.marginPct ?? 12,
        normaliseTiers(p.annualVolume, p.volumes),
        JSON.stringify(sources),
      ],
    );
    await c.query("delete from routing_ops where part_id = $1", [partId]);
    let seq = 1;
    for (const op of p.ops ?? []) {
      await c.query(
        `insert into routing_ops (part_id, seq, work_centre_code, cycle_min, setup_min, suggested_from)
         values ($1,$2,$3,$4,$5,$6)`,
        [partId, seq++, op.workCentreCode, op.cycleMin, op.setupMin, op.suggestedFrom ?? null],
      );
    }
    await log(c, cur.rows[0].rfq_id, userId, "part.updated", { partId, name: p.name });
  });
}

/** 1 to 3 distinct positive tiers that always include the annual volume. */
export function normaliseTiers(annualVolume: number, volumes?: number[]): number[] {
  if (!volumes || volumes.length === 0) return defaultTiers(annualVolume);
  const set = new Set(volumes.filter((v) => Number.isInteger(v) && v > 0));
  set.add(annualVolume);
  const tiers = [...set].sort((x, y) => x - y);
  if (tiers.length > 3) throw new DomainError("Use at most 3 volume tiers, including the annual volume");
  return tiers;
}

/** Validate and price first, so nothing is saved if the numbers do not hold together. */
export async function savePartAndCosting(userId: number, partId: number, p: NewPart): Promise<Costing> {
  const rates = await loadRates();
  const pricingDate = await today();
  computeCost(
    {
      pricingDate,
      materialCode: p.materialCode,
      grossWtKg: p.grossWtKg,
      netWtKg: p.netWtKg,
      annualVolume: p.annualVolume,
      volumes: normaliseTiers(p.annualVolume, p.volumes),
      toolingCost: p.toolingCost ?? 0,
      packingPerUnit: p.packingPerUnit ?? 0,
      marginPct: p.marginPct ?? 12,
      ops: (p.ops ?? []).map((o, i) => ({
        seq: i + 1,
        workCentreCode: o.workCentreCode,
        cycleMin: o.cycleMin,
        setupMin: o.setupMin,
      })),
    },
    rates,
  );
  await updatePart(userId, partId, p);
  return saveCosting(userId, partId);
}

// ---------- costing ----------

export async function saveCosting(userId: number, partId: number): Promise<Costing> {
  const part = await getPart(partId);
  if (!part) throw new DomainError("Part not found");
  const rfq = await getRfq(part.rfq_id);
  if (rfq && ["pending_approval", "sent", "won", "lost"].includes(rfq.status))
    throw new DomainError("This RFQ is locked: its quote is awaiting approval or already sent");
  const unaccepted = Object.entries(part.sources).filter(([, s]) => !s.accepted);
  if (unaccepted.length > 0)
    throw new DomainError(
      `Accept the pre-filled values first: ${unaccepted.map(([k]) => k).join(", ")}`,
    );
  const pricingDate = await today();
  const inputs = inputsForPart(part, pricingDate);
  const result = computeCost(inputs, await loadRates());
  await tx(async (c) => {
    const v = await c.query(
      "select coalesce(max(version), 0) + 1 as v from costings where part_id = $1",
      [partId],
    );
    await c.query(
      `insert into costings (part_id, version, pricing_date, inputs, result, rates_used, created_by)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        partId,
        v.rows[0].v,
        pricingDate,
        JSON.stringify(inputs),
        JSON.stringify(result),
        JSON.stringify(result.ratesUsed),
        userId,
      ],
    );
    await log(c, part.rfq_id, userId, "costing.saved", {
      partId,
      version: v.rows[0].v,
      annualValue: result.annualValue,
    });
  });
  return (await latestCostings([partId])).get(partId)!;
}

// ---------- quotes ----------

export async function approvalThreshold(date?: string): Promise<number> {
  const rates = await loadRates();
  const row = rateAt(rates, "param", PARAM.APPROVAL_THRESHOLD, date ?? (await today()));
  if (!row) throw new DomainError("Approval threshold is not set in the rate masters");
  return row.value;
}

export async function getQuotes(rfqId: number): Promise<Quote[]> {
  return query<Quote>(
    `select q.*, s.name as submitted_by_name, d.name as decided_by_name
       from quotes q
       left join users s on s.id = q.submitted_by
       left join users d on d.id = q.decided_by
      where q.rfq_id = $1 order by q.version desc`,
    [rfqId],
  );
}

export async function getQuote(quoteId: number): Promise<Quote | undefined> {
  return queryOne<Quote>(
    `select q.*, s.name as submitted_by_name, d.name as decided_by_name
       from quotes q
       left join users s on s.id = q.submitted_by
       left join users d on d.id = q.decided_by
      where q.id = $1`,
    [quoteId],
  );
}

export interface QuoteLine {
  part: Part;
  costing: Costing;
}

export async function getQuoteLines(quoteId: number): Promise<QuoteLine[]> {
  const rows = await query<{ part_id: number; costing_id: number }>(
    "select part_id, costing_id from quote_lines where quote_id = $1 order by part_id",
    [quoteId],
  );
  const out: QuoteLine[] = [];
  for (const r of rows) {
    const part = await getPart(r.part_id);
    const costing = await queryOne<Costing>(
      `select c.id, c.part_id, c.version, c.pricing_date, c.inputs, c.result, c.created_at,
              u.name as created_by_name
         from costings c left join users u on u.id = c.created_by where c.id = $1`,
      [r.costing_id],
    );
    if (part && costing) out.push({ part, costing });
  }
  return out;
}

export async function pendingApprovals() {
  return query<
    Quote & { rfq_no: string; customer: string; part_count: number }
  >(
    `select q.*, r.rfq_no, r.customer, s.name as submitted_by_name,
            (select count(*) from quote_lines l where l.quote_id = q.id) as part_count
       from quotes q join rfqs r on r.id = q.rfq_id
       left join users s on s.id = q.submitted_by
      where q.status = 'pending_approval' order by q.submitted_at`,
  );
}

export async function submitQuote(userId: number, rfqId: number): Promise<number> {
  const rfq = await getRfq(rfqId);
  if (!rfq) throw new DomainError("RFQ not found");
  if (["pending_approval", "sent", "won", "lost"].includes(rfq.status))
    throw new DomainError("A quote is already awaiting approval or has been sent");
  const parts = await getParts(rfqId);
  if (parts.length === 0) throw new DomainError("This RFQ has no parts");
  const costings = await latestCostings(parts.map((p) => p.id));
  const problems: string[] = [];
  for (const p of parts) {
    const state = costState(p, costings.get(p.id));
    if (state === "none") problems.push(`${p.name}: not costed yet`);
    if (state === "stale") problems.push(`${p.name}: inputs changed since it was costed, save the costing again`);
  }
  if (problems.length) throw new DomainError(problems.join("; "));

  const annualValue = Math.round(
    parts.reduce((s, p) => s + costings.get(p.id)!.result.annualValue, 0) * 100,
  ) / 100;
  const threshold = await approvalThreshold();
  const needs = needsApproval(annualValue, threshold);

  return tx(async (c) => {
    await c.query(
      "update quotes set status = 'superseded' where rfq_id = $1 and status in ('pending_approval','approved','rejected')",
      [rfqId],
    );
    const v = await c.query("select coalesce(max(version),0)+1 as v from quotes where rfq_id = $1", [
      rfqId,
    ]);
    const version = v.rows[0].v as number;
    const quoteNo = `${rfq.rfq_no.replace("RFQ-", "Q-")}-v${version}`;
    const res = await c.query(
      `insert into quotes (rfq_id, version, quote_no, status, annual_value, needs_approval, submitted_by,
         decided_at, decision_note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [
        rfqId,
        version,
        quoteNo,
        needs ? "pending_approval" : "approved",
        annualValue,
        needs,
        userId,
        needs ? null : new Date(),
        needs ? null : `Within estimator authority (at or below ₹${threshold.toLocaleString("en-IN")} a year)`,
      ],
    );
    const quoteId = res.rows[0].id as number;
    for (const p of parts) {
      await c.query("insert into quote_lines (quote_id, part_id, costing_id) values ($1,$2,$3)", [
        quoteId,
        p.id,
        costings.get(p.id)!.id,
      ]);
    }
    await c.query("update rfqs set status = $2 where id = $1", [
      rfqId,
      needs ? "pending_approval" : "approved",
    ]);
    await log(c, rfqId, userId, needs ? "quote.submitted" : "quote.auto_approved", {
      quoteNo,
      annualValue,
      threshold,
    });
    return quoteId;
  });
}

export async function decideQuote(
  userId: number,
  quoteId: number,
  decision: "approve" | "reject",
  note: string,
): Promise<void> {
  const quote = await getQuote(quoteId);
  if (!quote) throw new DomainError("Quote not found");
  if (quote.status !== "pending_approval") throw new DomainError("This quote is not awaiting approval");
  if (quote.submitted_by === userId) throw new DomainError("You cannot approve a quote you submitted");
  if (decision === "reject" && note.trim().length < 3)
    throw new DomainError("Give a reason when sending a quote back");
  await tx(async (c) => {
    await c.query(
      `update quotes set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`,
      [quoteId, decision === "approve" ? "approved" : "rejected", userId, note.trim() || null],
    );
    await c.query("update rfqs set status = $2 where id = $1", [
      quote.rfq_id,
      decision === "approve" ? "approved" : "estimating",
    ]);
    await log(c, quote.rfq_id, userId, decision === "approve" ? "quote.approved" : "quote.rejected", {
      quoteNo: quote.quote_no,
      note: note.trim(),
    });
  });
}

export async function sendQuote(userId: number, quoteId: number): Promise<void> {
  const quote = await getQuote(quoteId);
  if (!quote) throw new DomainError("Quote not found");
  if (quote.status !== "approved") throw new DomainError("Only an approved quote can be sent");
  await tx(async (c) => {
    await c.query("update quotes set status = 'sent', sent_at = now() where id = $1", [quoteId]);
    await c.query("update rfqs set status = 'sent' where id = $1", [quote.rfq_id]);
    // Sending is mocked: no email leaves the system. The activity log records the intent.
    await log(c, quote.rfq_id, userId, "quote.sent", { quoteNo: quote.quote_no, mocked: true });
  });
}

export async function recordOutcome(
  userId: number,
  rfqId: number,
  outcome: "won" | "lost",
  reason: string,
): Promise<void> {
  const rfq = await getRfq(rfqId);
  if (!rfq) throw new DomainError("RFQ not found");
  if (rfq.status !== "sent") throw new DomainError("Only a sent quote can be marked won or lost");
  if (outcome === "lost" && reason.trim().length < 3) throw new DomainError("Give a reason for the loss");
  await tx(async (c) => {
    await c.query("update rfqs set status = $2, lost_reason = $3 where id = $1", [
      rfqId,
      outcome,
      outcome === "lost" ? reason.trim() : null,
    ]);
    await log(c, rfqId, userId, `rfq.${outcome}`, { reason: reason.trim() });
  });
}

export async function getActivity(rfqId: number) {
  return query<{ id: number; action: string; detail: Record<string, unknown>; created_at: string; user_name: string | null }>(
    `select a.id, a.action, a.detail, a.created_at, u.name as user_name
       from activity a left join users u on u.id = a.user_id
      where a.rfq_id = $1 order by a.created_at desc, a.id desc limit 30`,
    [rfqId],
  );
}

// ---------- rate masters ----------

export async function addRate(
  userId: number,
  r: { kind: RateRow["kind"]; code: string; label: string; unit: string; value: number; effectiveFrom: string },
): Promise<void> {
  const now = await today();
  if (r.effectiveFrom < now)
    throw new DomainError("A new rate cannot start in the past; existing quotes keep the rate they used");
  if (!(r.value >= 0)) throw new DomainError("Rate must be zero or more");
  if (r.kind === "param" && !Object.values(PARAM).includes(r.code as (typeof PARAM)[keyof typeof PARAM]))
    throw new DomainError("Unknown commercial parameter");
  const exists = await queryOne(
    "select 1 from rate_items where kind=$1 and code=$2 and effective_from=$3",
    [r.kind, r.code, r.effectiveFrom],
  );
  if (exists) throw new DomainError("A rate for that code already starts on that date; pick another date");
  await tx(async (c) => {
    await c.query(
      `insert into rate_items (kind, code, label, unit, value, effective_from, created_by)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [r.kind, r.code, r.label, r.unit, r.value, r.effectiveFrom, userId],
    );
    await log(c, null, userId, "rate.added", { code: r.code, value: r.value, from: r.effectiveFrom });
  });
}

// ---------- past quotes ----------

export interface PastPart {
  id: number;
  customer: string;
  part_name: string;
  material_code: string;
  gross_wt_kg: number;
  net_wt_kg: number | null;
  annual_volume: number;
  quoted_on: string;
  quoted_price: number;
  outcome: "won" | "lost" | "open";
  quote_ref: string;
  routing: { seq: number; workCentreCode: string; cycleMin: number; setupMin: number }[];
  score?: number;
}

/** Similarity: same material and a close weight matter most, name words add to it. */
export function similarity(
  target: { name: string; materialCode: string; grossWtKg: number },
  past: Pick<PastPart, "part_name" | "material_code" | "gross_wt_kg">,
): number {
  const material = target.materialCode === past.material_code ? 0.4 : 0;
  const ratio = Math.min(target.grossWtKg, past.gross_wt_kg) / Math.max(target.grossWtKg, past.gross_wt_kg);
  const weight = 0.35 * (ratio >= 1 ? 1 : ratio * ratio);
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const a = words(target.name);
  const b = words(past.part_name);
  const shared = [...a].filter((w) => b.has(w)).length;
  const name = a.size && b.size ? 0.25 * (shared / Math.max(a.size, b.size)) : 0;
  return Math.round((material + weight + name) * 100) / 100;
}

export async function searchPast(opts: {
  q?: string;
  material?: string;
  customer?: string;
  similarTo?: { name: string; materialCode: string; grossWtKg: number };
  limit?: number;
}): Promise<PastPart[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.q) {
    params.push(`%${opts.q}%`);
    where.push(`(part_name ilike $${params.length} or quote_ref ilike $${params.length})`);
  }
  if (opts.material) {
    params.push(opts.material);
    where.push(`material_code = $${params.length}`);
  }
  if (opts.customer) {
    params.push(`%${opts.customer}%`);
    where.push(`customer ilike $${params.length}`);
  }
  const rows = await query<PastPart>(
    `select * from past_parts ${where.length ? "where " + where.join(" and ") : ""}
      order by quoted_on desc limit 400`,
    params,
  );
  if (opts.similarTo) {
    const t = opts.similarTo;
    return rows
      .map((r) => ({ ...r, score: similarity(t, r) }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, opts.limit ?? 10);
  }
  return rows.slice(0, opts.limit ?? 100);
}

export async function distinctMaterials(): Promise<string[]> {
  return (await query<{ material_code: string }>("select distinct material_code from past_parts order by 1")).map(
    (r) => r.material_code,
  );
}

export interface ImportResult {
  imported: number;
  skipped: { row: number; reason: string }[];
  missingColumns: string[];
}

const PAST_COLS: Record<string, RegExp> = {
  part_name: /^(part|part name|description|item)\b/i,
  customer: /^(customer|client)\b/i,
  material_code: /^(material|grade)\b/i,
  gross_wt_kg: /\b(gross)\b.*\b(wt|weight)\b|^(gross|weight)\b/i,
  annual_volume: /\b(annual|volume|qty|quantity)\b/i,
  quoted_price: /\b(price|rate)\b/i,
  quoted_on: /\b(date|quoted on)\b/i,
  outcome: /^(outcome|status|result)\b/i,
  quote_ref: /\b(quote|ref|rfq)\b.*\b(no|ref|number)?\b/i,
};

/** Import past quotes from a sheet (first row = headings). Bad rows are skipped and reported. */
export async function importPastQuotes(userId: number, rows: string[][]): Promise<ImportResult> {
  const header = (rows[0] ?? []).map((h) => String(h).trim());
  const col: Record<string, number> = {};
  for (const [k, re] of Object.entries(PAST_COLS)) col[k] = header.findIndex((h, i) => re.test(h) && !Object.values(col).includes(i));
  const required = ["part_name", "material_code", "gross_wt_kg", "annual_volume", "quoted_price"];
  const missingColumns = required.filter((k) => col[k] === -1);
  if (missingColumns.length) return { imported: 0, skipped: [], missingColumns };

  const out = { part_name: [] as string[], customer: [] as string[], material_code: [] as string[], gross: [] as number[], vol: [] as number[], price: [] as number[], on: [] as string[], outcome: [] as string[], ref: [] as string[] };
  const skipped: ImportResult["skipped"] = [];
  const num = (v: string) => parseFloat(String(v ?? "").replace(/[₹,\s]/g, ""));
  const todayStr = await today();
  rows.slice(1).forEach((r, i) => {
    if (r.every((c) => String(c ?? "").trim() === "")) return;
    const at = (k: string) => (col[k] >= 0 ? String(r[col[k]] ?? "").trim() : "");
    const gross = num(at("gross_wt_kg"));
    const vol = Math.round(num(at("annual_volume")));
    const price = num(at("quoted_price"));
    if (!at("part_name")) return void skipped.push({ row: i + 2, reason: "no part name" });
    if (!(gross > 0) || !(vol > 0) || !(price > 0)) return void skipped.push({ row: i + 2, reason: "weight, volume or price is not a positive number" });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(at("quoted_on")) ? at("quoted_on") : todayStr;
    const outcome = ["won", "lost", "open"].includes(at("outcome").toLowerCase()) ? at("outcome").toLowerCase() : "open";
    out.part_name.push(at("part_name"));
    out.customer.push(at("customer") || "Unknown");
    out.material_code.push(at("material_code") || "UNKNOWN");
    out.gross.push(gross);
    out.vol.push(vol);
    out.price.push(price);
    out.on.push(date);
    out.outcome.push(outcome);
    out.ref.push(at("quote_ref") || `IMP-${i + 2}`);
  });
  if (out.part_name.length > 0) {
    await tx(async (c) => {
      await c.query(
        `insert into past_parts (part_name, customer, material_code, gross_wt_kg, annual_volume, quoted_price, quoted_on, outcome, quote_ref)
         select * from unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::int[], $6::numeric[], $7::date[], $8::text[], $9::text[])`,
        [out.part_name, out.customer, out.material_code, out.gross, out.vol, out.price, out.on, out.outcome, out.ref],
      );
      await log(c, null, userId, "past.imported", { rows: out.part_name.length, skipped: skipped.length });
    });
  }
  return { imported: out.part_name.length, skipped: skipped.slice(0, 10), missingColumns: [] };
}

export { CostingError };
