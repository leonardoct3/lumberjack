import type { PrismaClient, SignalType } from "@prisma/client";

export type LinkOrphanInput = {
  messageId: string;
  partyId: string;
};

export async function linkOrphan(
  db: PrismaClient,
  input: LinkOrphanInput,
): Promise<void> {
  const message = await db.message.findUniqueOrThrow({
    where: { id: input.messageId },
  });

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
      data: { partyId: input.partyId },
    }),
  ]);
}
