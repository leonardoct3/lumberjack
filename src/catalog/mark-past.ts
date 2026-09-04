import type { PrismaClient } from "@prisma/client";
import { isPastEvent } from "@/domain/gates";

export async function markPastParties(
  db: PrismaClient,
  now: Date,
): Promise<number> {
  const upcoming = await db.party.findMany({ where: { status: "upcoming" } });
  const ids = upcoming.filter((p) => isPastEvent(p.eventAt, now)).map((p) => p.id);
  if (ids.length === 0) return 0;

  const result = await db.party.updateMany({
    where: { id: { in: ids } },
    data: { status: "past", watchlistPosition: null },
  });
  return result.count;
}
