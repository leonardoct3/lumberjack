import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { resetDb } from "../helpers/db";
import { daysUntil } from "@/domain/timezone";
import { latestSnapshot, refreshHeat } from "@/jobs/refresh-heat";

const now = new Date("2026-09-03T15:00:00Z");

async function seedUpcomingWithSignals() {
  const group = await prisma.group.create({
    data: { waId: "g-heat", name: "ingressos", listen: true },
  });
  const sender = await prisma.sender.create({
    data: { waId: "s-demand", name: "Ana" },
  });
  const offerSender = await prisma.sender.create({
    data: { waId: "s-offer", name: "Bia" },
  });
  const party = await prisma.party.create({
    data: {
      name: "ONIX",
      aliases: ["onix"],
      eventAt: new Date("2026-09-12T03:00:00Z"),
      status: "upcoming",
    },
  });

  async function addSignal(opts: {
    waMessageId: string;
    senderId: string;
    sentAt: Date;
    type: "demand" | "offer";
    text: string;
  }) {
    const message = await prisma.message.create({
      data: {
        waMessageId: opts.waMessageId,
        groupId: group.id,
        senderId: opts.senderId,
        sentAt: opts.sentAt,
        text: opts.text,
        class: opts.type === "demand" ? "pista_procura" : "pista_oferta",
        partyId: party.id,
      },
    });
    await prisma.signal.create({
      data: {
        type: opts.type,
        partyId: party.id,
        messageId: message.id,
        senderId: opts.senderId,
      },
    });
  }

  await addSignal({
    waMessageId: "d1",
    senderId: sender.id,
    sentAt: new Date(now.getTime() - 2 * 3_600_000),
    type: "demand",
    text: "procuro onix",
  });
  await addSignal({
    waMessageId: "d2",
    senderId: sender.id,
    sentAt: now,
    type: "demand",
    text: "ainda procuro onix",
  });
  await addSignal({
    waMessageId: "o1",
    senderId: offerSender.id,
    sentAt: new Date(now.getTime() - 3_600_000),
    type: "offer",
    text: "vendo onix",
  });

  return { party, group, addSignal };
}

describe("refreshHeat", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("counts two messages from one person as one buyer", async () => {
    const { party } = await seedUpcomingWithSignals();
    const result = await refreshHeat(prisma, now);
    expect(result).toEqual({ ok: true, parties: 1 });

    const snaps = await prisma.heatSnapshot.findMany({ where: { partyId: party.id } });
    expect(snaps).toHaveLength(1);

    expect(snaps[0]!.demand1d).toBe(2);
    expect(snaps[0]!.uniqueDemandSenders1d).toBe(1);
    expect(snaps[0]!.uniqueDemandSenders3d).toBe(1);
    expect(snaps[0]!.uniqueDemandSenders7d).toBe(1);
    expect(snaps[0]!.offer1d).toBe(1);
    expect(snaps[0]!.offer7d).toBe(1);
    expect(snaps[0]!.uniqueOfferSenders1d).toBe(1);
    expect(snaps[0]!.uniqueOfferSenders7d).toBe(1);
    expect(snaps[0]!.daysToEvent).toBe(daysUntil(party.eventAt, now));
    expect(snaps[0]!.computedAt).toEqual(now);
  });

  it("counts people per window, not just overall", async () => {
    const { party, group, addSignal } = await seedUpcomingWithSignals();
    // A second buyer, but from five days ago: inside 7d, outside 1d and 3d.
    const older = await prisma.sender.create({
      data: { waId: "s-old", name: "Caio" },
    });
    await addSignal({
      waMessageId: "d3",
      senderId: older.id,
      sentAt: new Date(now.getTime() - 5 * 864e5),
      type: "demand",
      text: "procuro onix tambem",
    });
    expect(group).toBeDefined();

    await refreshHeat(prisma, now);
    const snap = await prisma.heatSnapshot.findFirstOrThrow({
      where: { partyId: party.id },
    });
    expect(snap.uniqueDemandSenders1d).toBe(1);
    expect(snap.uniqueDemandSenders7d).toBe(2);
  });

  it("keeps previous snapshots and latestSnapshot returns the newest", async () => {
    const { party } = await seedUpcomingWithSignals();
    const later = new Date(now.getTime() + 60_000);
    await refreshHeat(prisma, now);
    await refreshHeat(prisma, later);

    const snaps = await prisma.heatSnapshot.findMany({ where: { partyId: party.id } });
    expect(snaps).toHaveLength(2);
    expect(latestSnapshot(snaps)?.computedAt).toEqual(later);
  });

  it("does not snapshot a past party", async () => {
    await prisma.party.create({
      data: {
        name: "VELHA",
        aliases: [],
        eventAt: new Date("2026-08-01T03:00:00Z"),
        status: "past",
      },
    });
    const result = await refreshHeat(prisma, now);
    expect(result).toEqual({ ok: true, parties: 0 });
    expect(await prisma.heatSnapshot.count()).toBe(0);
  });
});

describe("latestSnapshot", () => {
  it("returns null for an empty list", () => {
    expect(latestSnapshot([])).toBeNull();
  });
});
