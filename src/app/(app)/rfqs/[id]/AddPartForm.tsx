"use client";

import { useActionState, useRef } from "react";
import { addPartAction, type ActionState } from "@/app/actions";

export function AddPartForm({ rfqId, materials }: { rfqId: number; materials: string[] }) {
  const bound = addPartAction.bind(null, rfqId);
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const r = await bound(prev, form);
    if (r.ok) ref.current?.reset();
    return r;
  }, {});
  return (
    <details className="card">
      <summary className="card-head" style={{ cursor: "pointer", listStyle: "none" }}>
        <h2>Add a part</h2>
        <span className="small muted">Optional</span>
      </summary>
      <form ref={ref} action={action} className="card-body">
        <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div className="field">
            <label htmlFor="ap-name">Part name</label>
            <input id="ap-name" name="name" required maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="ap-mat">Material</label>
            <select id="ap-mat" name="materialCode" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {materials.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ap-g">Gross weight (kg)</label>
            <input id="ap-g" name="grossWtKg" type="number" step="any" min="0" required />
          </div>
          <div className="field">
            <label htmlFor="ap-n">Net weight (kg)</label>
            <input id="ap-n" name="netWtKg" type="number" step="any" min="0" required />
          </div>
          <div className="field">
            <label htmlFor="ap-v">Annual volume</label>
            <input id="ap-v" name="annualVolume" type="number" step="1" min="1" required />
          </div>
        </div>
        <button className="btn" disabled={pending}>
          {pending ? "Adding…" : "Add part"}
        </button>
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
      </form>
    </details>
  );
}
