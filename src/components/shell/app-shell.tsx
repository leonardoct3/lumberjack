import { connection } from "next/server";
import { sessionBanner } from "@/components/ui/session-banner";
import { readWaStatus } from "@/connector/status";
import { prisma } from "@/db/client";
import { AppNav } from "./app-nav";
import { SessionStrip } from "./session-strip";
import { ShellChrome } from "./shell-chrome";
import { ShellFrame } from "./shell-frame";

export async function AppShell({ children }: { children: React.ReactNode }) {
  await connection();
  const status = await readWaStatus(prisma);
  return (
    <ShellChrome>
      <AppNav />
      <ShellFrame>
        <SessionStrip banner={sessionBanner(status, Date.now())} />
        {children}
      </ShellFrame>
    </ShellChrome>
  );
}
