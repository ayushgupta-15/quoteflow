"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createRfqAction,
  extractAction,
  type ActionState,
  type ExtractState,
} from "@/app/actions";
import type { Extracted, ExtractedPart, ExtractedRfq } from "@/lib/extract";

const SAMPLE_EMAIL = `From: "Priya Nair" <priya.nair@company-b.com>
To: estimation@company-a.com
Subject: RFQ - rear wheel spindle and spacer bush

Dear team,
Please send your quote by {DUE} for the following:
1. Rear wheel spindle, EN8, 0.61 kg, 1,80,000 pcs/yr
2. Spacer bush - EN8 - 0.09 kg - 12000 nos per year
Drawings attached.
Regards, Priya`;

type Key = "name" | "materialCode" | "grossWtKg" | "netWtKg" | "annualVolume";
const FIELDS: { key: Key; label: string; unit?: string; type: "text" | "number" | "material" }[] = [
  { key: "name", label: "Part name", type: "text" },
  { key: "materialCode", label: "Material", type: "material" },
  { key: "grossWtKg", label: "Gross weight", unit: "kg", type: "number" },
  { key: "netWtKg", label: "Net weight", unit: "kg", type: "number" },
  { key: "annualVolume", label: "Annual volume", unit: "pcs", type: "number" },
];

interface DraftPart {
  values: Record<Key, string>;
  src: Partial<Record<Key, Extracted<string | number>>>;
  edited: Partial<Record<Key, boolean>>;
  checked: boolean;
}

function toDraft(p: ExtractedPart): DraftPart {
  const values = {} as Record<Key, string>;
  const src: DraftPart["src"] = {};
  for (const f of FIELDS) {
    const e = p[f.key] as Extracted<string | number> | undefined;
    values[f.key] = e ? String(e.value) : "";
    if (e) src[f.key] = e;
  }
  return { values, src, edited: {}, checked: false };
}

const blankPart = (): DraftPart => ({
  values: { name: "", materialCode: "", grossWtKg: "", netWtKg: "", annualVolume: "" },
  src: {},
  edited: {},
  checked: true,
});

export function IntakeFlow({
  materials,
  aiEnabled,
  today,
}: {
  materials: string[];
  aiEnabled: boolean;
  today: string;
}) {
  const [state, action, reading] = useActionState<ExtractState, FormData>(extractAction, {});
  const [email, setEmail] = useState("");
  const [manual, setManual] = useState(false);

  return (
    <div className="stack">
      <form action={action} className="card" encType="multipart/form-data">
        <div className="card-head">
          <h2>1. Read the RFQ</h2>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              const d = new Date(`${today}T00:00:00`);
              d.setDate(d.getDate() + 7);
              const due = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
              setEmail(SAMPLE_EMAIL.replace("{DUE}", due));
            }}
          >
            Use a sample email
          </button>
        </div>
        <div className="card-body">
          <div className="field">
            <label htmlFor="email">RFQ email</label>
            <textarea
              id="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Paste the customer's email here"
              maxLength={20000}
            />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="sheet">Part list (Excel or CSV)</label>
              <input id="sheet" name="sheet" type="file" accept=".xlsx,.csv" />
              <p className="hint">Headings like Part, Material, Gross Wt, Annual Volume are recognised.</p>
            </div>
            <div className="field">
              <label htmlFor="titleBlock">Drawing title block (optional)</label>
              <textarea
                id="titleBlock"
                name="titleBlock"
                style={{ minHeight: 70 }}
                placeholder={"PART NAME: Gear blank\nMATERIAL: 20MnCr5\nNET WT: 1.12 kg"}
                maxLength={5000}
              />
            </div>
          </div>
          <div className="row">
            <button className="btn primary" disabled={reading}>
              {reading ? "Reading…" : "Read RFQ"}
            </button>
            <button type="button" className="btn" onClick={() => setManual(true)}>
              Enter by hand
            </button>
            <span className="small muted grow">
              {aiEnabled
                ? "Tidy emails and sheets are read by rules. Free-text emails the rules cannot read go to an AI reader (email text only)."
                : "Read by rules. The AI reader is off because no API key is set. Drawings and files are never sent anywhere."}
            </span>
          </div>
          {state.error ? (
            <div className="notice bad" role="alert" style={{ marginTop: 16 }}>
              {state.error}
            </div>
          ) : null}
        </div>
      </form>

      {state.extracted || manual ? (
        <Review
          key={state.extracted ? JSON.stringify(state.extracted).length : "manual"}
          materials={materials}
          today={today}
          extracted={state.extracted}
          sourceText={state.email}
        />
      ) : null}
    </div>
  );
}

function SrcTag({ e, edited }: { e?: Extracted<string | number>; edited?: boolean }) {
  if (!e) return <span className="tag">entered by hand</span>;
  return (
    <span className={`tag ${e.origin === "llm" ? "ai" : ""}`} title={e.source}>
      {edited ? "edited" : e.origin === "llm" ? "AI" : e.origin === "assumption" ? "assumed" : "read"} ·{" "}
      {e.source.length > 46 ? `${e.source.slice(0, 44)}…` : e.source}
    </span>
  );
}

