"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") {
    return null;
  }

  return (
    <nav>
      <Link href="/watchlist">Watchlist</Link>
      {" | "}
      <Link href="/heat">Calor</Link>
      {" | "}
      <Link href="/inbox">Inbox</Link>
    </nav>
  );
}
