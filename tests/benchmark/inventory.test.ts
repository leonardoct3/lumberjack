import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { buildInventory, type Inventory } from "@/benchmark/inventory";
import { createPseudonymizer } from "@/benchmark/pseudonymize";
import { withReadOnlySnapshot } from "@/benchmark/read-only";
import { resetDb } from "../helpers/db";

const pseudonymizer = createPseudonymizer("i".repeat(32));
const localMigrations = readdirSync(
  path.resolve(__dirname, "../../prisma/migrations"),
  {
    withFileTypes: true,
  },
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

async function seed() {
  const listened = await prisma.group.create({
    data: { waId: "120363000000000001@g.us", name: "Festas SP Secret", listen: true },
  });
  const quiet = await prisma.group.create({
    data: { waId: "120363000000000002@g.us", name: "Outro Grupo", listen: false },
  });
  const pista = await prisma.sender.create({
    data: { waId: "5511999990000@s.whatsapp.net", name: "Guilherme", role: "pista" },
  });
  const promoter = await prisma.sender.create({
    data: { waId: "5511988880000@s.whatsapp.net", name: "Promo", role: "admin" },
  });
  const muted = await prisma.sender.create({
    data: { waId: "5511977770000@s.whatsapp.net", name: "Agenda", muted: true },
  });
  const party = await prisma.party.create({
    data: {
      name: "ONIX",
      aliases: ["onix"],
      eventAt: new Date("2026-10-24T23:00:00Z"),
      lots: {
        create: [
          {
            label: "1º lote",
            openedAt: new Date("2026-09-01T00:00:00Z"),
            officialPrice: 120,
          },
        ],
      },
    },
  });

  let n = 0;
  const message = (data: {
    groupId: string;
    senderId: string;
    sentAt: string;
    createdAt?: string;
    class: "ruido" | "pista_oferta" | "pista_procura" | "admin_promo" | null;
    partyId?: string;
    duplicateOfId?: string;
    dismissedAt?: Date;
  }) =>
    prisma.message.create({
      data: {
        waMessageId: `wa-${++n}`,
        text: `mensagem ${n}`,
        ...data,
        sentAt: new Date(data.sentAt),
        createdAt: new Date(data.createdAt ?? data.sentAt),
      },
    });

  // 01:00Z on Oct 2 is still Oct 1 in São Paulo.
  const demand = await message({
    groupId: listened.id,
    senderId: pista.id,
    sentAt: "2026-10-02T01:00:00Z",
    createdAt: "2026-10-02T01:00:30Z",
    class: "pista_procura",
    partyId: party.id,
  });
  await message({
    groupId: quiet.id,
    senderId: pista.id,
    sentAt: "2026-10-02T01:05:00Z",
    createdAt: "2026-10-02T03:05:00Z",
    class: "pista_procura",
    duplicateOfId: demand.id,
  });
  await message({
    groupId: listened.id,
    senderId: pista.id,
    sentAt: "2026-10-02T15:00:00Z",
    class: "pista_oferta",
  });
  const blast = await message({
    groupId: listened.id,
    senderId: promoter.id,
    sentAt: "2026-10-04T15:00:00Z",
    class: "admin_promo",
  });
  await message({
    groupId: listened.id,
    senderId: muted.id,
    sentAt: "2026-10-04T16:00:00Z",
    class: "ruido",
    dismissedAt: new Date("2026-10-05T00:00:00Z"),
  });

  await prisma.signal.create({
    data: {
      type: "demand",
      partyId: party.id,
      messageId: demand.id,
      senderId: pista.id,
    },
  });
  await prisma.partyCandidate.createMany({
    data: [
      { sourceMessageId: blast.id, name: "ONIX", status: "confirmed" },
      { sourceMessageId: blast.id, name: "Outra", status: "pending" },
      { sourceMessageId: blast.id, name: "Errada", status: "rejected" },
    ],
  });
  await prisma.heatSnapshot.create({
    data: {
      partyId: party.id,
      computedAt: new Date("2026-10-04T18:00:00Z"),
      demand1d: 1,
      demand3d: 1,
      demand7d: 1,
      offer1d: 0,
      offer3d: 0,
      offer7d: 0,
      daysToEvent: 20,
      uniqueDemandSenders7d: 1,
    },
  });
  await prisma.waSession.create({
    data: { state: "qr", qr: "SECRET-QR-PAYLOAD", detail: "login needed" },
  });
}

describe("buildInventory", () => {
  let inventory: Inventory;

  beforeAll(async () => {
    await resetDb(prisma);
    await seed();
    inventory = await withReadOnlySnapshot(prisma, (tx, snapshot) =>
      buildInventory(tx, {
        snapshot,
        pseudonymizer,
        localMigrations: [...localMigrations, "20991231000000_not_deployed"],
      }),
    );
  });
  afterAll(async () => {
    await resetDb(prisma);
    await prisma.$disconnect();
  });

  it("counts messages by the dimensions the benchmark samples on", () => {
    expect(inventory.messages.total).toBe(5);
    expect(inventory.messages.byClass).toEqual({
      admin_promo: 1,
      pista_oferta: 1,
      pista_procura: 2,
      ruido: 1,
    });
    expect(inventory.messages.bySenderRole).toEqual({ admin: 1, pista: 3, unknown: 1 });
    expect(inventory.messages.fromMutedSenders).toBe(1);
    expect(inventory.messages.duplicates).toBe(1);
    expect(inventory.messages.dismissed).toBe(1);
    expect(inventory.messages.firstSentAt).toBe("2026-10-02T01:00:00.000Z");
    expect(inventory.messages.lastSentAt).toBe("2026-10-04T16:00:00.000Z");
  });

  it("buckets days in São Paulo time and lists the silent days as inferred gaps", () => {
    expect(inventory.coverage.daily).toEqual([
      { day: "2026-10-01", weekday: 4, messages: 2, groups: 2 },
      { day: "2026-10-02", weekday: 5, messages: 1, groups: 1 },
      { day: "2026-10-04", weekday: 7, messages: 2, groups: 1 },
    ]);
    expect(inventory.coverage.byWeekday).toEqual({
      1: 0,
      2: 0,
      3: 0,
      4: 2,
      5: 1,
      6: 0,
      7: 2,
    });
    expect(inventory.coverage.daysWithoutMessages).toEqual(["2026-10-03"]);
    expect(inventory.coverage.gapEvidence).toBe("inferred");
  });

  it("measures how late messages were stored after they were sent", () => {
    expect(inventory.messages.ingestionDelay.maxSeconds).toBe(7200);
    expect(inventory.messages.ingestionDelay.overOneHour).toBe(1);
    expect(inventory.messages.ingestionDelay.negative).toBe(0);
  });

  it("reports groups by pseudonym only", () => {
    const groups = inventory.groups.map((g) => g.group).sort();
    expect(groups).toEqual(
      [
        pseudonymizer.id("group", "120363000000000001@g.us"),
        pseudonymizer.id("group", "120363000000000002@g.us"),
      ].sort(),
    );
    const listened = inventory.groups.find((g) => g.listen);
    expect(listened?.messages).toBe(4);
  });

  it("never carries names, WhatsApp ids, message text or session secrets", () => {
    const json = JSON.stringify(inventory);
    for (const secret of [
      "Festas SP Secret",
      "120363000000000001",
      "5511999990000",
      "Guilherme",
      "mensagem",
      "SECRET-QR-PAYLOAD",
      "login needed",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("summarises candidates, links, catalog and snapshots", () => {
    expect(inventory.candidates.byStatus).toEqual({
      confirmed: 1,
      pending: 1,
      rejected: 1,
    });
    expect(inventory.candidates.messagesWithMultiple).toBe(1);
    expect(inventory.links).toMatchObject({
      pistaMessages: 3,
      pistaCanonical: 2,
      pistaCanonicalLinked: 1,
      pistaCanonicalUnlinked: 1,
      signalsByType: { demand: 1 },
    });
    expect(inventory.catalog).toMatchObject({
      partiesByStatus: { upcoming: 1 },
      lots: 1,
      lotsWithPrice: 1,
    });
    expect(inventory.heatSnapshots).toMatchObject({ total: 1, parties: 1 });
  });

  it("states what the schema cannot provide instead of leaving it implicit", () => {
    expect(inventory.contextAvailability).toEqual({
      replyGraph: false,
      quotedMessages: false,
      media: false,
      operatorAuditLog: false,
      historicalUptime: false,
    });
  });

  it("reports schema drift against the reviewed Prisma model and local migrations", () => {
    expect(inventory.schema.missingColumns).toEqual([]);
    expect(inventory.schema.unexpectedColumns).toEqual([]);
    expect(inventory.schema.migrationsNotApplied).toEqual([
      "20991231000000_not_deployed",
    ]);
    expect(inventory.schema.migrationsUnknownLocally).toEqual([]);
    expect(inventory.database.timeZone).toBeTruthy();
    expect(inventory.database.role.user).toBe("lumberjack");
  });

  it("exposes the connector's last known state without its QR or detail", () => {
    expect(inventory.waSession).toEqual({
      state: "qr",
      lastMessageAt: null,
      heartbeatAt: null,
    });
  });
});
