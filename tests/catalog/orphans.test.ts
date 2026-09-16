import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPartyFromMessage } from "@/catalog/create-party-from-message";
import { dismissOrphan, restoreOrphan } from "@/catalog/dismiss-orphan";
import { linkOrphans } from "@/catalog/link-orphan";
import { reclassifyMessage } from "@/catalog/reclassify-message";
import { prisma } from "@/db/client";
import type { MessageClass } from "@prisma/client";
import { resetDb } from "../helpers/db";

const now = new Date("2026-09-16T12:00:00Z");
const eventAt = new Date("2026-10-10T23:00:00Z");

async function orphan(
  waMessageId: string,
  text = "vendo pista rodeio jaguariuna",
  messageClass: MessageClass = "pista_oferta",
) {
  const group = await prisma.group.upsert({
    where: { waId: "g-1" },
    create: { waId: "g-1", name: "um", listen: true },
    update: {},
  });
  const sender = await prisma.sender.upsert({
    where: { waId: "s-1" },
    create: { waId: "s-1", name: "Guilherme", role: "pista" },
    update: {},
  });
  return prisma.message.create({
    data: {
      waMessageId,
      groupId: group.id,
      senderId: sender.id,
      sentAt: now,
      text,
      class: messageClass,
    },
  });
}

describe("createPartyFromMessage", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an upcoming party and the signal the message carries", async () => {
    const message = await orphan("m-1");

    const result = await createPartyFromMessage(
      prisma,
      { messageId: message.id, name: "Rodeio Jaguariúna", eventAt },
      now,
    );

    const party = await prisma.party.findUniqueOrThrow({
      where: { id: result.partyId },
    });
    expect(party.name).toBe("Rodeio Jaguariúna");
    expect(party.status).toBe("upcoming");

    const signal = await prisma.signal.findUniqueOrThrow({
      where: { messageId: message.id },
    });
    expect(signal.type).toBe("offer");
    expect(signal.partyId).toBe(party.id);

    const linked = await prisma.message.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(linked.partyId).toBe(party.id);
  });

  it("keeps the new party off the watchlist until it has a lot", async () => {
    const message = await orphan("m-1");

    const result = await createPartyFromMessage(
      prisma,
      { messageId: message.id, name: "Rodeio", eventAt },
      now,
    );

    const party = await prisma.party.findUniqueOrThrow({
      where: { id: result.partyId },
    });
    expect(party.watchlistPosition).toBeNull();
    expect(await prisma.lot.count()).toBe(0);
  });

  it("records a demand signal for a procura message", async () => {
    const message = await orphan("m-1", "procuro pista rodeio", "pista_procura");

    await createPartyFromMessage(
      prisma,
      { messageId: message.id, name: "Rodeio", eventAt },
      now,
    );

    const signal = await prisma.signal.findUniqueOrThrow({
      where: { messageId: message.id },
    });
    expect(signal.type).toBe("demand");
  });

  it("stores aliases so later messages match on their own", async () => {
    const message = await orphan("m-1");

    const result = await createPartyFromMessage(
      prisma,
      {
        messageId: message.id,
        name: "Rodeio Jaguariúna",
        eventAt,
        aliases: ["jaguariuna", "superbull"],
      },
      now,
    );

    const party = await prisma.party.findUniqueOrThrow({
      where: { id: result.partyId },
    });
    expect(party.aliases).toEqual(["jaguariuna", "superbull"]);
  });

  it("marks a party as past when the date already went by", async () => {
    const message = await orphan("m-1");

    const result = await createPartyFromMessage(
      prisma,
      {
        messageId: message.id,
        name: "Rodeio",
        eventAt: new Date("2026-09-01T23:00:00Z"),
      },
      now,
    );

    const party = await prisma.party.findUniqueOrThrow({
      where: { id: result.partyId },
    });
    expect(party.status).toBe("past");
  });

  it("refuses a message that is not a pista signal", async () => {
    const message = await orphan("m-1", "bom dia", "ruido");

    await expect(
      createPartyFromMessage(
        prisma,
        { messageId: message.id, name: "Rodeio", eventAt },
        now,
      ),
    ).rejects.toThrow(/pista/);
    expect(await prisma.party.count()).toBe(0);
  });

  it("refuses a message that already has a signal", async () => {
    const message = await orphan("m-1");
    await createPartyFromMessage(
      prisma,
      { messageId: message.id, name: "Rodeio", eventAt },
      now,
    );

    await expect(
      createPartyFromMessage(
        prisma,
        { messageId: message.id, name: "Outra", eventAt },
        now,
      ),
    ).rejects.toThrow(/already/);
    expect(await prisma.party.count()).toBe(1);
  });

  it("requires a name", async () => {
    const message = await orphan("m-1");

    await expect(
      createPartyFromMessage(
        prisma,
        { messageId: message.id, name: "  ", eventAt },
        now,
      ),
    ).rejects.toThrow(/name/);
    expect(await prisma.party.count()).toBe(0);
  });
});

