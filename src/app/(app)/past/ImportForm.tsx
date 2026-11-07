"use client";

import { useActionState } from "react";
import { importPastAction, type ImportState } from "@/app/actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importPastAction, {});
  return (
    <details className="card">
      <summary className="card-head" style={{ cursor: "pointer", listStyle: "none" }}>
        <h2>Import past quotes from Excel</h2>
        <span className="small muted">.xlsx or .csv, up to 5,000 rows per file</span>
      </summary>
      <form action={action} className="card-body" encType="multipart/form-data">
        <p className="hint" style={{ marginBottom: 12 }}>
          Headings: Part, Customer, Material, Gross Wt, Annual Volume, Price, Date (YYYY-MM-DD), Outcome (won, lost or open) and
          Quote ref. Rows that cannot be read are skipped and listed below.
        </p>
        <div className="row">
          <input name="sheet" type="file" accept=".xlsx,.csv" required style={{ maxWidth: 360 }} />
          <button className="btn" disabled={pending}>
            {pending ? "Importing…" : "Import"}
          </button>
        </div>
        {state.error ? (
          <div className="notice bad" role="alert" style={{ marginTop: 12 }}>
            {state.error}
          </div>
        ) : null}
        {state.ok ? <div className="notice ok" style={{ marginTop: 12 }}>{state.ok}</div> : null}
        {state.result && state.result.skipped.length > 0 ? (
          <div className="notice warn" style={{ marginTop: 12 }}>
            Skipped rows:
            <ul>
              {state.result.skipped.map((s) => (
                <li key={s.row}>
                  Row {s.row}: {s.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>
    </details>
  );
}
