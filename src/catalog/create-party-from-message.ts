import type { PrismaClient, SignalType } from "@prisma/client";
import { isPastEvent } from "@/domain/gates";

export type CreatePartyFromMessageInput = {
  messageId: string;
  name: string;
  eventAt: Date;
  aliases?: string[];
};

/**
 * Catalogs a party the operator only learned about through a pista message.
 * No lot is created, so `canAppearOnWatchlist` keeps it out of the buy queue
 * until an official lot shows up — it ranks on Heat and nothing else.
 */
export async function createPartyFromMessage(
  db: PrismaClient,
  input: CreatePartyFromMessageInput,
  now: Date,
): Promise<{ partyId: string; signalId: string }> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("createPartyFromMessage requires a name");
  }

  const message = await db.message.findUniqueOrThrow({
    where: { id: input.messageId },
    include: { signals: { select: { id: true } } },
  });
  if (message.class !== "pista_oferta" && message.class !== "pista_procura") {
    throw new Error(
      "createPartyFromMessage requires pista_oferta or pista_procura",
    );
  }
  if (message.signals.length > 0) {
    throw new Error("createPartyFromMessage message already has a signal");
  }

  const type: SignalType =
    message.class === "pista_oferta" ? "offer" : "demand";

  return db.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        name,
        aliases: input.aliases ?? [],
        eventAt: input.eventAt,
        status: isPastEvent(input.eventAt, now) ? "past" : "upcoming",
      },
    });

    const signal = await tx.signal.create({
      data: {
        type,
        partyId: party.id,
        messageId: message.id,
        senderId: message.senderId,
      },
    });

    await tx.message.update({
      where: { id: message.id },
      data: { partyId: party.id, dismissedAt: null },
    });

    return { partyId: party.id, signalId: signal.id };
  });
}
