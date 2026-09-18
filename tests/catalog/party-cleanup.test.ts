import type { MessageClass } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { discardParty } from "@/catalog/discard-party";
import { mergeParties } from "@/catalog/merge-parties";
import { prisma } from "@/db/client";
import { resetDb } from "../helpers/db";

const now = new Date("2026-09-16T12:00:00Z");
const eventAt = new Date("2026-10-24T23:00:00Z");

async function group() {
  return prisma.group.upsert({
    where: { waId: "g-1" },
    create: { waId: "g-1", name: "um", listen: true },
    update: {},
  });
}

async function sender(waId = "s-1") {
  return prisma.sender.upsert({
    where: { waId },
    create: { waId, name: "Guilherme", role: "pista" },
    update: {},
  });
}

async function party(name: string, extra: { watchlistPosition?: number; qualitativeScore?: number; notes?: string } = {}) {
  return prisma.party.create({
    data: { name, aliases: [], eventAt, status: "upcoming", ...extra },
  });
}

async function signalOn(
  partyId: string,
  waMessageId: string,
  messageClass: MessageClass = "pista_procura",
) {
  const [g, s] = await Promise.all([group(), sender(`s-${waMessageId}`)]);
  const message = await prisma.message.create({
    data: {
      waMessageId,
      groupId: g.id,
      senderId: s.id,
      sentAt: now,
      text: "procuro pista",
      class: messageClass,
      partyId,
    },
  });
  await prisma.signal.create({
    data: {
      type: messageClass === "pista_oferta" ? "offer" : "demand",
      partyId,
      messageId: message.id,
      senderId: s.id,
    },
  });
  return message;
}

async function lotOn(partyId: string, label = "1º lote") {
  return prisma.lot.create({
    data: { partyId, label, openedAt: now, officialPrice: 120 },
  });
}

async function snapshotOn(partyId: string) {
  return prisma.heatSnapshot.create({
    data: {
      partyId,
      computedAt: now,
      demand1d: 1,
      demand3d: 1,
      demand7d: 1,
      offer1d: 0,
      offer3d: 0,
      offer7d: 0,
      uniqueDemandSenders7d: 1,
      daysToEvent: 38,
    },
  });
}

describe("mergeParties", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("moves signals and messages to the survivor and deletes the duplicate", async () => {
    const survivor = await party("Rodeio de Jaguariúna");
    const duplicate = await party("Rodeio Jaguariuna");
    await signalOn(survivor.id, "m-1");
    await signalOn(duplicate.id, "m-2");
    await signalOn(duplicate.id, "m-3", "pista_oferta");

    const result = await mergeParties(
      prisma,
      { sourceId: duplicate.id, targetId: survivor.id },
    );

    expect(result.signals).toBe(2);
    expect(result.messages).toBe(2);
    expect(await prisma.party.count()).toBe(1);
    expect(
      await prisma.signal.count({ where: { partyId: survivor.id } }),
    ).toBe(3);
    expect(
      await prisma.message.count({ where: { partyId: survivor.id } }),
    ).toBe(3);
  });

  it("absorbs the duplicate's name and aliases so later messages match the survivor", async () => {
    const survivor = await party("Rodeio de Jaguariúna");
    const duplicate = await prisma.party.create({
      data: {
        name: "Rodeio Jaguariuna",
        aliases: ["superbull"],
        eventAt,
        status: "upcoming",
      },
    });

    await mergeParties(
      prisma,
      { sourceId: duplicate.id, targetId: survivor.id },
    );

    const merged = await prisma.party.findUniqueOrThrow({
      where: { id: survivor.id },
    });
    expect(merged.name).toBe("Rodeio de Jaguariúna");
    expect(merged.aliases.sort()).toEqual(["Rodeio Jaguariuna", "superbull"]);
  });

  it("moves the lot and inherits the duplicate's queue slot", async () => {
    const survivor = await party("Rodeio de Jaguariúna");
    const duplicate = await party("Rodeio Jaguariuna", { watchlistPosition: 1 });
    await lotOn(duplicate.id);

    const result = await mergeParties(
      prisma,
      { sourceId: duplicate.id, targetId: survivor.id },
    );

    expect(result.lots).toBe(1);
    const merged = await prisma.party.findUniqueOrThrow({
      where: { id: survivor.id },
    });
    expect(merged.watchlistPosition).toBe(1);
  });

  it("keeps the survivor's own queue position", async () => {
    const survivor = await party("Rodeio de Jaguariúna", { watchlistPosition: 2 });
    const duplicate = await party("Rodeio Jaguariuna", { watchlistPosition: 5 });
    await lotOn(survivor.id);
    await lotOn(duplicate.id, "2º lote");

    await mergeParties(
      prisma,
      { sourceId: duplicate.id, targetId: survivor.id },
    );

    const merged = await prisma.party.findUniqueOrThrow({
      where: { id: survivor.id },
    });
    expect(merged.watchlistPosition).toBe(2);
    expect(await prisma.lot.count({ where: { partyId: survivor.id } })).toBe(2);
  });

  it("fills only the blanks the survivor left, never overwrites", async () => {
    const survivor = await party("Rodeio de Jaguariúna", { qualitativeScore: 5 });
    const duplicate = await party("Rodeio Jaguariuna", {
      qualitativeScore: 2,
      notes: "cupom CODELIS",
    });

    await mergeParties(
      prisma,
      { sourceId: duplicate.id, targetId: survivor.id },
    );

    const merged = await prisma.party.findUniqueOrThrow({
      where: { id: survivor.id },
    });
    expect(merged.qualitativeScore).toBe(5);
    expect(merged.notes).toBe("cupom CODELIS");
  });

  it("drops the duplicate's heat snapshots", async () => {
    const survivor = await party("Rodeio de Jaguariúna");
    const duplicate = await party("Rodeio Jaguariuna");
    await snapshotOn(survivor.id);
    await snapshotOn(duplicate.id);

    await mergeParties(
      prisma,
      { sourceId: duplicate.id, targetId: survivor.id },
    );

    expect(await prisma.heatSnapshot.count()).toBe(1);
  });

  it("refuses to merge a party into itself", async () => {
    const survivor = await party("Rodeio de Jaguariúna");

    await expect(
      mergeParties(prisma, { sourceId: survivor.id, targetId: survivor.id }),
    ).rejects.toThrow(/itself/);
    expect(await prisma.party.count()).toBe(1);
  });
});

