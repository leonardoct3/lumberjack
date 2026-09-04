import type { PrismaClient } from "@prisma/client";

export async function rejectCandidate(
  db: PrismaClient,
  candidateId: string,
): Promise<void> {
  await db.partyCandidate.update({
    where: { id: candidateId },
    data: { status: "rejected" },
  });
}
