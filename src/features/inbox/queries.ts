import type { Prisma, PrismaClient } from "@prisma/client";
import { TICKET_NOUNS } from "@/domain/classify";

export const NOT_MUTED = { sender: { muted: false } } as const;

/** The shared definition of a signal that needs an operator's attention. */
export function orphanWhere(dismissed: boolean): Prisma.MessageWhereInput {
  return {
    class: { in: ["pista_oferta", "pista_procura"] },
    signals: { none: {} },
    duplicateOfId: null,
    dismissedAt: dismissed ? { not: null } : null,
    ...NOT_MUTED,
  };
}

export const unclassifiedWhere: Prisma.MessageWhereInput = {
  class: "ruido",
  signals: { none: {} },
  duplicateOfId: null,
  dismissedAt: null,
  ...NOT_MUTED,
  OR: TICKET_NOUNS.map((noun) => ({
    text: { contains: noun, mode: "insensitive" as const },
  })),
};

export async function hasVisibleInboxWork(db: PrismaClient): Promise<boolean> {
  const [candidates, orphans] = await Promise.all([
    db.partyCandidate.count({
      where: { status: "pending", source: NOT_MUTED },
    }),
    db.message.count({ where: orphanWhere(false) }),
  ]);
  return candidates > 0 || orphans > 0;
}
