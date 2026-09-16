import type { PrismaClient } from "@prisma/client";
import { canAppearOnWatchlist } from "@/domain/gates";
import { normalizeText } from "@/domain/normalize";

export type MergePartiesInput = {
  /** The duplicate, which stops existing. */
  sourceId: string;
  /** The survivor, which keeps its id, name and queue position. */
  targetId: string;
};

export type MergePartiesResult = {
  signals: number;
  messages: number;
  lots: number;
};

/**
 * Folds a duplicate party into the one the operator wants to keep. Signals,
 * messages and lots move over, and the duplicate's name becomes an alias of
 * the survivor so the next message matches without a second round of cleanup.
 */
export async function mergeParties(
  db: PrismaClient,
  input: MergePartiesInput,
): Promise<MergePartiesResult> {
  if (input.sourceId === input.targetId) {
    throw new Error("mergeParties cannot merge a party into itself");
  }

  return db.$transaction(async (tx) => {
    const source = await tx.party.findUniqueOrThrow({
      where: { id: input.sourceId },
    });
    const target = await tx.party.findUniqueOrThrow({
      where: { id: input.targetId },
    });

    const [signals, messages, lots] = await Promise.all([
      tx.signal.updateMany({
        where: { partyId: source.id },
        data: { partyId: target.id },
      }),
      tx.message.updateMany({
        where: { partyId: source.id },
        data: { partyId: target.id },
      }),
      tx.lot.updateMany({
        where: { partyId: source.id },
        data: { partyId: target.id },
      }),
    ]);

    const openLots = await tx.lot.count({
      where: { partyId: target.id, closedAt: null },
    });
    const takesQueueSlot =
      target.watchlistPosition == null &&
      canAppearOnWatchlist({ status: target.status, hasOpenLot: openLots > 0 });
    // Inherit the duplicate's slot when it had one: the festa keeps its place
    // in the queue instead of being pushed to the back by the cleanup.
    const nextPosition = takesQueueSlot
      ? (source.watchlistPosition ??
        ((await tx.party.aggregate({ _max: { watchlistPosition: true } }))._max
          .watchlistPosition ?? 0) + 1)
      : null;

    await tx.party.update({
      where: { id: target.id },
      data: {
        aliases: mergeAliases(target, source),
        qualitativeScore: target.qualitativeScore ?? source.qualitativeScore,
        notes: target.notes ?? source.notes,
        ...(nextPosition != null ? { watchlistPosition: nextPosition } : {}),
      },
    });

    // Derived rows: the worker recomputes the survivor on its next pass.
    await tx.heatSnapshot.deleteMany({ where: { partyId: source.id } });
    await tx.party.delete({ where: { id: source.id } });

    return {
      signals: signals.count,
      messages: messages.count,
      lots: lots.count,
    };
  });
}

function mergeAliases(
  target: { name: string; aliases: string[] },
  source: { name: string; aliases: string[] },
): string[] {
  const seen = new Set([normalizeText(target.name)]);
  const merged: string[] = [];

  for (const alias of [...target.aliases, source.name, ...source.aliases]) {
    const key = normalizeText(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(alias);
  }

  return merged;
}
