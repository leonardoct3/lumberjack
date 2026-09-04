import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  icon: Icon,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2">
          {Icon ? (
            <span className="grid size-7 place-items-center rounded-lg border border-primary/20 bg-primary/8 text-primary">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
          ) : null}
          {eyebrow ? (
            <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-primary uppercase">
              {eyebrow}
            </p>
          ) : null}
        </div>
        <h1 className="max-w-3xl text-3xl leading-[1.05] font-semibold tracking-[-0.045em] text-balance md:text-[42px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-[15px]">
            {description}
          </p>
        ) : null}
        {meta ? <div className="mt-4">{meta}</div> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
export function SectionHeader({
  title,
  description,
  count,
  actions,
}: {
  title: string;
  description?: string;
  count?: number;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-semibold tracking-[-0.025em]">{title}</h2>
          {count != null ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {String(count).padStart(2, "0")}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
