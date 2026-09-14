import type { Metadata } from "next";
import { authDisabled } from "@/auth/cookie";
import { SetupBoard } from "@/components/setup/setup-board";
import { sessionBanner } from "@/components/ui/session-banner";
import { readWaStatus } from "@/connector/status";
import { prisma } from "@/db/client";
import { toDataURL } from "qrcode";

export const metadata: Metadata = { title: "Central de conexão" };

export default async function SetupPage() {
  const status = await readWaStatus(prisma);
  const banner = sessionBanner(status, Date.now());
  const [listening, available, senders, qrDataUrl] = await Promise.all([
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
    status.state === "qr" && status.qr
      ? toDataURL(status.qr, { margin: 1, width: 280 })
      : Promise.resolve(null),
  ]);

  return (
    <main className="space-y-6">
      <SetupBoard
        connected={banner === null}
        banner={banner}
        qrDataUrl={qrDataUrl}
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