function Review({
  materials,
  today,
  extracted,
  sourceText,
}: {
  materials: string[];
  today: string;
  extracted?: ExtractedRfq;
  sourceText?: string;
}) {
  const [customer, setCustomer] = useState(extracted?.customer?.value ?? "");
  const [dueOn, setDueOn] = useState(extracted?.dueOn?.value ?? "");
  const [parts, setParts] = useState<DraftPart[]>(
    extracted && extracted.parts.length > 0 ? extracted.parts.map(toDraft) : [blankPart()],
  );
  const [result, setResult] = useState<ActionState>({});
  const [pending, start] = useTransition();

  const update = (i: number, fn: (p: DraftPart) => DraftPart) =>
    setParts((ps) => ps.map((p, j) => (j === i ? fn(p) : p)));

  function submit() {
    const payload = {
      customer,
      dueOn,
      sourceText: sourceText?.slice(0, 20000),
      via: extracted ? "intake" : "manual",
      parts: parts.map((p) => {
        const sources: Record<string, { source: string; accepted: boolean; confidence?: number }> = {};
        for (const f of FIELDS) {
          const s = p.src[f.key];
          if (s) sources[f.key] = { source: s.source, accepted: p.checked || Boolean(p.edited[f.key]), confidence: s.confidence };
        }
        return {
          name: p.values.name,
          materialCode: p.values.materialCode,
          grossWtKg: Number(p.values.grossWtKg),
          netWtKg: Number(p.values.netWtKg),
          annualVolume: Number(p.values.annualVolume),
          sources,
        };
      }),
    };
    start(async () => setResult(await createRfqAction(JSON.stringify(payload))));
  }

  const missing =
    !customer.trim() ||
    !dueOn ||
    parts.some((p) => FIELDS.some((f) => p.values[f.key].trim() === ""));

  return (
    <div className="card">
      <div className="card-head">
        <h2>2. Check what was read</h2>
        {extracted ? (
          <span className="badge info">{extracted.method === "rules" ? "Read by rules" : "Read by rules and AI"}</span>
        ) : null}
      </div>
      <div className="card-body">
        {extracted?.notes.map((n) => (
          <div key={n} className="notice warn" style={{ marginBottom: 12 }}>
            {n}
          </div>
        ))}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="customer">Customer</label>
            <input id="customer" value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={120} />
            <div className="src-row">
              <SrcTag e={extracted?.customer} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="due">Quote due</label>
            <input id="due" type="date" value={dueOn} min={today} onChange={(e) => setDueOn(e.target.value)} />
            <div className="src-row">
              <SrcTag e={extracted?.dueOn} />
            </div>
          </div>
        </div>

        {parts.map((p, i) => (
          <fieldset key={i} className="card" style={{ margin: "0 0 16px", padding: 16 }}>
            <legend className="small muted" style={{ padding: "0 8px" }}>
              Part {i + 1}
            </legend>
            <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
              {FIELDS.map((f) => {
                const s = p.src[f.key];
                const pendingAccept = Boolean(s) && !p.checked && !p.edited[f.key];
                const unknownMaterial = f.type === "material" && p.values.materialCode && !materials.includes(p.values.materialCode);
                return (
                  <div className="field" key={f.key}>
                    <label htmlFor={`${f.key}-${i}`}>{f.label}</label>
                    {f.type === "material" ? (
                      <select
                        id={`${f.key}-${i}`}
                        className={pendingAccept ? "pending" : ""}
                        value={p.values.materialCode}
                        onChange={(e) =>
                          update(i, (x) => ({ ...x, values: { ...x.values, materialCode: e.target.value }, edited: { ...x.edited, materialCode: true } }))
                        }
                      >
                        <option value="">Choose…</option>
                        {unknownMaterial ? <option value={p.values.materialCode}>{p.values.materialCode} (not in master)</option> : null}
                        {materials.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <div className={f.unit ? "suffix" : ""} data-unit={f.unit}>
                        <input
                          id={`${f.key}-${i}`}
                          className={pendingAccept ? "pending" : ""}
                          type={f.type}
                          step={f.type === "number" ? "any" : undefined}
                          min={f.type === "number" ? 0 : undefined}
                          value={p.values[f.key]}
                          onChange={(e) =>
                            update(i, (x) => ({ ...x, values: { ...x.values, [f.key]: e.target.value }, edited: { ...x.edited, [f.key]: true } }))
                          }
                        />
                      </div>
                    )}
                    <div className="src-row">
                      <SrcTag e={s} edited={p.edited[f.key]} />
                    </div>
                    {unknownMaterial ? (
                      <p className="hint" style={{ color: "var(--warn)" }}>
                        Not in the material master. Ask the sales head to add its rate, or pick another.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label className="row" style={{ margin: 0, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={p.checked}
                  onChange={(e) => update(i, (x) => ({ ...x, checked: e.target.checked }))}
                />
                I checked this part against the RFQ
              </label>
              {parts.length > 1 ? (
                <button type="button" className="btn ghost sm" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>
                  Remove part
                </button>
              ) : null}
            </div>
          </fieldset>
        ))}

        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="btn" onClick={() => setParts((ps) => [...ps, blankPart()])}>
            Add another part
          </button>
          <span className="grow" />
          <button className="btn primary" disabled={pending || missing} onClick={submit}>
            {pending ? "Creating…" : "Create RFQ"}
          </button>
        </div>
        {missing ? <p className="hint">Fill in the customer, due date and every field of every part to continue.</p> : null}
        {result.error ? (
          <div className="notice bad" role="alert" style={{ marginTop: 16 }}>
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
      </div>
    </div>
  );
}
