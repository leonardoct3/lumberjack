import type { MessageClass, PrismaClient } from "@prisma/client";

/**
 * Operator override for a message the rules could not read. It only sets the
 * class, which drops the message into the orphan queue where linking already
 * works — and every one of these is a phrasing the lexicon should learn.
 */
export async function reclassifyMessage(
  db: PrismaClient,
  messageId: string,
  next: Extract<MessageClass, "pista_oferta" | "pista_procura">,
): Promise<void> {
  const message = await db.message.findUniqueOrThrow({
    where: { id: messageId },
    include: { signals: { select: { id: true } } },
  });
  if (message.signals.length > 0) {
    throw new Error("reclassifyMessage message already has a signal");
  }

  await db.message.update({
    where: { id: messageId },
    data: { class: next, dismissedAt: null },
  });
}
