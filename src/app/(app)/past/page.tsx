import type { Metadata } from "next";
import Link from "next/link";
import { dateLabel, inr, num } from "@/lib/format";
import { distinctMaterials, searchPast } from "@/lib/services";
import { requireUser } from "@/lib/session";
import { ImportForm } from "./ImportForm";

export const metadata: Metadata = { title: "Past quotes" };
export const dynamic = "force-dynamic";

const TONE: Record<string, string> = { won: "ok", lost: "bad", open: "info" };

export default async function PastQuotes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; material?: string; customer?: string; wt?: string; name?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 80);
  const material = sp.material ?? "";
  const customer = (sp.customer ?? "").slice(0, 80);
  const wt = Number(sp.wt);
  const similarName = (sp.name ?? "").slice(0, 80);
  const similar = material && wt > 0 ? { name: similarName || q, materialCode: material, grossWtKg: wt } : undefined;
  const [rows, materials] = await Promise.all([
    searchPast({ q: similar ? undefined : q, material: similar ? undefined : material, customer, similarTo: similar, limit: 60 }),
    distinctMaterials(),
  ]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Past quotes</h1>
          <p className="sub">What we quoted before. Search by name, or find similar parts by material and weight.</p>
        </div>
      </div>

      <form className="card" role="search">
        <div className="card-body">
          <div className="grid-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", alignItems: "end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="q">Part name or quote ref</label>
              <input id="q" name="q" defaultValue={q} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="material">Material</label>
              <select id="material" name="material" defaultValue={material}>
                <option value="">Any</option>
                {materials.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="wt">Gross weight, kg (finds similar)</label>
              <input id="wt" name="wt" type="number" step="any" min="0" defaultValue={sp.wt ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="customer">Customer</label>
              <input id="customer" name="customer" defaultValue={customer} />
            </div>
            <div className="row" style={{ marginBottom: 0 }}>
              <button className="btn primary">Search</button>
              <Link className="btn" href="/past">
                Clear
              </Link>
            </div>
          </div>
          {similar ? <p className="hint">Ranked by similarity to {material}, {num(wt, 3)} kg{similar.name ? `, "${similar.name}"` : ""}.</p> : null}
        </div>
      </form>

      <div className="card scroll">
        {rows.length === 0 ? (
          <div className="empty">
            <strong>No past quotes match</strong>Try fewer filters.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                {similar ? <th className="num">Match</th> : null}
                <th>Quote</th>
                <th>Part</th>
                <th>Customer</th>
                <th>Material</th>
                <th className="num">Gross kg</th>
                <th className="num">Annual vol.</th>
                <th className="num">Price</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {similar ? <td className="num">{Math.round((r.score ?? 0) * 100)}%</td> : null}
                  <td>
                    {r.quote_ref}
                    <div className="small muted">{dateLabel(r.quoted_on)}</div>
                  </td>
                  <td>
                    <strong>{r.part_name}</strong>
                    {r.routing.length > 0 ? <div className="small muted">{r.routing.map((o) => o.workCentreCode).join(" → ")}</div> : null}
                  </td>
                  <td>{r.customer}</td>
                  <td>{r.material_code}</td>
                  <td className="num">{num(r.gross_wt_kg, 3)}</td>
                  <td className="num">{num(r.annual_volume)}</td>
                  <td className="num">{inr(r.quoted_price)}</td>
                  <td>
                    <span className={`badge ${TONE[r.outcome]}`}>{r.outcome}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ImportForm />
    </div>
  );
}
