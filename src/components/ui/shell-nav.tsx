"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/watchlist", label: "Watchlist" },
  { href: "/heat", label: "Calor" },
  { href: "/inbox", label: "Inbox" },
  { href: "/setup", label: "Setup" },
] as const;

export function ShellNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <nav className="shell-nav">
      <span>Lumberjack</span>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={pathname.startsWith(l.href) ? "is-active" : undefined}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
