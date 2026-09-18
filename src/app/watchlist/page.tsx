import type { Metadata } from "next";
import { verifyOperatorSession } from "@/auth/session";
import { hasPreviousEdition, listWatchlist } from "@/catalog/watchlist";
import {
  WatchlistBoard,
  type WatchlistItem,
} from "@/components/watchlist/watchlist-board";
import { prisma } from "@/db/client";
import { computePressure } from "@/domain/heat";
import { latestSnapshot } from "@/jobs/refresh-heat";
import { countdownLabel } from "@/lib/datetime";
import { now } from "@/lib/clock";

/** Same reading as the heat map, over seven days: buyers per seller. */
function pressureOf(
  snapshot: { uniqueDemandSenders7d: number; uniqueOfferSenders7d: number } | null,
): number | null {
  if (!snapshot) return null;
  return computePressure({
    uniqueDemandSenders: snapshot.uniqueDemandSenders7d,
    uniqueOfferSenders: snapshot.uniqueOfferSenders7d,
  });
}

export const metadata: Metadata = { title: "Fila de compra" };

export default async function WatchlistPage() {
  await verifyOperatorSession();
  const [parties, catalog] = await Promise.all([
    listWatchlist(prisma),
    prisma.party.findMany({
      select: { id: true, name: true, aliases: true, status: true },
    }),
  ]);

  // Computed here so server and client render the same relative label.
  const currentTime = now();
  const items: WatchlistItem[] = parties.map((party, index) => {
    const openLots = party.lots.filter((lot) => lot.closedAt == null);
    const eventAt = party.eventAt.toISOString();
    return {
      id: party.id,
      name: party.name,
      eventAt,
      countdown: countdownLabel(eventAt, currentTime),
      lotLabels: openLots
        .map((lot) => lot.label)
        .filter(Boolean)
        .join(", "),
      lotUrl: openLots.find((lot) => lot.url)?.url ?? null,
      heat: pressureOf(latestSnapshot(party.heatSnapshots)),
      previousEdition: hasPreviousEdition(party, catalog),
      canMoveUp: index > 0,
      canMoveDown: index < parties.length - 1,
      openLotIds: openLots.map((lot) => lot.id),
    };
  });

  return (
    <main>
      <WatchlistBoard items={items} />
    </main>
  );
}
