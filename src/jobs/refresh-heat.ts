import type { PrismaClient } from "@prisma/client";
import { canRankOnHeat } from "@/domain/gates";
import { computeHeatScore } from "@/domain/heat";
import { daysUntil } from "@/domain/timezone";

const MS_PER_DAY = 864e5;

export function latestSnapshot<T extends { computedAt: Date }>(
  snaps: T[],
): T | null {
  return (
    snaps.slice().sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime())[0] ??
    null
  );
}

function countInWindow<T extends { message: { sentAt: Date } }>(
  signals: T[],
  now: Date,
  days: number,
): T[] {
  const cutoff = now.getTime() - days * MS_PER_DAY;
  return signals.filter((s) => s.message.sentAt.getTime() >= cutoff);
}

export async function refreshHeat(
  db: PrismaClient,
  now: Date,
): Promise<{ ok: true; parties: number } | { ok: false; error: string }> {
  try {
    const parties = await db.party.findMany({
      include: { signals: { include: { message: true } } },
    });

    let counted = 0;
    for (const party of parties) {
      if (!canRankOnHeat(party.status)) continue;

      const demand = party.signals.filter((s) => s.type === "demand");
      const offer = party.signals.filter((s) => s.type === "offer");

      const demand1d = countInWindow(demand, now, 1).length;
      const demand3d = countInWindow(demand, now, 3).length;
      const demand7dSignals = countInWindow(demand, now, 7);
      const demand7d = demand7dSignals.length;
      const uniqueDemandSenders7d = new Set(demand7dSignals.map((s) => s.senderId)).size;
      const offer1d = countInWindow(offer, now, 1).length;
      const offer3d = countInWindow(offer, now, 3).length;
      const offer7d = countInWindow(offer, now, 7).length;

      await db.heatSnapshot.create({
        data: {
          partyId: party.id,
          computedAt: now,
          demand1d,
          demand3d,
          demand7d,
          offer1d,
          offer3d,
          offer7d,
          uniqueDemandSenders7d,
          daysToEvent: daysUntil(party.eventAt, now),
          score: computeHeatScore({
            demand1d,
            demand3d,
            demand7d,
            uniqueDemandSenders7d,
            offer1d,
            offer3d,
          }),
        },
      });
      counted += 1;
    }

    return { ok: true, parties: counted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
