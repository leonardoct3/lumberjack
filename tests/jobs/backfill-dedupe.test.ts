import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { backfillDedupe } from "@/jobs/backfill-dedupe";
import { resetDb } from "../helpers/db";

const now = new Date("2026-09-16T12:00:00Z");

async function seedCluster(texts: { waId: string; text: string; hours: number }[]) {
  const group = await prisma.group.create({
    data: { waId: "g-1", name: "um", listen: true },
  });
  const sender = await prisma.sender.create({
    data: { waId: "s-1", name: "Guilherme", role: "pista" },
  });
  const created = [];
  for (const t of texts) {
    created.push(
      await prisma.message.create({
        data: {
          waMessageId: t.waId,
          groupId: group.id,
          senderId: sender.id,
          sentAt: new Date(now.getTime() + t.hours * 3600_000),
          text: t.text,
          class: "pista_oferta",
        },
      }),
    );
  }
  return { group, sender, messages: created };
}

describe("backfillDedupe", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("dry run reports the work without touching any row", async () => {
    await seedCluster([
      { waId: "a", text: "Vendo pista ONIX", hours: 0 },
      { waId: "b", text: "vendo pista onix!", hours: 1 },
    ]);

    const report = await backfillDedupe(prisma, { apply: false });
    expect(report.duplicates).toBe(1);

    const rows = await prisma.message.findMany();
    expect(rows.every((r) => r.duplicateOfId === null)).toBe(true);
    expect(rows.every((r) => r.fingerprint === null)).toBe(true);
  });

  it("apply points every copy at the earliest occurrence", async () => {
    const { messages } = await seedCluster([
      { waId: "a", text: "vendo pista onix", hours: 0 },
      { waId: "b", text: "vendo pista onix", hours: 1 },
      { waId: "c", text: "vendo pista onix", hours: 2 },
    ]);

    const report = await backfillDedupe(prisma, { apply: true });
    expect(report.duplicates).toBe(2);
    expect(report.fingerprinted).toBe(3);

    const canonical = await prisma.message.findUniqueOrThrow({
      where: { id: messages[0]!.id },
    });
    expect(canonical.duplicateOfId).toBeNull();
    expect(canonical.fingerprint).not.toBeNull();
    expect(
      await prisma.message.count({ where: { duplicateOfId: canonical.id } }),
    ).toBe(2);
  });

  it("a repost outside the window starts a new canonical", async () => {
    await seedCluster([
      { waId: "a", text: "vendo pista onix", hours: 0 },
      { waId: "b", text: "vendo pista onix", hours: 30 },
    ]);

    const report = await backfillDedupe(prisma, { apply: true });
    expect(report.duplicates).toBe(0);
    expect(await prisma.message.count({ where: { duplicateOfId: null } })).toBe(2);
  });

  it("drops the inflated signals but keeps one for the cluster", async () => {
    const { messages, sender } = await seedCluster([
      { waId: "a", text: "vendo pista onix", hours: 0 },
      { waId: "b", text: "vendo pista onix", hours: 1 },
    ]);
    const party = await prisma.party.create({
      data: {
        name: "ONIX",
        aliases: [],
        eventAt: new Date("2026-10-01T03:00:00Z"),
        status: "upcoming",
      },
    });
    for (const message of messages) {
      await prisma.signal.create({
        data: {
          type: "offer",
          partyId: party.id,
          messageId: message.id,
          senderId: sender.id,
        },
      });
      await prisma.message.update({
        where: { id: message.id },
        data: { partyId: party.id },
      });
    }

    const report = await backfillDedupe(prisma, { apply: true });
    expect(report.signalsRemoved).toBe(1);

    const signals = await prisma.signal.findMany();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.messageId).toBe(messages[0]!.id);

    const copy = await prisma.message.findUniqueOrThrow({
      where: { id: messages[1]!.id },
    });
    expect(copy.partyId).toBeNull();
  });

  it("moves the signal to the canonical when only a copy was linked", async () => {
    const { messages, sender } = await seedCluster([
      { waId: "a", text: "vendo pista onix", hours: 0 },
      { waId: "b", text: "vendo pista onix", hours: 1 },
    ]);
    const party = await prisma.party.create({
      data: {
        name: "ONIX",
        aliases: [],
        eventAt: new Date("2026-10-01T03:00:00Z"),
        status: "upcoming",
      },
    });
    await prisma.signal.create({
      data: {
        type: "offer",
        partyId: party.id,
        messageId: messages[1]!.id,
        senderId: sender.id,
      },
    });

    const report = await backfillDedupe(prisma, { apply: true });
    expect(report.signalsMoved).toBe(1);
    expect(report.signalsRemoved).toBe(0);

    const signals = await prisma.signal.findMany();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.messageId).toBe(messages[0]!.id);

    const canonical = await prisma.message.findUniqueOrThrow({
      where: { id: messages[0]!.id },
    });
    expect(canonical.partyId).toBe(party.id);
  });

  it("drops pending candidates from copies and never touches confirmed ones", async () => {
    const { messages } = await seedCluster([
      { waId: "a", text: "ONIX 1o lote https://sympla.com.br/onix", hours: 0 },
      { waId: "b", text: "ONIX 1o lote https://sympla.com.br/onix", hours: 1 },
      { waId: "c", text: "ONIX 1o lote https://sympla.com.br/onix", hours: 2 },
    ]);
    await prisma.partyCandidate.create({
      data: { status: "pending", sourceMessageId: messages[0]!.id },
    });
    await prisma.partyCandidate.create({
      data: { status: "pending", sourceMessageId: messages[1]!.id },
    });
    await prisma.partyCandidate.create({
      data: { status: "confirmed", sourceMessageId: messages[2]!.id },
    });

    const report = await backfillDedupe(prisma, { apply: true });
    expect(report.candidatesRemoved).toBe(1);

    const remaining = await prisma.partyCandidate.findMany({
      orderBy: { status: "asc" },
    });
    expect(remaining.map((c) => c.sourceMessageId).sort()).toEqual(
      [messages[0]!.id, messages[2]!.id].sort(),
    );
  });

  it("leaves messages with no identifying content alone", async () => {
    await seedCluster([
      { waId: "a", text: "🔥🔥", hours: 0 },
      { waId: "b", text: "🔥🔥", hours: 1 },
    ]);

    const report = await backfillDedupe(prisma, { apply: true });
    expect(report.duplicates).toBe(0);
    expect(report.fingerprinted).toBe(0);
  });
});
