import type { Metadata } from "next";
import Link from "next/link";
import { loadRates, today } from "@/lib/services";
import { IntakeFlow } from "./IntakeFlow";

export const metadata: Metadata = { title: "New RFQ" };
export const dynamic = "force-dynamic";

export default async function NewRfq() {
  const rates = await loadRates();
  const materials = [
    ...new Set(rates.filter((r) => r.kind === "material" && !r.code.endsWith("-SCRAP")).map((r) => r.code)),
  ];
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="crumb">
            <Link href="/rfqs">RFQs</Link> / New
          </div>
          <h1>New RFQ</h1>
          <p className="sub">
            Paste the customer's email, upload the part list, or both. Every value we read shows where it
            came from and waits for your OK.
          </p>
        </div>
      </div>
      <IntakeFlow materials={materials} aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)} today={await today()} />
    </div>
  );
}
