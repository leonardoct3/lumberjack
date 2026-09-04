import { readWaStatus } from "@/connector/status";
import { AppNav } from "./app-nav";
import { SessionStrip } from "./session-strip";

export function AppShell({ children }: { children: React.ReactNode }) {
  const status = readWaStatus(
    process.env.WA_STATUS_PATH ?? "./data/wa-status.json",
  );
  return (
    <>
      <AppNav />
      <div className="md:pl-56">
        <div className="mx-auto max-w-[1100px] px-4 pt-4 pb-24 md:pb-8">
          <SessionStrip state={status.state} />
          {children}
        </div>
      </div>
    </>
  );
}
