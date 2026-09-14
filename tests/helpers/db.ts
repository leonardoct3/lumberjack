import { PrismaClient } from "@prisma/client";

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
}

export async function resetDb(db: PrismaClient): Promise<void> {
  await db.heatSnapshot.deleteMany();
  await db.signal.deleteMany();
  await db.lot.deleteMany();
  await db.partyCandidate.deleteMany();
  await db.message.deleteMany();
  await db.party.deleteMany();
  await db.sender.deleteMany();
  await db.group.deleteMany();
  await db.waSession.deleteMany();
}
