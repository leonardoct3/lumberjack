"use client";

import { usePathname } from "next/navigation";
import { BrandMark } from "./brand-mark";

export function ShellFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="sidebar-main min-h-screen">
      <div className="flex h-[70px] items-center justify-between border-b border-border/70 bg-background/80 px-5 backdrop-blur-xl md:hidden">
        <BrandMark compact />
        <span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
          <span className="size-1.5 rounded-full bg-primary" />
          Live desk
        </span>
      </div>
      <div className="mx-auto w-full max-w-[1320px] px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-12 xl:px-10">
        <div className="page-enter">{children}</div>
      </div>
    </div>
  );
}
