import { connection } from "next/server";
import { readWaStatus } from "@/connector/status";
import { AppNav } from "./app-nav";
import { SessionStrip } from "./session-strip";
import { ShellFrame } from "./shell-frame";

export async function AppShell({ children }: { children: React.ReactNode }) {
  await connection();
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
