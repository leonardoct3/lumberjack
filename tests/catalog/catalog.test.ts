import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { resetDb } from "../helpers/db";
import { confirmCandidate } from "@/catalog/confirm";
import { rejectCandidate } from "@/catalog/reject";
import { unlinkSignal } from "@/catalog/unlink";
import { markPastParties } from "@/catalog/mark-past";
import { linkOrphan } from "@/catalog/link-orphan";

const now = new Date("2026-09-03T15:00:00Z");

async function seedCandidate() {
  const group = await prisma.group.create({
    data: { waId: "g1", name: "ingressos", listen: true },
  });
  const sender = await prisma.sender.create({
    data: { waId: "s-admin", name: "Admin", role: "admin" },
  });
  const message = await prisma.message.create({
    data: {
      waMessageId: "w1",
      groupId: group.id,
      senderId: sender.id,
      sentAt: now,
      text: "ONIX 1 lote",
      class: "admin_promo",
    },
  });
  const candidate = await prisma.partyCandidate.create({
    data: {
      name: "ONIX",
      sourceMessageId: message.id,
      platform: "unknown",
    },
  });
  return { candidate, message, sender };
}

describe("catalog", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("confirm creates party and lot", async () => {
    const { candidate } = await seedCandidate();
    const r = await confirmCandidate(prisma, {
      candidateId: candidate.id,
      name: "ONIX",
      eventAt: new Date("2026-09-12T03:00:00Z"),
      lotLabel: "1º lote",
    });
    const party = await prisma.party.findUniqueOrThrow({ where: { id: r.partyId } });
    expect(party.name).toBe("ONIX");
    expect(party.watchlistPosition).toBe(1);
    expect(r.lotId).not.toBeNull();
    const c = await prisma.partyCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(c.status).toBe("confirmed");
  });

  it("reject does not create a party", async () => {
    const { candidate } = await seedCandidate();
    await rejectCandidate(prisma, candidate.id);
    expect(await prisma.party.count()).toBe(0);
    expect((await prisma.partyCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe("rejected");
  });

  it("unlink deletes the signal and leaves the message", async () => {
    const { sender } = await seedCandidate();
    const party = await prisma.party.create({
      data: { name: "ONIX", aliases: ["onix"], eventAt: new Date("2026-09-12T03:00:00Z") },
    });
    const group = await prisma.group.findFirstOrThrow();
    const msg = await prisma.message.create({
      data: {
        waMessageId: "w-sig",
        groupId: group.id,
        senderId: sender.id,
        sentAt: now,
        text: "procuro onix",
        class: "pista_procura",
        partyId: party.id,
      },
    });
    const signal = await prisma.signal.create({
      data: { type: "demand", partyId: party.id, messageId: msg.id, senderId: sender.id },
    });
    await unlinkSignal(prisma, signal.id);
    expect(await prisma.signal.count()).toBe(0);
    expect(await prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).toMatchObject({
      partyId: null,
    });
  });

  it("linkOrphan turns an orphan procura into a demand signal", async () => {
    const { sender } = await seedCandidate();
    const party = await prisma.party.create({
      data: { name: "ONIX", aliases: ["onix"], eventAt: new Date("2026-09-12T03:00:00Z") },
    });
    const group = await prisma.group.findFirstOrThrow();
    const msg = await prisma.message.create({
      data: {
        waMessageId: "w-orphan",
        groupId: group.id,
        senderId: sender.id,
        sentAt: now,
        text: "procuro onix",
        class: "pista_procura",
      },
    });
    expect(await prisma.signal.count()).toBe(0);

    await linkOrphan(prisma, { messageId: msg.id, partyId: party.id });

    const signal = await prisma.signal.findUniqueOrThrow({ where: { messageId: msg.id } });
    expect(signal).toMatchObject({ type: "demand", partyId: party.id, senderId: sender.id });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).partyId).toBe(party.id);
  });

  it("marks past parties in SP and clears watchlist", async () => {
    await prisma.party.create({
      data: {
        name: "VELHA",
        aliases: [],
        eventAt: new Date("2026-09-02T03:00:00Z"),
        watchlistPosition: 1,
      },
    });
    const n = await markPastParties(prisma, now);
    expect(n).toBe(1);
    const p = await prisma.party.findFirstOrThrow();
    expect(p.status).toBe("past");
    expect(p.watchlistPosition).toBeNull();
  });
});
