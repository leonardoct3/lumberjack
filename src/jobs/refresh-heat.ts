import type { PrismaClient } from "@prisma/client";
import { canRankOnHeat } from "@/domain/gates";
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

/** The snapshot counts people, so cross-posting cannot inflate a window. */
function countPeople<T extends { senderId: string }>(signals: T[]): number {
  return new Set(signals.map((signal) => signal.senderId)).size;
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

      const demandIn = (days: number) => countInWindow(demand, now, days);
      const offerIn = (days: number) => countInWindow(offer, now, days);

      await db.heatSnapshot.create({
        data: {
          partyId: party.id,
          computedAt: now,
          demand1d: demandIn(1).length,
          demand3d: demandIn(3).length,
          demand7d: demandIn(7).length,
          offer1d: offerIn(1).length,
          offer3d: offerIn(3).length,
          offer7d: offerIn(7).length,
          uniqueDemandSenders1d: countPeople(demandIn(1)),
          uniqueDemandSenders3d: countPeople(demandIn(3)),
          uniqueDemandSenders7d: countPeople(demandIn(7)),
          uniqueOfferSenders1d: countPeople(offerIn(1)),
          uniqueOfferSenders3d: countPeople(offerIn(3)),
          uniqueOfferSenders7d: countPeople(offerIn(7)),
          daysToEvent: daysUntil(party.eventAt, now),
        },
      });
      counted += 1;
    }

    return { ok: true, parties: counted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
