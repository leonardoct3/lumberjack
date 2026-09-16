import type { PrismaClient } from "@prisma/client";

export type DiscardPartyResult = {
  /** Pista messages that went back to the Inbox as orphans. */
  orphaned: number;
  /** Admin promos whose candidate is pending again. */
  reopened: number;
};

/**
 * Undoes cataloging a party the operator should never have created. Everything
 * derived from it goes away and the evidence returns to the Inbox: pista
 * messages as orphans, admin promos as pending candidates again.
 */
export async function discardParty(
  db: PrismaClient,
  partyId: string,
): Promise<DiscardPartyResult> {
  return db.$transaction(async (tx) => {
    await tx.party.findUniqueOrThrow({ where: { id: partyId } });

    const messages = await tx.message.findMany({
      where: { partyId },
      select: { id: true },
    });
    const messageIds = messages.map((message) => message.id);

    const reopened = await tx.partyCandidate.updateMany({
      where: { sourceMessageId: { in: messageIds }, status: "confirmed" },
      data: { status: "pending" },
    });

    await tx.signal.deleteMany({ where: { partyId } });
    await tx.message.updateMany({
      where: { partyId },
      data: { partyId: null, dismissedAt: null },
    });
    await tx.lot.deleteMany({ where: { partyId } });
    await tx.heatSnapshot.deleteMany({ where: { partyId } });
    await tx.party.delete({ where: { id: partyId } });

    return { orphaned: messageIds.length, reopened: reopened.count };
  });
}
