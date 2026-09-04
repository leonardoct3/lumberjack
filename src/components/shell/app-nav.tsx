"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, Inbox, ListOrdered, Settings2 } from "lucide-react";
import { isNavActive, NAV_LINKS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";

const NAV_META = {
  "/watchlist": { icon: ListOrdered, description: "Fila de compra" },
  "/heat": { icon: Flame, description: "Sinais e demanda" },
  "/inbox": { icon: Inbox, description: "Triagem" },
  "/setup": { icon: Settings2, description: "Conexões" },
} as const;

export function AppNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] border-r border-sidebar-border bg-sidebar/97 md:flex md:flex-col">
        <div className="border-b border-sidebar-border px-6 py-6">
          <BrandMark />
        </div>

        <nav aria-label="Navegação principal" className="flex-1 px-3 py-5">
          <p className="mb-2 px-3 font-mono text-[9px] font-medium tracking-[0.15em] text-muted-foreground/65 uppercase">
            Workspace
          </p>
          <div className="space-y-1">
            {NAV_LINKS.map((link) => {
              const active = isNavActive(pathname, link.href);
              const { icon: Icon, description } = NAV_META[link.href];
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 no-underline transition-all duration-200",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_1px_0_rgba(255,255,255,0.035)_inset]"
                      : "text-muted-foreground hover:bg-sidebar-accent/55 hover:text-foreground",
                  )}
                >
                  {active ? (
                    <span className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-primary" />
                  ) : null}
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg border transition-colors",
                      active
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-transparent bg-transparent group-hover:border-border group-hover:bg-background/35",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm leading-4 font-medium">
                      {link.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="m-4 rounded-xl border border-sidebar-border bg-background/35 p-3.5">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-25" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Operação local
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            Monitoramento ativo em São Paulo
          </p>
        </div>
      </aside>

      <nav
        aria-label="Navegação principal"
        className="fixed right-3 bottom-3 left-3 z-40 grid h-[68px] grid-cols-4 rounded-[18px] border border-border/90 bg-sidebar/96 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl md:hidden"
      >
        {NAV_LINKS.map((link) => {
          const active = isNavActive(pathname, link.href);
          const { icon: Icon } = NAV_META[link.href];
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium no-underline transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground active:bg-accent",
              )}
            >
              <Icon className="size-[18px]" aria-hidden="true" />
              <span className="truncate">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
