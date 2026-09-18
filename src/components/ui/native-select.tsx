import * as React from "react";
import { cn } from "@/lib/utils";

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-10 w-full rounded-[10px] border border-input bg-background/55 px-3.5 text-sm outline-none transition-colors hover:border-muted-foreground/45 focus:border-ring focus:ring-3 focus:ring-ring/12 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
