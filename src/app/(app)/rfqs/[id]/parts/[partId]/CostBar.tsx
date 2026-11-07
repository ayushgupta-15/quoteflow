import { composition, type TierResult } from "@/lib/costing";
import { inr, num } from "@/lib/format";

/**
 * Where each rupee of the ex-GST unit price goes. One accent: the biggest share, which is where an
 * estimator should look first. Everything else is a step of the neutral ink.
 */
export function CostBar({ tier }: { tier: TierResult }) {
  const parts = composition(tier);
  if (parts.length === 0) return null;
  const biggest = parts.reduce((a, b) => (b.amount > a.amount ? b : a)).key;
  const steps = [0.5, 0.36, 0.26, 0.19, 0.14];
  const rank = new Map<string, number>(
    [...parts].filter((p) => p.key !== biggest).sort((a, b) => b.amount - a.amount).map((p, i) => [p.key, i]),
  );
  const colour = (key: string) =>
    key === biggest ? "var(--accent)" : `rgb(28 32 36 / ${steps[Math.min(rank.get(key) ?? 4, steps.length - 1)]})`;
  const pct = (share: number) => `${Math.round(share * 100)}%`;
  const summary = parts.map((p) => `${p.label} ${pct(p.share)}`).join(", ");

  return (
    <div className="split">
      <div className="split-head">
        <h3>Where the price goes</h3>
        <span className="small muted">
          {inr(tier.price)} per piece at {num(tier.volume)} a year
        </span>
      </div>
      <div className="split-bar" role="img" aria-label={`Where the price goes: ${summary}`}>
        {parts.map((p) => (
          <span key={p.key} title={`${p.label}: ${inr(p.amount)} (${pct(p.share)})`} style={{ flex: `${p.share} 1 0`, background: colour(p.key) }} />
        ))}
      </div>
      <ul className="split-key">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: colour(p.key) }} />
            <span>{p.label}</span>
            <b>{pct(p.share)}</b>
            <span className="amt">{inr(p.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
