import { Nav, type NavItem } from "@/components/Nav";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { logoutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const pending =
    user.role === "sales_head"
      ? ((await query<{ n: number }>("select count(*) as n from quotes where status = 'pending_approval'"))[0]?.n ?? 0)
      : 0;

  const items: NavItem[] = [
    { href: "/rfqs", label: "RFQs" },
    ...(user.role === "sales_head" ? [{ href: "/approvals", label: "Approvals", count: pending }] : []),
    { href: "/rates", label: "Rate masters" },
    { href: "/past", label: "Past quotes" },
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            QuoteFlow<span>Company A, Chakan</span>
          </div>
          <Nav items={items} />
          <div className="userbox">
            <span>
              {user.name} · {user.role === "sales_head" ? "Sales head" : "Estimator"}
            </span>
            <form action={logoutAction}>
              <button className="btn sm">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
