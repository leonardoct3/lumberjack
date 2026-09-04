import type { PrismaClient } from "@prisma/client";

export async function unlinkSignal(
  db: PrismaClient,
  signalId: string,
): Promise<void> {
  const signal = await db.signal.findUniqueOrThrow({
    where: { id: signalId },
  });

  await db.$transaction([
    db.signal.delete({ where: { id: signalId } }),
    db.message.update({
      where: { id: signal.messageId },
      data: { partyId: null },
    }),
  ]);
}
