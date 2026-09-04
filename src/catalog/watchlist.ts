import type { PrismaClient } from "@prisma/client";
import { canAppearOnWatchlist } from "@/domain/gates";
import { normalizeText } from "@/domain/normalize";

const ORPHAN_CLASSES = ["pista_oferta", "pista_procura"] as const;

export async function listWatchlist(db: PrismaClient) {
  const parties = await db.party.findMany({
    where: {
      status: "upcoming",
      watchlistPosition: { not: null },
      lots: { some: { closedAt: null } },
    },
    include: { lots: true, heatSnapshots: true },
    orderBy: { watchlistPosition: "asc" },
  });

  return parties.filter((party) =>
    canAppearOnWatchlist({
      status: party.status,
      hasOpenLot: party.lots.some((lot) => lot.closedAt == null),
    }),
  );
}

export async function moveWatchlist(
  db: PrismaClient,
  partyId: string,
  direction: "up" | "down",
): Promise<void> {
  const queued = await db.party.findMany({
    where: { watchlistPosition: { not: null } },
    orderBy: { watchlistPosition: "asc" },
  });
  const index = queued.findIndex((party) => party.id === partyId);
  if (index < 0) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  const neighbor = queued[swapIndex];
  const current = queued[index];
  if (!neighbor || current.watchlistPosition == null || neighbor.watchlistPosition == null) {
    return;
  }

  await db.$transaction([
    db.party.update({
      where: { id: current.id },
      data: { watchlistPosition: neighbor.watchlistPosition },
    }),
    db.party.update({
      where: { id: neighbor.id },
      data: { watchlistPosition: current.watchlistPosition },
    }),
  ]);
}

export async function removeFromWatchlist(
  db: PrismaClient,
  partyId: string,
): Promise<void> {
  await db.party.update({
    where: { id: partyId },
    data: { watchlistPosition: null },
  });
}

export async function closeLot(
  db: PrismaClient,
  lotId: string,
  now: Date,
): Promise<void> {
  const lot = await db.lot.update({
    where: { id: lotId },
    data: { closedAt: now },
  });

  const remainingOpen = await db.lot.count({
    where: { partyId: lot.partyId, closedAt: null },
  });
  if (remainingOpen === 0) {
    await db.party.update({
      where: { id: lot.partyId },
      data: { watchlistPosition: null },
    });
  }
}

export async function homeDestination(
  db: PrismaClient,
): Promise<"/inbox" | "/watchlist" | "/heat"> {
  const [pending, orphans] = await Promise.all([
    db.partyCandidate.count({ where: { status: "pending" } }),
    db.message.count({
      where: {
        class: { in: [...ORPHAN_CLASSES] },
        signals: { none: {} },
      },
    }),
  ]);
  if (pending > 0 || orphans > 0) return "/inbox";

  const watchlist = await listWatchlist(db);
  if (watchlist.length > 0) return "/watchlist";
  return "/heat";
}

export function hasPreviousEdition(
  party: { id: string; name: string; aliases: string[] },
  others: { id: string; name: string; aliases: string[]; status: string }[],
): boolean {
  const tokens = new Set(
    [party.name, ...party.aliases].map(normalizeText).filter((t) => t.length > 0),
  );
  return others.some((other) => {
    if (other.id === party.id || other.status !== "past") return false;
    return [other.name, ...other.aliases]
      .map(normalizeText)
      .some((token) => token.length > 0 && tokens.has(token));
  });
}
