"use client";

import { useMemo, useState, useTransition } from "react";
import { savePartCostingAction, type ActionState } from "@/app/actions";
import {
  computeCost,
  CostingError,
  defaultTiers,
  needsApproval,
  PARAM,
  rateAt,
  type CostInputs,
  type RateRow,
} from "@/lib/costing";
import { dateTimeLabel, inr, inrShort, num } from "@/lib/format";
import type { Part, PastPart } from "@/lib/services";

interface OpState {
  key: number;
  workCentreCode: string;
  cycleMin: string;
  setupMin: string;
  suggestedFrom: string | null;
}

interface HistoryRow {
  id: number;
  version: number;
  pricing_date: string;
  created_at: string;
  created_by_name: string | null;
  annualValue: number;
  basePrice: number;
}

const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s));
let opKey = 100;

export function CostingEditor({
  rfqId,
  part,
  rates,
  today,
  locked,
  suggestions,
  history,
}: {
  rfqId: number;
  part: Part;
  rates: RateRow[];
  today: string;
  locked: boolean;
  suggestions: PastPart[];
  history: HistoryRow[];
}) {
  const [f, setF] = useState({
    name: part.name,
    materialCode: part.material_code,
    grossWtKg: String(part.gross_wt_kg),
    netWtKg: String(part.net_wt_kg),
    annualVolume: String(part.annual_volume),
    toolingCost: String(part.tooling_cost),
    packingPerUnit: String(part.packing_per_unit),
    marginPct: String(part.margin_pct),
  });
  const [tiers, setTiers] = useState<string[]>(part.volumes.map(String));
  const [ops, setOps] = useState<OpState[]>(
    part.ops.map((o, i) => ({
      key: i,
      workCentreCode: o.work_centre_code,
      cycleMin: String(o.cycle_min),
      setupMin: String(o.setup_min),
      suggestedFrom: o.suggested_from,
    })),
  );
  // Fields the estimator has accepted or edited. Starts with what the server already holds as accepted.
  const [accepted, setAccepted] = useState<Set<string>>(
    new Set(Object.entries(part.sources).filter(([, s]) => s.accepted).map(([k]) => k)),
  );
  const [result, setResult] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const [routingPending, setRoutingPending] = useState(
    () => part.sources.routing !== undefined && !part.sources.routing.accepted,
  );

  const materials = useMemo(
    () => [...new Set(rates.filter((r) => r.kind === "material" && !r.code.endsWith("-SCRAP")).map((r) => r.code))],
    [rates],
  );
  const workCentres = useMemo(
    () =>
      [...new Set(rates.filter((r) => r.kind === "work_centre").map((r) => r.code))].map((code) => {
        const row = rateAt(rates, "work_centre", code, today);
        return { code, label: row?.label ?? code, rate: row?.value ?? 0 };
      }),
    [rates, today],
  );
  const threshold = rateAt(rates, "param", PARAM.APPROVAL_THRESHOLD, today)?.value ?? 0;

  const touch = (key: string) => setAccepted((s) => new Set(s).add(key));
  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF((x) => ({ ...x, [key]: e.target.value }));
    touch(key);
  };

  const annualVolume = toNum(f.annualVolume);
  const tierNums = tiers.map(toNum).filter((v) => Number.isInteger(v) && v > 0);

  const inputs: CostInputs = {
    pricingDate: today,
    materialCode: f.materialCode,
    grossWtKg: toNum(f.grossWtKg),
    netWtKg: toNum(f.netWtKg),
    annualVolume,
    volumes: tierNums,
    toolingCost: toNum(f.toolingCost) || 0,
    packingPerUnit: toNum(f.packingPerUnit) || 0,
    marginPct: toNum(f.marginPct),
    ops: ops.map((o, i) => ({
      seq: i + 1,
      workCentreCode: o.workCentreCode,
      cycleMin: toNum(o.cycleMin),
      setupMin: toNum(o.setupMin),
    })),
  };

  const preview = useMemo(() => {
    try {
      return { ok: computeCost(inputs, rates) as ReturnType<typeof computeCost>, issues: undefined };
    } catch (e) {
      if (e instanceof CostingError) return { ok: undefined, issues: e.issues };
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(inputs), rates]);

  // Pre-filled values still waiting for the estimator's OK.
  const pendingKeys = [
    ...Object.entries(part.sources).filter(([k, s]) => k !== "routing" && !s.accepted && !accepted.has(k)).map(([k]) => k),
    ...(routingPending ? ["routing"] : []),
  ];
  const srcFor = (key: string) => part.sources[key];
  const isPending = (key: string) => pendingKeys.includes(key);

  function acceptAll() {
    setAccepted((s) => {
      const n = new Set(s);
      Object.keys(part.sources).forEach((k) => n.add(k));
      if (routingPending) n.add("routing");
      return n;
    });
    setRoutingPending(false);
  }

  function useRouting(p: PastPart) {
    const from = `${p.quote_ref} ${p.part_name} (${p.customer}), similarity ${p.score}`;
    setOps(
      p.routing.map((o) => ({
        key: opKey++,
        workCentreCode: o.workCentreCode,
        cycleMin: String(o.cycleMin),
        setupMin: String(o.setupMin),
        suggestedFrom: from,
      })),
    );
    setRoutingPending(true);
    setAccepted((s) => {
      const n = new Set(s);
      n.delete("routing");
      return n;
    });
  }

  function editOp(key: number, patch: Partial<OpState>) {
    setOps((os) => os.map((o) => (o.key === key ? { ...o, ...patch } : o)));
    setRoutingPending(false);
    touch("routing");
  }

  function save() {
    const payload = {
      name: f.name,
      materialCode: f.materialCode,
      grossWtKg: toNum(f.grossWtKg),
      netWtKg: toNum(f.netWtKg),
      annualVolume,
      toolingCost: toNum(f.toolingCost) || 0,
      packingPerUnit: toNum(f.packingPerUnit) || 0,
      marginPct: toNum(f.marginPct),
      volumes: tierNums,
      acceptedKeys: [...accepted, ...(routingPending ? [] : ["routing"])],
      ops: ops.map((o) => ({
        workCentreCode: o.workCentreCode,
        cycleMin: toNum(o.cycleMin),
        setupMin: toNum(o.setupMin),
        suggestedFrom: o.suggestedFrom,
      })),
    };
    start(async () => setResult(await savePartCostingAction(part.id, JSON.stringify(payload))));
  }

  const Src = ({ k }: { k: string }) => {
    const s = srcFor(k);
    if (!s) return null;
    const ok = !isPending(k);
    return (
      <div className="src-row">
        <span className={`tag ${s.source.startsWith("AI") ? "ai" : ""}`} title={s.source}>
          {ok ? "OK'd" : "Waiting for your OK"} · {s.source.length > 40 ? `${s.source.slice(0, 38)}…` : s.source}
        </span>
        {!ok && !locked ? (
          <button type="button" className="btn ghost sm" onClick={() => touch(k)}>
            Accept
          </button>
        ) : null}
      </div>
    );
  };

  const ok = preview.ok;
  const lineKeys = ok ? ok.tiers[0].lines.map((l) => ({ key: l.key, label: l.label })) : [];
  const dis = locked;

  return (
    <div className="cost-layout">
      <div className="stack">
        {locked ? (
          <div className="notice warn">This RFQ's quote is awaiting approval or already sent, so costing is read-only.</div>
        ) : null}
        {pendingKeys.length > 0 && !locked ? (
          <div className="notice warn">
            <div className="row">
              <span className="grow">
                {pendingKeys.length} pre-filled {pendingKeys.length === 1 ? "value is" : "values are"} waiting for your OK
                ({pendingKeys.join(", ")}). Check them, then accept.
              </span>
              <button type="button" className="btn sm" onClick={acceptAll}>
                Accept all
              </button>
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-head">
            <h2>Part</h2>
          </div>
          <div className="card-body">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" disabled={dis} value={f.name} onChange={set("name")} maxLength={120} className={isPending("name") ? "pending" : ""} />
              <Src k="name" />
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="mat">Material</label>
                <select id="mat" disabled={dis} value={f.materialCode} onChange={set("materialCode")} className={isPending("materialCode") ? "pending" : ""}>
                  {!materials.includes(f.materialCode) ? <option value={f.materialCode}>{f.materialCode} (no rate)</option> : null}
                  {materials.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <Src k="materialCode" />
              </div>
              <div className="field">
                <label htmlFor="vol">Annual volume</label>
                <div className="suffix" data-unit="pcs">
                  <input id="vol" disabled={dis} type="number" min="1" step="1" value={f.annualVolume} onChange={set("annualVolume")} className={isPending("annualVolume") ? "pending" : ""} />
                </div>
                <Src k="annualVolume" />
              </div>
              <div className="field">
                <label htmlFor="gw">Gross weight</label>
                <div className="suffix" data-unit="kg">
                  <input id="gw" disabled={dis} type="number" min="0" step="any" value={f.grossWtKg} onChange={set("grossWtKg")} className={isPending("grossWtKg") ? "pending" : ""} />
                </div>
                <Src k="grossWtKg" />
              </div>
              <div className="field">
                <label htmlFor="nw">Net weight</label>
                <div className="suffix" data-unit="kg">
                  <input id="nw" disabled={dis} type="number" min="0" step="any" value={f.netWtKg} onChange={set("netWtKg")} className={isPending("netWtKg") ? "pending" : ""} />
                </div>
                <Src k="netWtKg" />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Routing</h2>
            <button
              type="button"
              className="btn ghost sm"
              disabled={dis}
              onClick={() => {
                setOps((os) => [...os, { key: opKey++, workCentreCode: workCentres[0]?.code ?? "", cycleMin: "", setupMin: "0", suggestedFrom: null }]);
                touch("routing");
              }}
            >
              Add operation
            </button>
          </div>
          <div className="card-body">
            {ops.length === 0 ? <p className="muted">No operations yet. Add one, or use a past routing below.</p> : null}
            {ops.map((o, i) => (
              <div key={o.key}>
                <div className="op-row">
                  <div>
                    {i === 0 ? <label>Work centre</label> : null}
                    <select aria-label={`Operation ${i + 1} work centre`} disabled={dis} value={o.workCentreCode} onChange={(e) => editOp(o.key, { workCentreCode: e.target.value })} className={routingPending ? "pending" : ""}>
                      {workCentres.map((w) => (
                        <option key={w.code} value={w.code}>
                          {w.code}  ₹{num(w.rate)}/h
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    {i === 0 ? <label>Cycle, min</label> : null}
                    <input aria-label={`Operation ${i + 1} cycle minutes`} disabled={dis} type="number" min="0" step="any" value={o.cycleMin} onChange={(e) => editOp(o.key, { cycleMin: e.target.value })} className={routingPending ? "pending" : ""} />
                  </div>
                  <div>
                    {i === 0 ? <label>Setup, min</label> : null}
                    <input aria-label={`Operation ${i + 1} setup minutes`} disabled={dis} type="number" min="0" step="any" value={o.setupMin} onChange={(e) => editOp(o.key, { setupMin: e.target.value })} className={routingPending ? "pending" : ""} />
                  </div>
                  <button type="button" className="btn ghost sm" disabled={dis} aria-label={`Remove operation ${i + 1}`} onClick={() => { setOps((os) => os.filter((x) => x.key !== o.key)); touch("routing"); }}>
                    ×
                  </button>
                </div>
              </div>
            ))}
            {ops.find((o) => o.suggestedFrom) ? (
              <div className="src-row">
                <span className="tag ai" title={ops.find((o) => o.suggestedFrom)!.suggestedFrom!}>
                  {routingPending ? "Waiting for your OK" : "OK'd"} · from past part {ops.find((o) => o.suggestedFrom)!.suggestedFrom!.slice(0, 60)}
                </span>
                {routingPending && !dis ? (
                  <button type="button" className="btn ghost sm" onClick={() => { setRoutingPending(false); touch("routing"); }}>
                    Accept
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Commercial</h2>
          </div>
          <div className="card-body">
            <div className="grid-3">
              <div className="field">
                <label htmlFor="tool">Tooling (one-time)</label>
                <div className="suffix" data-unit="₹">
                  <input id="tool" disabled={dis} type="number" min="0" step="any" value={f.toolingCost} onChange={set("toolingCost")} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="pack">Packing per piece</label>
                <div className="suffix" data-unit="₹">
                  <input id="pack" disabled={dis} type="number" min="0" step="any" value={f.packingPerUnit} onChange={set("packingPerUnit")} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="mar">Margin on price</label>
                <div className="suffix" data-unit="%">
                  <input id="mar" disabled={dis} type="number" min="0" max="59" step="any" value={f.marginPct} onChange={set("marginPct")} />
                </div>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Price at these annual volumes (up to 3, the annual volume is always included)</label>
              <div className="grid-3">
                {[0, 1, 2].map((i) => (
                  <input
                    key={i}
                    aria-label={`Volume tier ${i + 1}`}
                    disabled={dis}
                    type="number"
                    min="1"
                    step="1"
                    value={tiers[i] ?? ""}
                    onChange={(e) =>
                      setTiers((t) => {
                        const n = [...t];
                        n[i] = e.target.value;
                        return n;
                      })
                    }
                  />
                ))}
              </div>
              <button type="button" className="btn ghost sm" disabled={dis || !(annualVolume > 0)} onClick={() => setTiers(defaultTiers(annualVolume).map(String))}>
                Reset to half, base and one and a half times
              </button>
            </div>
          </div>
        </div>

        {suggestions.length > 0 && !dis ? (
          <div className="card">
            <div className="card-head">
              <h2>Similar past parts</h2>
              <span className="small muted">Routing suggestions, from what we quoted before</span>
            </div>
            <div className="card-body stack" style={{ gap: 12 }}>
              {suggestions.map((p) => (
                <div key={p.id} style={{ borderBottom: "1px solid var(--line-2)", paddingBottom: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{p.part_name}</strong>
                    <span className="badge info">{Math.round((p.score ?? 0) * 100)}% similar</span>
                  </div>
                  <p className="small muted">
                    {p.quote_ref} · {p.customer} · {p.material_code} · {num(p.gross_wt_kg, 3)} kg · {num(p.annual_volume)} pcs ·{" "}
                    {inr(p.quoted_price)} · {p.outcome}
                  </p>
                  <p className="small" style={{ margin: "4px 0 8px" }}>
                    {p.routing.map((o) => `${o.workCentreCode} ${o.cycleMin} min`).join(" → ")}
                  </p>
                  <button type="button" className="btn sm" onClick={() => useRouting(p)}>
                    Use this routing
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="stack sticky">
        <div className="card">
          <div className="card-head">
            <h2>Cost per piece</h2>
            <span className="small muted">Rates as of {today}</span>
          </div>
          {ok ? (
            <div className="scroll">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>At annual volume</th>
                    {ok.tiers.map((t) => (
                      <th key={t.volume} className="num">
                        {num(t.volume)}
                        {t.volume === annualVolume ? " (base)" : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineKeys.map((l) => (
                    <tr key={l.key}>
                      <td>
                        {l.label}
                        <div className="formula">{ok.base.lines.find((x) => x.key === l.key)?.formula}</div>
                      </td>
                      {ok.tiers.map((t) => (
                        <td key={t.volume} className="num">
                          {num(t.lines.find((x) => x.key === l.key)?.amount ?? 0, 2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Cost</td>
                    {ok.tiers.map((t) => (
                      <td key={t.volume} className="num">{num(t.cost, 2)}</td>
                    ))}
                  </tr>
                  <tr className="strong">
                    <td>Price, ex-GST ({f.marginPct}% margin)</td>
                    {ok.tiers.map((t) => (
                      <td key={t.volume} className="num">{num(t.price, 2)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="muted">GST</td>
                    {ok.tiers.map((t) => (
                      <td key={t.volume} className="num muted">{num(t.gst, 2)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="muted">Price incl. GST</td>
                    {ok.tiers.map((t) => (
                      <td key={t.volume} className="num muted">{num(t.priceInclGst, 2)}</td>
                    ))}
                  </tr>
                  <tr className="total">
                    <td>Annual value, ex-GST</td>
                    {ok.tiers.map((t) => (
                      <td key={t.volume} className="num">{inrShort(t.annualValue)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card-body">
              <div className="notice">
                Fill in the highlighted items to see the price:
                <ul>
                  {(preview.issues ?? []).map((x) => <li key={x}>{x}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>

        {ok ? (
          <div className="card">
            <div className="card-body">
              <p>
                Annual value at the base volume is <strong>{inr(ok.annualValue, 0)}</strong>.{" "}
                {needsApproval(ok.annualValue, threshold)
                  ? `That is above ${inrShort(threshold)}, so the sales head must approve this quote.`
                  : `That is within ${inrShort(threshold)}, so you can send it without approval.`}
              </p>
              {ok.warnings.map((w) => (
                <p key={w} className="small" style={{ color: "var(--warn)", marginTop: 6 }}>
                  {w}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {!locked ? (
          <div className="card">
            <div className="card-body">
              <div className="row">
                <button className="btn primary" disabled={pending || !ok || pendingKeys.length > 0} onClick={save}>
                  {pending ? "Saving…" : "Save costing"}
                </button>
                <a className="btn" href={`/rfqs/${rfqId}`}>
                  Back to RFQ
                </a>
              </div>
              {pendingKeys.length > 0 ? <p className="hint">Accept the pre-filled values first.</p> : null}
              {result.error ? (
                <div className="notice bad" role="alert" style={{ marginTop: 12 }}>
                  {result.error}
                  {result.issues ? (
                    <ul>
                      {result.issues.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {result.ok ? <div className="notice ok" style={{ marginTop: 12 }}>{result.ok}. It is saved as a snapshot with the exact rates used.</div> : null}
            </div>
          </div>
        ) : null}

        {ok ? (
          <details className="card">
            <summary className="card-head" style={{ cursor: "pointer", listStyle: "none" }}>
              <h2>Rates used in this price</h2>
              <span className="small muted">{ok.ratesUsed.length} rows</span>
            </summary>
            <div className="scroll">
              <table>
                <tbody>
                  {ok.ratesUsed.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.label}
                        <div className="small muted">
                          {r.code} · from {r.effective_from} · row #{r.id}
                        </div>
                      </td>
                      <td className="num">
                        {num(r.value, 2)} <span className="muted small">{r.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}

        {history.length > 0 ? (
          <div className="card">
            <div className="card-head">
              <h2>Saved versions</h2>
            </div>
            <table>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>
                      v{h.version}
                      <div className="small muted">
                        {h.created_by_name ?? "Unknown"} · {dateTimeLabel(h.created_at)} · rates of {h.pricing_date}
                      </div>
                    </td>
                    <td className="num">{inr(h.basePrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
