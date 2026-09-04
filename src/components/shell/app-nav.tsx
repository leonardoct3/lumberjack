"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavActive, NAV_LINKS } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function AppNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <nav
      className={cn(
        "border-border bg-sidebar z-20 flex items-center gap-4 border-b px-4 py-3",
        "md:fixed md:inset-y-0 md:h-full md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0",
        "fixed right-0 bottom-0 left-0 justify-around border-t border-b-0 md:justify-start",
      )}
    >
      <span className="text-foreground hidden font-semibold md:block">
        Lumberjack
      </span>
      {NAV_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "text-muted-foreground hover:text-foreground text-sm no-underline",
            isNavActive(pathname, l.href) && "text-primary font-medium",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
