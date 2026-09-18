import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Stat = { label: string; value: ReactNode };

export function StatGrid({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-[var(--radius)] border border-border/80 bg-card",
        stats.length === 2 && "grid-cols-2",
        stats.length === 3 && "grid-cols-3",
        stats.length === 4 && "grid-cols-2 md:grid-cols-4",
        className,
      )}
    >
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn("min-w-0 p-4 md:p-5", index > 0 && "border-l border-border/80")}
        >
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            {stat.label}
          </p>
          <div className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  );
}
