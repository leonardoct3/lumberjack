import { connection } from "next/server";
import {
  monitorNavState,
  sessionBanner,
} from "@/components/ui/session-banner";
import { readWaStatus } from "@/connector/status";
import { prisma } from "@/db/client";
import { AppNav } from "./app-nav";
import { SessionStrip } from "./session-strip";
import { ShellChrome } from "./shell-chrome";
import { ShellFrame } from "./shell-frame";

export async function AppShell({ children }: { children: React.ReactNode }) {
  await connection();
  const status = await readWaStatus(prisma);
  const guidance = sessionBanner(status, Date.now());
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
