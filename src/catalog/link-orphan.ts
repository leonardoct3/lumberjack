import type { PrismaClient, SignalType } from "@prisma/client";

export type LinkOrphanInput = {
  messageId: string;
  partyId: string;
};

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
      data: { partyId: input.partyId },
    }),
  ]);
}
