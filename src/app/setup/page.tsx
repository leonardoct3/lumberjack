import type { Metadata } from "next";
import { authDisabled } from "@/auth/cookie";
import { SetupBoard } from "@/components/setup/setup-board";
import { sessionBanner } from "@/components/ui/session-banner";
import { readWaStatus } from "@/connector/status";
import { prisma } from "@/db/client";

export const metadata: Metadata = { title: "Central de conexão" };

export default async function SetupPage() {
  const statusPath = process.env.WA_STATUS_PATH ?? "./data/wa-status.json";
  const status = readWaStatus(statusPath);
  const banner = sessionBanner(status.state);
  const [groups, senders] = await Promise.all([
    prisma.group.findMany({ orderBy: { name: "asc" } }),
    prisma.sender.findMany({ orderBy: { name: "asc" } }),
  ]);

  const boardBanner =
    banner == null || banner.tone === "muted"
      ? null
      : { tone: banner.tone, text: banner.text };

  return (
    <main className="space-y-6">
      <SetupBoard
        connected={banner === null}
        banner={boardBanner}
        canLogout={!authDisabled()}
        groups={groups.map((group) => ({
          id: group.id,
          name: group.name,
          listen: group.listen,
        }))}
        senders={senders.map((sender) => ({
          id: sender.id,
          name: sender.name ?? sender.waId,
          role: sender.role,
        }))}
      />
    </main>
  );
}
