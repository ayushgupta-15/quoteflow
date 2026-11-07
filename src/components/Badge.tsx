import { STATUS_LABEL, STATUS_TONE } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? ""}`}>{STATUS_LABEL[status] ?? status}</span>;
}
