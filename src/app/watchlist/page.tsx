import type { Metadata } from "next";
import { hasPreviousEdition, listWatchlist } from "@/catalog/watchlist";
import {
  WatchlistBoard,
  type WatchlistItem,
} from "@/components/watchlist/watchlist-board";
import { prisma } from "@/db/client";
import { latestSnapshot } from "@/jobs/refresh-heat";

export const metadata: Metadata = { title: "Fila de compra" };

export default async function WatchlistPage() {
  const [parties, catalog] = await Promise.all([
    listWatchlist(prisma),
    prisma.party.findMany({
      select: { id: true, name: true, aliases: true, status: true },
    }),
  ]);

  const items: WatchlistItem[] = parties.map((party, index) => {
    const openLots = party.lots.filter((lot) => lot.closedAt == null);
    return {
      id: party.id,
      name: party.name,
      eventAt: party.eventAt.toISOString(),
      lotLabels: openLots.map((lot) => lot.label).filter(Boolean).join(", "),
      lotUrl: openLots.find((lot) => lot.url)?.url ?? null,
      heat: latestSnapshot(party.heatSnapshots)?.score ?? null,
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
