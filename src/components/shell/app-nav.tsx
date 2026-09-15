"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  Flame,
  Inbox,
  ListOrdered,
  Settings2,
} from "lucide-react";
import { isNavActive, NAV_LINKS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";
import { useSidebar } from "./sidebar-context";

const NAV_META = {
  "/watchlist": { icon: ListOrdered, description: "Fila de compra" },
  "/heat": { icon: Flame, description: "Sinais e demanda" },
  "/inbox": { icon: Inbox, description: "Triagem" },
  "/setup": { icon: Settings2, description: "Conexões" },
} as const;

export function AppNav() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();
  if (pathname === "/login") return null;

  return (
    <>
      <aside
        id="app-sidebar"
        className="sidebar-panel fixed inset-y-0 left-0 z-30 hidden border-r border-sidebar-border bg-sidebar/97 md:flex md:flex-col"
      >
        <div className="h-[77px] overflow-hidden border-b border-sidebar-border px-[18px] py-5">
          <BrandMark className="sidebar-brand" />
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className="sidebar-toggle absolute top-[57px] -right-5 z-10 grid size-10 place-items-center rounded-full border border-sidebar-border bg-sidebar text-muted-foreground shadow-[0_8px_24px_rgba(0,0,0,0.38)] outline-none hover:border-primary/35 hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft
            className="sidebar-toggle-icon size-4"
            aria-hidden="true"
          />
        </button>

        <nav
          aria-label="Navegação principal"
          className="flex-1 overflow-hidden px-2 py-4"
        >
          <p className="sidebar-copy mb-2 h-4 whitespace-nowrap px-3 font-mono text-[9px] font-medium tracking-[0.15em] text-muted-foreground/65 uppercase">
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
                  title={collapsed ? link.label : undefined}
                  aria-label={link.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 no-underline transition-colors duration-200",
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
                  <span className="sidebar-copy min-w-0 shrink-0 whitespace-nowrap">
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

        <div
          title={collapsed ? "Operação ativa" : undefined}
          className="mx-2 mb-3 flex min-h-14 items-center gap-3 overflow-hidden rounded-xl border border-sidebar-border bg-background/35 px-3 py-2.5"
        >
          <span className="grid size-8 shrink-0 place-items-center">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-25" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
          </span>
          <span className="sidebar-copy shrink-0 whitespace-nowrap">
            <span className="block text-xs font-medium">Operação</span>
            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
              Monitoramento ativo em São Paulo
            </span>
          </span>
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