describe("dismissOrphan", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("stamps the message so the Inbox stops showing it", async () => {
    const message = await orphan("m-1");

    await dismissOrphan(prisma, message.id, now);

    const dismissed = await prisma.message.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(dismissed.dismissedAt?.toISOString()).toBe(now.toISOString());
    expect(dismissed.class).toBe("pista_oferta");
  });

  it("can be undone", async () => {
    const message = await orphan("m-1");
    await dismissOrphan(prisma, message.id, now);

    await restoreOrphan(prisma, message.id);

    const restored = await prisma.message.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(restored.dismissedAt).toBeNull();
  });

  it("refuses to dismiss a message that already became a signal", async () => {
    const message = await orphan("m-1");
    await createPartyFromMessage(
      prisma,
      { messageId: message.id, name: "Rodeio", eventAt },
      now,
    );

    await expect(dismissOrphan(prisma, message.id, now)).rejects.toThrow(
      /already/,
    );
  });
});

describe("linkOrphans", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("links every selected message to the same party in one pass", async () => {
    const a = await orphan("m-1");
    const b = await orphan("m-2", "procuro rodeio", "pista_procura");
    const party = await prisma.party.create({
      data: { name: "Rodeio", aliases: [], eventAt, status: "upcoming" },
    });

    const result = await linkOrphans(prisma, {
      messageIds: [a.id, b.id],
      partyId: party.id,
    });

    expect(result.linked).toBe(2);
    const signals = await prisma.signal.findMany({ orderBy: { createdAt: "asc" } });
    expect(signals.map((s) => s.type).sort()).toEqual(["demand", "offer"]);
  });

  it("skips messages that were already linked instead of failing the batch", async () => {
    const a = await orphan("m-1");
    const b = await orphan("m-2");
    const party = await prisma.party.create({
      data: { name: "Rodeio", aliases: [], eventAt, status: "upcoming" },
    });
    await linkOrphans(prisma, { messageIds: [a.id], partyId: party.id });

    const result = await linkOrphans(prisma, {
      messageIds: [a.id, b.id],
      partyId: party.id,
    });

    expect(result.linked).toBe(1);
    expect(result.skipped).toBe(1);
    expect(await prisma.signal.count()).toBe(2);
  });

  it("refuses a party that is not upcoming", async () => {
    const a = await orphan("m-1");
    const party = await prisma.party.create({
      data: { name: "Rodeio", aliases: [], eventAt, status: "past" },
    });

    await expect(
      linkOrphans(prisma, { messageIds: [a.id], partyId: party.id }),
    ).rejects.toThrow(/upcoming/);
    expect(await prisma.signal.count()).toBe(0);
  });
});

describe("reclassifyMessage", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sends a message the rules skipped into the orphan queue", async () => {
    const message = await orphan("m-1", "compro 2 pista ai galera", "ruido");

    await reclassifyMessage(prisma, message.id, "pista_procura");

    const stored = await prisma.message.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(stored.class).toBe("pista_procura");
    expect(stored.dismissedAt).toBeNull();
  });

  it("refuses a message that already carries a signal", async () => {
    const message = await orphan("m-1", "compro 2 pista", "ruido");
    const party = await prisma.party.create({
      data: { name: "Rodeio", aliases: [], eventAt, status: "upcoming" },
    });
    await prisma.signal.create({
      data: {
        type: "offer",
        partyId: party.id,
        messageId: message.id,
        senderId: message.senderId,
      },
    });

    await expect(
      reclassifyMessage(prisma, message.id, "pista_procura"),
    ).rejects.toThrow(/signal/);
  });
});
