import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { computeCost, defaultTiers, type RateRow } from "../src/lib/costing";
import {
  createRfq,
  decideQuote,
  recordOutcome,
  savePartAndCosting,
  sendQuote,
  submitQuote,
  getParts,
  getQuote,
} from "../src/lib/services";
import {
  OPEN_RFQS,
  PAST_CUSTOMERS,
  PAST_FAMILIES,
  RATES,
  RATE_DATE,
} from "./seed-data";

try {
  process.loadEnvFile?.(".env");
} catch {
  // fall through to the default
}

const url = process.env.DATABASE_URL ?? "postgres://quoteflow:quoteflow@localhost:54329/quoteflow";
export const DEMO_PASSWORD = "Demo@1234";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const db = new Pool({ connectionString: url });
  await db.query(
    `truncate activity, quote_lines, quotes, costings, routing_ops, parts, rfqs,
              rate_items, past_parts, users restart identity cascade`,
  );

  // Users
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userIds: Record<string, number> = {};
  for (const [key, email, name, role] of [
    ["estimator", "estimator@company-a.test", "Asha Kulkarni", "estimator"],
    ["estimator2", "estimator2@company-a.test", "Rohan Patil", "estimator"],
    ["sales_head", "saleshead@company-a.test", "Meera Deshpande", "sales_head"],
  ] as const) {
    const r = await db.query(
      "insert into users (email, name, role, password_hash) values ($1,$2,$3,$4) returning id",
      [email, name, role, hash],
    );
    userIds[key] = r.rows[0].id;
  }

  // Rates
  const rateRows: RateRow[] = [];
  for (const r of RATES) {
    const res = await db.query(
      `insert into rate_items (kind, code, label, unit, value, effective_from, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [r.kind, r.code, r.label, r.unit, r.value, r.from ?? RATE_DATE, userIds.sales_head],
    );
    rateRows.push({
      id: res.rows[0].id,
      kind: r.kind,
      code: r.code,
      label: r.label,
      unit: r.unit,
      value: r.value,
      effective_from: r.from ?? RATE_DATE,
    });
  }

  // Open RFQs, with fields marked as accepted (they were entered by an estimator)
  const accepted = (v: string) => ({ source: v, accepted: true });
  for (const rfq of OPEN_RFQS) {
    const r = await db.query(
      `insert into rfqs (rfq_no, customer, received_on, due_on, owner_id, status)
       values ($1,$2,current_date - $3::int, current_date + $4::int, $5, 'estimating') returning id`,
      [rfq.rfqNo, rfq.customer, rfq.receivedDaysAgo, rfq.dueInDays, userIds[rfq.owner]],
    );
    const rfqId = r.rows[0].id;
    let line = 1;
    for (const p of rfq.parts) {
      const part = await db.query(
        `insert into parts (rfq_id, line_no, name, material_code, gross_wt_kg, net_wt_kg,
           annual_volume, tooling_cost, packing_per_unit, margin_pct, volumes, sources)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,12,$10,$11) returning id`,
        [
          rfqId,
          line++,
          p.name,
          p.materialCode,
          p.grossWtKg,
          p.netWtKg,
          p.annualVolume,
          p.toolingCost,
          p.packingPerUnit,
          defaultTiers(p.annualVolume),
          JSON.stringify({
            name: accepted("RFQ part list"),
            materialCode: accepted("RFQ part list"),
            grossWtKg: accepted("RFQ part list"),
            annualVolume: accepted("RFQ part list"),
          }),
        ],
      );
      let seq = 1;
      for (const op of p.ops) {
        await db.query(
          `insert into routing_ops (part_id, seq, work_centre_code, cycle_min, setup_min)
           values ($1,$2,$3,$4,$5)`,
          [part.rows[0].id, seq++, op.workCentreCode, op.cycleMin, op.setupMin],
        );
      }
    }
    await db.query(
      "insert into activity (rfq_id, user_id, action, detail) values ($1,$2,'rfq.created',$3)",
      [rfqId, userIds[rfq.owner], JSON.stringify({ via: "seed" })],
    );
  }

  // Past parts: deterministic pseudo-random history
  const rnd = mulberry32(2611);
  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  let count = 0;
  for (const fam of PAST_FAMILIES) {
    for (let i = 0; i < 35; i++) {
      const gross = Math.round(between(fam.wt[0], fam.wt[1]) * 1000) / 1000;
      const net = Math.round(gross * between(0.78, 0.93) * 1000) / 1000;
      const volume = Math.round(between(fam.volume[0], fam.volume[1]) / 100) * 100;
      const routing = fam.routing.map((op, k) => ({
        seq: k + 1,
        workCentreCode: op.workCentreCode,
        cycleMin: Math.round(op.cycleMin * between(0.85, 1.15) * 100) / 100,
        setupMin: op.setupMin,
      }));
      const priced = computeCost(
        {
          pricingDate: "2026-11-07",
          materialCode: fam.material,
          grossWtKg: gross,
          netWtKg: net,
          annualVolume: volume,
          volumes: [volume],
          toolingCost: 0,
          packingPerUnit: 1.5,
          marginPct: 12,
          ops: routing,
        },
        rateRows,
      );
      const price = Math.round(priced.base.price * between(0.9, 1.1) * 100) / 100;
      const daysAgo = Math.floor(between(20, 560));
      const outcome = pick(["won", "won", "lost", "lost", "open"] as const);
      count++;
      await db.query(
        `insert into past_parts (customer, part_name, material_code, gross_wt_kg, net_wt_kg,
           annual_volume, quoted_on, quoted_price, outcome, quote_ref, routing)
         values ($1,$2,$3,$4,$5,$6,current_date - $7::int,$8,$9,$10,$11)`,
        [
          pick(PAST_CUSTOMERS),
          pick(fam.names),
          fam.material,
          gross,
          net,
          volume,
          daysAgo,
          price,
          outcome,
          `Q-${2500 + count}`,
          JSON.stringify(routing),
        ],
      );
    }
  }

  // Closed-out history, created through the same service functions the app uses, so the register
  // shows every status. Imported last because the services read the rows seeded above.
  const history: {
    rfqNo: string;
    customer: string;
    daysAgo: number;
    part: { name: string; materialCode: string; grossWtKg: number; netWtKg: number; annualVolume: number; packingPerUnit: number; ops: { workCentreCode: string; cycleMin: number; setupMin: number }[] };
    end: "won" | "lost" | "sent" | "pending";
    reason?: string;
  }[] = [
    { rfqNo: "RFQ-2610-031", customer: "Company E (Tier-1)", daysAgo: 24, end: "won",
      part: { name: "Output shaft", materialCode: "EN8", grossWtKg: 0.92, netWtKg: 0.78, annualVolume: 40000, packingPerUnit: 2.2,
        ops: [{ workCentreCode: "TURN-STD", cycleMin: 3.6, setupMin: 45 }, { workCentreCode: "THREAD-ROLL", cycleMin: 1, setupMin: 30 }, { workCentreCode: "INSPECT", cycleMin: 0.4, setupMin: 0 }] } },
    { rfqNo: "RFQ-2610-022", customer: "Company F (two-wheelers)", daysAgo: 31, end: "lost", reason: "Price 7% above a competitor's quote",
      part: { name: "Flanged bush", materialCode: "EN8", grossWtKg: 0.14, netWtKg: 0.11, annualVolume: 25000, packingPerUnit: 0.8,
        ops: [{ workCentreCode: "TURN-STD", cycleMin: 1.1, setupMin: 20 }, { workCentreCode: "INSPECT", cycleMin: 0.15, setupMin: 0 }] } },
    { rfqNo: "RFQ-2610-040", customer: "Company C (tractors)", daysAgo: 12, end: "sent",
      part: { name: "Steering arm", materialCode: "40Cr4-F", grossWtKg: 3.4, netWtKg: 2.9, annualVolume: 18000, packingPerUnit: 6,
        ops: [{ workCentreCode: "HMC", cycleMin: 9.5, setupMin: 90 }, { workCentreCode: "DRILL-TAP", cycleMin: 1.8, setupMin: 20 }, { workCentreCode: "INSPECT", cycleMin: 0.8, setupMin: 0 }] } },
    { rfqNo: "RFQ-2611-009", customer: "Company D (drivetrains)", daysAgo: 4, end: "pending",
      part: { name: "Pinion blank", materialCode: "20MnCr5", grossWtKg: 1.1, netWtKg: 0.86, annualVolume: 45000, packingPerUnit: 2.6,
        ops: [{ workCentreCode: "TURN-HV", cycleMin: 4.1, setupMin: 40 }, { workCentreCode: "INSPECT", cycleMin: 0.3, setupMin: 0 }] } },
  ];
  for (const h of history) {
    const rfqId = await createRfq(userIds.estimator, {
      rfqNo: h.rfqNo,
      customer: h.customer,
      dueOn: new Date(Date.now() - (h.daysAgo - 9) * 864e5).toISOString().slice(0, 10),
      receivedOn: new Date(Date.now() - h.daysAgo * 864e5).toISOString().slice(0, 10),
      parts: [h.part],
      via: "seed",
    });
    const [p] = await getParts(rfqId);
    await savePartAndCosting(userIds.estimator, p.id, { ...h.part, acceptedKeys: [] });
    const quoteId = await submitQuote(userIds.estimator, rfqId);
    if (h.end === "pending") continue;
    if ((await getQuote(quoteId))!.status === "pending_approval")
      await decideQuote(userIds.sales_head, quoteId, "approve", "Margin and routing checked");
    if (h.end === "sent") { await sendQuote(userIds.sales_head, quoteId); continue; }
    await sendQuote(userIds.sales_head, quoteId);
    await recordOutcome(userIds.estimator, rfqId, h.end, h.reason ?? "");
  }

  console.log(`seeded: ${Object.keys(userIds).length} users, ${rateRows.length} rates, ${OPEN_RFQS.length + history.length} RFQs, ${count} past parts`);
  console.log(`demo password for every seeded user: ${DEMO_PASSWORD}`);
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
