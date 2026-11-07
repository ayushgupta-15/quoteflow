"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  count?: number;
}

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={path === i.href || path.startsWith(`${i.href}/`) ? "page" : undefined}
        >
          {i.label}
          {i.count ? <span className="count">{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
