import { connection } from "next/server";
import { monitorNavState, sessionBanner } from "@/components/ui/session-banner";
import { currentWaStatus } from "@/lib/current-wa-status";
import { now } from "@/lib/clock";
import { AppNav } from "./app-nav";
import { SessionStrip } from "./session-strip";
import { ShellChrome } from "./shell-chrome";
import { ShellFrame } from "./shell-frame";

export async function AppShell({ children }: { children: React.ReactNode }) {
  await connection();
  const status = await currentWaStatus();
  const guidance = sessionBanner(status, now());
  return (
    <ShellChrome>
      <AppNav monitor={monitorNavState(guidance)} />
      <ShellFrame>
        <SessionStrip banner={guidance} />
        {children}
      </ShellFrame>
    </ShellChrome>
  );
}
