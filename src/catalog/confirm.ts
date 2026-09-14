import type { Platform, PrismaClient } from "@prisma/client";
import { isPastEvent } from "@/domain/gates";

export type ConfirmCandidateInput = {
  candidateId: string;
  name: string;
  eventAt: Date;
  lotLabel?: string;
  url?: string;
  officialPrice?: number;
  qualitativeScore?: number;
  platform?: Platform;
};

export async function confirmCandidate(
  db: PrismaClient,
  input: ConfirmCandidateInput,
  now: Date,
): Promise<{ partyId: string; lotId: string | null }> {
  if (!input.name || !input.eventAt) {
    throw new Error("confirmCandidate requires name and eventAt");
  }

  const status = isPastEvent(input.eventAt, now) ? "past" : "upcoming";
  const shouldCreateLot =
    input.lotLabel != null || input.url != null || input.officialPrice != null;

  return db.$transaction(async (tx) => {
    const claimed = await tx.partyCandidate.updateMany({
      where: { id: input.candidateId, status: "pending" },
      data: { status: "confirmed" },
    });
    if (claimed.count === 0) {
      throw new Error("confirmCandidate requires a pending candidate");
    }

    const candidate = await tx.partyCandidate.findUniqueOrThrow({
      where: { id: input.candidateId },
    });

    let watchlistPosition: number | null = null;
    if (shouldCreateLot && status === "upcoming") {
      const agg = await tx.party.aggregate({
        _max: { watchlistPosition: true },
      });
      watchlistPosition = (agg._max.watchlistPosition ?? 0) + 1;
    }

    const party = await tx.party.create({
      data: {
        name: input.name,
        aliases: [],
        eventAt: input.eventAt,
        status,
        qualitativeScore: input.qualitativeScore,
        watchlistPosition,
      },
    });

    let lotId: string | null = null;
    if (shouldCreateLot) {
      const lot = await tx.lot.create({
        data: {
          partyId: party.id,
          label: input.lotLabel ?? "",
          openedAt: now,
          officialPrice: input.officialPrice,
          url: input.url,
          platform: input.platform ?? "unknown",
        },
      });
      lotId = lot.id;
    }

    await tx.message.update({
      where: { id: candidate.sourceMessageId },
      data: { partyId: party.id },
    });

    return { partyId: party.id, lotId };
  });
}
