import type { PrismaClient } from "@prisma/client";

/**
 * Sends an orphan out of the Inbox without inventing a link for it. The class
 * is left intact so the message stays searchable and the decision stays undoable.
 */
export async function dismissOrphan(
  db: PrismaClient,
  messageId: string,
  now: Date,
): Promise<void> {
  const message = await db.message.findUniqueOrThrow({
    where: { id: messageId },
    include: { signals: { select: { id: true } } },
  });
  if (message.signals.length > 0) {
    throw new Error("dismissOrphan message already has a signal");
  }

  await db.message.update({
    where: { id: messageId },
    data: { dismissedAt: now },
  });
}

export async function restoreOrphan(
  db: PrismaClient,
  messageId: string,
): Promise<void> {
  await db.message.update({
    where: { id: messageId },
    data: { dismissedAt: null },
  });
}
