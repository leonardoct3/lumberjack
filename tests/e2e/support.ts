import { PrismaClient } from "@prisma/client";

const databaseUrl =
  process.env.DATABASE_URL_E2E ??
  "postgresql://lumberjack:lumberjack@localhost:5433/lumberjack_e2e_test";

export async function seedOperatorWorkflow(): Promise<void> {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await db.heatSnapshot.deleteMany();
    await db.signal.deleteMany();
    await db.lot.deleteMany();
    await db.partyCandidate.deleteMany();
    await db.message.deleteMany();
    await db.party.deleteMany();
    await db.sender.deleteMany();
    await db.group.deleteMany();
    await db.waSession.deleteMany();

    const group = await db.group.create({
      data: { waId: "e2e@g.us", name: "Grupo E2E", listen: true },
    });
    const sender = await db.sender.create({
      data: { waId: "5511999999999@s.whatsapp.net", name: "Promotor E2E" },
    });
    const message = await db.message.create({
      data: {
        waMessageId: "e2e-candidate-1",
        groupId: group.id,
        senderId: sender.id,
        sentAt: new Date("2026-10-10T18:00:00.000Z"),
        text: "*Festa E2E* 20/10 Sympla",
        class: "admin_promo",
      },
    });
    await db.partyCandidate.create({
      data: {
        sourceMessageId: message.id,
        name: "Festa E2E",
        eventAt: new Date("2026-10-21T01:00:00.000Z"),
        url: "https://www.sympla.com.br/e2e",
      },
    });
  } finally {
    await db.$disconnect();
  }
}
