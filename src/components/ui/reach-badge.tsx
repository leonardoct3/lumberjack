import { Megaphone } from "lucide-react";

export function ReachBadge({ groups }: { groups: number }) {
  if (groups < 2) return null;
  return (
    <span
      title={`A mesma mensagem apareceu em ${groups} grupos`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary tabular-nums"
    >
      <Megaphone className="size-3" aria-hidden="true" />
      {groups} grupos
    </span>
  );
}
