import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { hasPreviousEdition, homeDestination } from "@/catalog/watchlist";
import { resetDb } from "../helpers/db";
import { seedFixture } from "../../prisma/seed";

describe("seed fixture", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("loads one listen group, admin and pista, edition badge, and heat", async () => {
    await seedFixture(prisma);

    const groups = await prisma.group.findMany();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.listen).toBe(true);

    const senders = await prisma.sender.findMany();
    expect(senders).toHaveLength(2);
    expect(senders.filter((s) => s.role === "admin")).toHaveLength(1);
    expect(senders.filter((s) => s.role === "pista")).toHaveLength(1);

    const messages = await prisma.message.findMany();
    expect(messages.length).toBeGreaterThanOrEqual(18);
    expect(messages.length).toBeLessThanOrEqual(22);
    const classes = new Set(messages.map((m) => m.class));
    expect(classes.has("admin_promo")).toBe(true);
    expect(classes.has("pista_procura")).toBe(true);
    expect(classes.has("pista_oferta")).toBe(true);
    expect(classes.has("ruido")).toBe(true);

    const upcoming = await prisma.party.findMany({
      where: { status: "upcoming" },
      include: { lots: true },
    });
    const past = await prisma.party.findMany({ where: { status: "past" } });
    expect(upcoming).toHaveLength(1);
    expect(past).toHaveLength(1);
    expect(upcoming[0]?.name).toBe(past[0]?.name);
    expect(upcoming[0]?.lots.some((lot) => lot.closedAt == null)).toBe(true);
    expect(
      hasPreviousEdition(upcoming[0]!, [...upcoming, ...past]),
    ).toBe(true);

    expect(await prisma.partyCandidate.count({ where: { status: "pending" } })).toBe(
      0,
    );
    expect(await homeDestination(prisma)).toBe("/watchlist");

    const snaps = await prisma.heatSnapshot.findMany();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.partyId).toBe(upcoming[0]?.id);
    expect(snaps[0]?.uniqueDemandSenders7d).toBeGreaterThan(0);
  });
});
