"use client";

import { useActionState, useState } from "react";
import { addRateAction, type ActionState } from "@/app/actions";

interface Existing {
  kind: "material" | "work_centre" | "param";
  code: string;
  label: string;
  unit: string;
}

export function RateForm({ existing, today }: { existing: Existing[]; today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addRateAction, {});
  const [pick, setPick] = useState<string>("");
  const found = existing.find((e) => `${e.kind}:${e.code}` === pick);
  const [kind, setKind] = useState<Existing["kind"]>("material");

  return (
    <form action={action} className="card">
      <div className="card-head">
        <h2>Add or change a rate</h2>
      </div>
      <div className="card-body">
        <div className="field">
          <label htmlFor="rf-pick">Rate</label>
          <select id="rf-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">New material or machine…</option>
            {existing.map((e) => (
              <option key={`${e.kind}:${e.code}`} value={`${e.kind}:${e.code}`}>
                {e.code} · {e.label}
              </option>
            ))}
          </select>
        </div>
        {found ? (
          <>
            <input type="hidden" name="kind" value={found.kind} />
            <input type="hidden" name="code" value={found.code} />
            <input type="hidden" name="label" value={found.label} />
            <input type="hidden" name="unit" value={found.unit} />
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="rf-kind">Type</label>
              <select id="rf-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as Existing["kind"])}>
                <option value="material">Material</option>
                <option value="work_centre">Machine</option>
              </select>
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="rf-code">Code</label>
                <input id="rf-code" name="code" required maxLength={40} placeholder={kind === "material" ? "EN19" : "VMC"} />
              </div>
              <div className="field">
                <label htmlFor="rf-unit">Unit</label>
                <input id="rf-unit" name="unit" required maxLength={20} defaultValue={kind === "material" ? "₹/kg" : "₹/h"} key={kind} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="rf-label">Description</label>
              <input id="rf-label" name="label" required maxLength={120} />
            </div>
          </>
        )}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="rf-value">New value</label>
            <input id="rf-value" name="value" type="number" step="any" min="0" required />
          </div>
          <div className="field">
            <label htmlFor="rf-from">Starts on</label>
            <input id="rf-from" name="effectiveFrom" type="date" min={today} defaultValue={today} required />
          </div>
        </div>
        <button className="btn primary" disabled={pending}>
          {pending ? "Adding…" : "Add rate"}
        </button>
        <p className="hint">It cannot start in the past, and existing quotes are never repriced.</p>
        {state.error ? (
          <div className="notice bad" role="alert" style={{ marginTop: 12 }}>
            {state.error}
            {state.issues ? (
              <ul>
                {state.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {state.ok ? <div className="notice ok" style={{ marginTop: 12 }}>{state.ok}</div> : null}
      </div>
    </form>
  );
}
