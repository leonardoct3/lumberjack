import Image from "next/image";
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
      <span className="relative grid size-9 shrink-0 place-items-center rounded-[11px] bg-primary/10 shadow-[0_0_0_1px_rgba(193,107,255,0.28),0_8px_30px_rgba(193,107,255,0.16)]">
        <Image
          src="/lumberjack-fury-icon.png"
          alt=""
          width={36}
          height={36}
          sizes="36px"
          className="size-full object-contain p-px"
        />
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
