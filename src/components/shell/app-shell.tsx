import { unstable_noStore as noStore } from "next/cache";
import { readWaStatus } from "@/connector/status";
import { AppNav } from "./app-nav";
import { SessionStrip } from "./session-strip";
import { ShellFrame } from "./shell-frame";

export function AppShell({ children }: { children: React.ReactNode }) {
  noStore();
  const status = readWaStatus(
    process.env.WA_STATUS_PATH ?? "./data/wa-status.json",
  );
  return (
    <>
      <AppNav />
      <ShellFrame>
        <SessionStrip state={status.state} />
        {children}
      </ShellFrame>
    </>
  );
}
