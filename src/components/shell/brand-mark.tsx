import { Trees } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-[11px] bg-primary text-primary-foreground shadow-[0_0_0_1px_rgba(193,107,255,0.28),0_8px_30px_rgba(193,107,255,0.12)]">
        <Trees className="size-[18px] stroke-[2.25]" aria-hidden="true" />
        <span className="absolute right-1 bottom-1 size-1 rounded-full bg-primary-foreground/45" />
      </span>
      {!compact ? (
        <span className="min-w-0">
          <span className="block text-[15px] leading-4 font-semibold tracking-[-0.03em]">
            Lumberjack
          </span>
          <span className="mt-1 block font-mono text-[9px] leading-3 tracking-[0.13em] text-muted-foreground uppercase">
            Signal desk
          </span>
        </span>
      ) : null}
    </div>
  );
}
