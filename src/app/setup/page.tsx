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
  const banner = sessionBanner(status.state, status.detail);
  const [listening, available, senders] = await Promise.all([
    prisma.group.findMany({
      where: { listen: true },
      select: { id: true, name: true, waId: true },
      orderBy: { name: "asc" },
    }),
    prisma.group.findMany({
      where: { listen: false },
      select: { id: true, name: true, waId: true },
      orderBy: { name: "asc" },
    }),
    prisma.sender.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <main className="space-y-6">
      <SetupBoard
        connected={banner === null}
        banner={banner}
        canLogout={!authDisabled()}
        listening={listening}
        available={available}
        senders={senders.map((sender) => ({
          id: sender.id,
          name: sender.name ?? sender.waId,
          role: sender.role,
        }))}
      />
    </main>
  );
}
