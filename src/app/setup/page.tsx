import type { Metadata } from "next";
import { authDisabled } from "@/auth/cookie";
import { verifyOperatorSession } from "@/auth/session";
import { SetupBoard } from "@/components/setup/setup-board";
import { sessionBanner } from "@/components/ui/session-banner";
import { prisma } from "@/db/client";
import { senderShape } from "@/domain/sender-shape";
import { formatWhen } from "@/lib/datetime";
import { currentWaStatus } from "@/lib/current-wa-status";
import { now } from "@/lib/clock";
import { toDataURL } from "qrcode";

export const metadata: Metadata = { title: "Central de conexão" };

/** Long enough to cover a festa cycle, short enough to read as "now". */
export const SENDER_WINDOW_DAYS = 30;

export default async function SetupPage() {
  await verifyOperatorSession();
  const status = await currentWaStatus();
  const currentTime = now();
  const banner = sessionBanner(status, currentTime);
  const since = new Date(currentTime - SENDER_WINDOW_DAYS * 864e5);

  const [listening, available, senders, byClass, signals, candidates, qrDataUrl] =
    await Promise.all([
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
      // What each sender actually produced, which is what a mute decision is
      // made from. The declared role told two senders apart by nothing.
      prisma.message.groupBy({
        by: ["senderId", "class"],
        where: { sentAt: { gte: since } },
        _count: { _all: true },
        _max: { sentAt: true },
      }),
      prisma.signal.groupBy({
        by: ["senderId"],
        where: { message: { sentAt: { gte: since } } },
        _count: { _all: true },
      }),
      prisma.message.groupBy({
        by: ["senderId"],
        where: { sentAt: { gte: since }, candidates: { some: {} } },
        _count: { _all: true },
      }),
      status.state === "qr" && status.qr
        ? toDataURL(status.qr, { margin: 1, width: 280 })
        : Promise.resolve(null),
    ]);

  type Tally = { messages: number; ads: number; pista: number; lastAt: Date | null };
  const tally = new Map<string, Tally>();
  for (const row of byClass) {
    const current =
      tally.get(row.senderId) ??
      ({ messages: 0, ads: 0, pista: 0, lastAt: null } satisfies Tally);
    const count = row._count._all;
    current.messages += count;
    if (row.class === "admin_promo") current.ads += count;
    if (row.class === "pista_oferta" || row.class === "pista_procura") {
      current.pista += count;
    }
    const last = row._max.sentAt;
    if (last && (!current.lastAt || last > current.lastAt)) current.lastAt = last;
    tally.set(row.senderId, current);
  }

  const signalCount = new Map(signals.map((r) => [r.senderId, r._count._all]));
  const candidateCount = new Map(candidates.map((r) => [r.senderId, r._count._all]));

  return (
    <main className="space-y-6">
      <SetupBoard
        connected={banner === null}
        banner={banner}
        qrDataUrl={qrDataUrl}
        canLogout={!authDisabled()}
        listening={listening}
        available={available}
        windowDays={SENDER_WINDOW_DAYS}
        senders={senders.map((sender) => {
          const counts = tally.get(sender.id);
          return {
            id: sender.id,
            name: sender.name ?? sender.waId,
            muted: sender.muted,
            groupAdmin: sender.role === "admin",
            shape: senderShape({
              ads: counts?.ads ?? 0,
              pista: counts?.pista ?? 0,
            }),
            messages: counts?.messages ?? 0,
            signals: signalCount.get(sender.id) ?? 0,
            candidates: candidateCount.get(sender.id) ?? 0,
            lastLabel: counts?.lastAt ? formatWhen(counts.lastAt.toISOString()) : null,
          };
        })}
      />
    </main>
  );
}
