import type { PrismaClient, SignalType } from "@prisma/client";

export type LinkOrphanInput = {
  messageId: string;
  partyId: string;
};

/**
 * Links a batch to one party. Messages already carrying a signal are skipped
 * rather than failing the batch, so a stale selection never blocks the rest.
 */
export async function linkOrphans(
  db: PrismaClient,
  input: { messageIds: string[]; partyId: string },
): Promise<{ linked: number; skipped: number }> {
  const party = await db.party.findUniqueOrThrow({
    where: { id: input.partyId },
  });
  if (party.status !== "upcoming") {
    throw new Error("linkOrphans requires an upcoming party");
  }

  let linked = 0;
  let skipped = 0;
  for (const messageId of input.messageIds) {
    const message = await db.message.findUniqueOrThrow({
      where: { id: messageId },
      include: { signals: { select: { id: true } } },
    });
    if (
      message.signals.length > 0 ||
      (message.class !== "pista_oferta" && message.class !== "pista_procura")
    ) {
      skipped += 1;
      continue;
    }

    await linkOrphan(db, { messageId, partyId: input.partyId });
    linked += 1;
  }

  return { linked, skipped };
}

export async function linkOrphan(
  db: PrismaClient,
  input: LinkOrphanInput,
): Promise<void> {
  const [message, party] = await Promise.all([
    db.message.findUniqueOrThrow({
      where: { id: input.messageId },
    }),
    db.party.findUniqueOrThrow({
      where: { id: input.partyId },
    }),
  ]);

  if (party.status !== "upcoming") {
    throw new Error("linkOrphan requires an upcoming party");
  }
  if (message.class !== "pista_oferta" && message.class !== "pista_procura") {
    throw new Error("linkOrphan requires pista_oferta or pista_procura");
  }

  const type: SignalType =
    message.class === "pista_oferta" ? "offer" : "demand";

  await db.$transaction([
    db.signal.create({
      data: {
        type,
        partyId: input.partyId,
        messageId: message.id,
        senderId: message.senderId,
      },
    }),
    db.message.update({
      where: { id: message.id },
      data: { partyId: input.partyId, dismissedAt: null },
    }),
  ]);
}