describe("discardParty", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("sends the linked pista messages back to the orphan queue", async () => {
    const wrong = await party("Festa errada");
    const message = await signalOn(wrong.id, "m-1");

    const result = await discardParty(prisma, wrong.id);

    expect(result.orphaned).toBe(1);
    const orphan = await prisma.message.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(orphan.partyId).toBeNull();
    expect(orphan.dismissedAt).toBeNull();
    expect(orphan.class).toBe("pista_procura");
    expect(await prisma.signal.count()).toBe(0);
  });

  it("reopens the confirmed candidate so the promo returns to the Inbox", async () => {
    const wrong = await party("Festa errada");
    const promo = await signalOn(wrong.id, "m-1", "pista_oferta");
    await prisma.partyCandidate.create({
      data: {
        status: "confirmed",
        name: "Festa errada",
        eventAt,
        sourceMessageId: promo.id,
      },
    });

    const result = await discardParty(prisma, wrong.id);

    expect(result.reopened).toBe(1);
    const candidate = await prisma.partyCandidate.findFirstOrThrow({
      where: { sourceMessageId: promo.id },
    });
    expect(candidate.status).toBe("pending");
  });

  it("leaves a rejected candidate rejected", async () => {
    const wrong = await party("Festa errada");
    const promo = await signalOn(wrong.id, "m-1", "pista_oferta");
    await prisma.partyCandidate.create({
      data: { status: "rejected", eventAt, sourceMessageId: promo.id },
    });

    const result = await discardParty(prisma, wrong.id);

    expect(result.reopened).toBe(0);
    const candidate = await prisma.partyCandidate.findFirstOrThrow({
      where: { sourceMessageId: promo.id },
    });
    expect(candidate.status).toBe("rejected");
  });

  it("removes the lots, the snapshots and the party itself", async () => {
    const wrong = await party("Festa errada", { watchlistPosition: 1 });
    await lotOn(wrong.id);
    await snapshotOn(wrong.id);

    await discardParty(prisma, wrong.id);

    expect(await prisma.party.count()).toBe(0);
    expect(await prisma.lot.count()).toBe(0);
    expect(await prisma.heatSnapshot.count()).toBe(0);
  });

  it("does not touch another party's data", async () => {
    const wrong = await party("Festa errada");
    const keep = await party("Rodeio de Jaguariúna");
    await signalOn(wrong.id, "m-1");
    await signalOn(keep.id, "m-2");
    await lotOn(keep.id);

    await discardParty(prisma, wrong.id);

    expect(await prisma.party.count()).toBe(1);
    expect(await prisma.signal.count({ where: { partyId: keep.id } })).toBe(1);
    expect(await prisma.lot.count({ where: { partyId: keep.id } })).toBe(1);
  });
});
