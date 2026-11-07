const inrFmt = (dp: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function inr(n: number, dp = 2): string {
  return `₹${inrFmt(dp).format(n)}`;
}

export function num(n: number, dp = 0): string {
  return inrFmt(dp).format(n);
}

/** ₹12,34,567 -> "₹12.35 lakh"; 1.2 crore and above in crore. */
export function inrShort(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} crore`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} lakh`;
  return inr(n, 0);
}

export function dateLabel(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTimeLabel(d: string | Date): string {
  return new Date(d).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const STATUS_LABEL: Record<string, string> = {
  estimating: "Estimating",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  sent: "Sent",
  won: "Won",
  lost: "Lost",
  rejected: "Sent back",
  superseded: "Superseded",
};

export const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "info" | ""> = {
  estimating: "info",
  pending_approval: "warn",
  approved: "ok",
  sent: "info",
  won: "ok",
  lost: "bad",
  rejected: "bad",
  superseded: "",
};
