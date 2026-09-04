import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <Card
      className={`items-center justify-center border-dashed bg-card/45 px-6 text-center ${compact ? "min-h-40 py-8" : "min-h-56 py-12"}`}
    >
      <span className="grid size-11 place-items-center rounded-xl border border-border bg-background/60 text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="-mt-3 space-y-1.5">
        <p className="font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="-mt-3">{action}</div> : null}
    </Card>
  );
}
