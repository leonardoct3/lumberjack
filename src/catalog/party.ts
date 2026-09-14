import type { Platform, PartyStatus, PrismaClient } from "@prisma/client";
import { canAppearOnWatchlist } from "@/domain/gates";

export type AddLotInput = {
  partyId: string;
  label: string;
  url?: string;
  price?: number;
  platform?: Platform;
};

export async function addLot(
  db: PrismaClient,
  input: AddLotInput,
): Promise<{ lotId: string }> {
  const now = new Date();

  return db.$transaction(async (tx) => {
    const party = await tx.party.findUniqueOrThrow({
      where: { id: input.partyId },
    });

    const lot = await tx.lot.create({
      data: {
        partyId: party.id,
        label: input.label,
        openedAt: now,
        officialPrice: input.price,
        url: input.url,
        platform: input.platform ?? "unknown",
      },
    });

    if (
      canAppearOnWatchlist({ status: party.status, hasOpenLot: true }) &&
      party.watchlistPosition == null
    ) {
      const agg = await tx.party.aggregate({
        _max: { watchlistPosition: true },
      });
      await tx.party.update({
        where: { id: party.id },
        data: { watchlistPosition: (agg._max.watchlistPosition ?? 0) + 1 },
      });
    }

    return { lotId: lot.id };
  });
}

/** Every field is required: the edit form always submits all of them, so empty means clear. */
export type UpdateLotInput = {
  lotId: string;
  label: string;
  url: string | null;
  price: number | null;
  platform: Platform;
};

export async function updateLot(
  db: PrismaClient,
  input: UpdateLotInput,
): Promise<void> {
  await db.lot.update({
    where: { id: input.lotId },
    data: {
      label: input.label,
      url: input.url,
      officialPrice: input.price,
      platform: input.platform,
    },
  });
}

export type UpdatePartyInput = {
  partyId: string;
  name: string;
  eventAt: Date;
  status: PartyStatus;
  aliases: string[];
  qualitativeScore?: number | null;
  notes?: string | null;
};

export async function updateParty(
  db: PrismaClient,
  input: UpdatePartyInput,
): Promise<void> {
  await db.party.update({
    where: { id: input.partyId },
    data: {
      name: input.name,
      eventAt: input.eventAt,
      status: input.status,
      aliases: input.aliases,
      qualitativeScore: input.qualitativeScore,
      notes: input.notes,
      ...(input.status !== "upcoming" ? { watchlistPosition: null } : {}),
    },
  });
}

export async function enqueueWatchlist(
  db: PrismaClient,
  partyId: string,
): Promise<void> {
  const party = await db.party.findUniqueOrThrow({
    where: { id: partyId },
    include: { lots: true },
  });
  const hasOpenLot = party.lots.some((lot) => lot.closedAt == null);
  if (
    !canAppearOnWatchlist({ status: party.status, hasOpenLot }) ||
    party.watchlistPosition != null
  ) {
    return;
  }

  const agg = await db.party.aggregate({
    _max: { watchlistPosition: true },
  });
  await db.party.update({
    where: { id: partyId },
    data: { watchlistPosition: (agg._max.watchlistPosition ?? 0) + 1 },
  });
}
