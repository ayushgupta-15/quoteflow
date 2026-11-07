import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getUser()) redirect("/rfqs");
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>QuoteFlow</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          RFQ-to-quote costing for Company A, Chakan. Named users only.
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
