import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { reclassifyMessages } from "@/jobs/reclassify";
import { resetDb } from "../helpers/db";

const now = new Date("2026-09-16T12:00:00Z");

async function seedBoard() {
  const group = await prisma.group.create({
    data: { waId: "g-1", name: "um", listen: true },
  });
  const sender = await prisma.sender.create({
    data: { waId: "s-1", name: "Guilherme", role: "pista" },
  });
  const party = await prisma.party.create({
    data: {
      name: "ONIX Festival",
      aliases: ["onix"],
      eventAt: new Date("2026-10-24T23:00:00Z"),
      status: "upcoming",
    },
  });
  return { group, sender, party };
}

async function addMessage(
  ids: { group: { id: string }; sender: { id: string } },
  waMessageId: string,
  text: string,
  cls: "ruido" | "pista_oferta" | "pista_procura" | "admin_promo" | null,
) {
  return prisma.message.create({
    data: {
      waMessageId,
      groupId: ids.group.id,
      senderId: ids.sender.id,
      sentAt: now,
      text,
      class: cls,
    },
  });
}

describe("reclassifyMessages", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("dry run reports the work without touching any row", async () => {
    const ids = await seedBoard();
    const message = await addMessage(ids, "a", "compro 2 pista onix", "ruido");

    const report = await reclassifyMessages(prisma, { apply: false });
    expect(report.becamePista).toBe(1);
    expect(report.signalsCreated).toBe(1);

    const stored = await prisma.message.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(stored.class).toBe("ruido");
    expect(await prisma.signal.count()).toBe(0);
  });

  it("recovers demand that the old vocabulary dropped as ruido", async () => {
    const ids = await seedBoard();
    await addMessage(ids, "a", "compro 2 pista onix", "ruido");
    await addMessage(ids, "b", "quem tem pista onix?", "ruido");
    await addMessage(ids, "c", "bom dia galera", "ruido");

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.becamePista).toBe(2);

    const demand = await prisma.signal.findMany({ where: { type: "demand" } });
    expect(demand).toHaveLength(2);
    const noise = await prisma.message.findUniqueOrThrow({
      where: { waMessageId: "c" },
    });
    expect(noise.class).toBe("ruido");
    expect(noise.partyId).toBeNull();
  });

  it("leaves an unmatched message as an orphan with its new class", async () => {
    const ids = await seedBoard();
    await addMessage(ids, "a", "compro 2 pista do lollapalooza", "ruido");

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.becamePista).toBe(1);
    expect(report.signalsCreated).toBe(0);

    const stored = await prisma.message.findUniqueOrThrow({
      where: { waMessageId: "a" },
    });
    expect(stored.class).toBe("pista_procura");
    expect(stored.partyId).toBeNull();
  });

  it("retypes a signal when offer and demand swap places", async () => {
    const ids = await seedBoard();
    const message = await addMessage(
      ids,
      "a",
      "alguem vendendo pista onix?",
      "pista_oferta",
    );
    await prisma.signal.create({
      data: {
        type: "offer",
        partyId: ids.party.id,
        messageId: message.id,
        senderId: ids.sender.id,
      },
    });

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.flipped).toBe(1);
    expect(report.signalsRetyped).toBe(1);

    const signal = await prisma.signal.findFirstOrThrow();
    expect(signal.type).toBe("demand");
  });

  it("reports but keeps a signal whose message is no longer pista", async () => {
    const ids = await seedBoard();
    // "preciso" alone used to be enough, so plain chatter became a signal.
    const message = await addMessage(
      ids,
      "a",
      "preciso dormir, boa noite",
      "pista_procura",
    );
    await prisma.signal.create({
      data: {
        type: "demand",
        partyId: ids.party.id,
        messageId: message.id,
        senderId: ids.sender.id,
      },
    });

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.lostPista).toBe(1);
    expect(report.signalsToReview).toBe(1);
    expect(await prisma.signal.count()).toBe(1);
  });

  it("never gives a cross-posted copy its own signal", async () => {
    const ids = await seedBoard();
    const canonical = await addMessage(ids, "a", "compro 2 pista onix", "ruido");
    const copy = await addMessage(ids, "b", "compro 2 pista onix", "ruido");
    await prisma.message.update({
      where: { id: copy.id },
      data: { duplicateOfId: canonical.id },
    });

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.becamePista).toBe(2);
    expect(report.signalsCreated).toBe(1);

    const stored = await prisma.message.findUniqueOrThrow({
      where: { id: copy.id },
    });
    expect(stored.class).toBe("pista_procura");
    expect(stored.partyId).toBeNull();
  });

  it("opens a candidate for a promoter who is not a group admin", async () => {
    const ids = await seedBoard();
    await addMessage(
      ids,
      "a",
      "*ONIX FESTIVAL* 1º LOTE SEM TAXA R$180 https://www.sympla.com.br/evento/onix",
      "ruido",
    );

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.becamePromo).toBe(1);
    expect(report.candidatesCreated).toBe(1);

    const candidate = await prisma.partyCandidate.findFirstOrThrow();
    expect(candidate.status).toBe("pending");
    expect(candidate.officialPrice).toBe(180);
    expect(candidate.url).toBe("https://www.sympla.com.br/evento/onix");
  });

  it("never gives a cross-posted ad its own candidate", async () => {
    const ids = await seedBoard();
    const text =
      "*ONIX FESTIVAL* 1º LOTE SEM TAXA R$180 https://www.sympla.com.br/evento/onix";
    const canonical = await addMessage(ids, "a", text, "ruido");
    const copy = await addMessage(ids, "b", text, "ruido");
    await prisma.message.update({
      where: { id: copy.id },
      data: { duplicateOfId: canonical.id },
    });

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.becamePromo).toBe(2);
    expect(report.candidatesCreated).toBe(1);
    expect(await prisma.partyCandidate.count()).toBe(1);
  });

  it("re-reads a pending candidate with the current extractor", async () => {
    const ids = await seedBoard();
    const message = await addMessage(
      ids,
      "a",
      "*ONIX FESTIVAL - VIRADA DE LOTE 23:59* 31.12 https://www.sympla.com.br/onix",
      "admin_promo",
    );
    // What an older extractor stored: the pitch instead of the festa.
    const candidate = await prisma.partyCandidate.create({
      data: {
        status: "pending",
        name: "VIRADA DE LOTE 23:59",
        sourceMessageId: message.id,
      },
    });

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.candidatesRefreshed).toBe(1);
    expect(report.candidatesDropped).toBe(0);

    const stored = await prisma.partyCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    expect(stored.name).toBe("ONIX FESTIVAL");
    expect(stored.platform).toBe("sympla");
  });

  it("drops a pending candidate that has nothing to act on", async () => {
    const ids = await seedBoard();
    const message = await addMessage(ids, "a", "bom dia, chegou o lote", "admin_promo");
    await prisma.partyCandidate.create({
      data: { status: "pending", name: "bom dia, chegou o lote", sourceMessageId: message.id },
    });

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.candidatesDropped).toBe(1);
    expect(await prisma.partyCandidate.count()).toBe(0);
    // The message itself is untouched, so nothing is lost.
    expect(await prisma.message.count({ where: { id: message.id } })).toBe(1);
  });

  it("does not re-read a candidate the operator already decided", async () => {
    const ids = await seedBoard();
    const message = await addMessage(
      ids,
      "a",
      "*ONIX FESTIVAL* 31.12 https://www.sympla.com.br/onix",
      "admin_promo",
    );
    await prisma.partyCandidate.create({
      data: { status: "rejected", name: "qualquer coisa", sourceMessageId: message.id },
    });

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.candidatesRefreshed).toBe(0);
    expect(report.candidatesDropped).toBe(0);
  });

  it("leaves a silenced sender out of the queue entirely", async () => {
    const ids = await seedBoard();
    await prisma.sender.update({
      where: { id: ids.sender.id },
      data: { muted: true },
    });
    await addMessage(
      ids,
      "a",
      "*ONIX FESTIVAL* 1º LOTE SEM TAXA R$180 https://www.sympla.com.br/evento/onix",
      "ruido",
    );
    await addMessage(ids, "b", "compro 2 pista onix", "ruido");

    const report = await reclassifyMessages(prisma, { apply: true });
    // The classes still get fixed; only the queue work is skipped.
    expect(report.becamePromo).toBe(1);
    expect(report.becamePista).toBe(1);
    expect(report.candidatesCreated).toBe(0);
    expect(report.signalsCreated).toBe(0);
    expect(await prisma.partyCandidate.count()).toBe(0);
    expect(await prisma.signal.count()).toBe(0);
  });

  it("skips an ad that extracts into nothing to act on", async () => {
    const ids = await seedBoard();
    // One ad word is enough from a group admin, which is where this junk
    // candidate came from in production.
    await prisma.sender.update({
      where: { id: ids.sender.id },
      data: { role: "admin" },
    });
    await addMessage(ids, "a", "temos sem taxa e com desconto!", "ruido");

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.becamePromo).toBe(1);
    expect(report.candidatesCreated).toBe(0);
  });

  it("does not resurrect a candidate the operator rejected", async () => {
    const ids = await seedBoard();
    const message = await addMessage(
      ids,
      "a",
      "*ONIX FESTIVAL* 1º LOTE SEM TAXA R$180 https://www.sympla.com.br/evento/onix",
      "admin_promo",
    );
    await prisma.partyCandidate.create({
      data: { status: "rejected", name: "ONIX", sourceMessageId: message.id },
    });

    const report = await reclassifyMessages(prisma, { apply: true });
    expect(report.candidatesCreated).toBe(0);
    expect(await prisma.partyCandidate.count()).toBe(1);
  });

  it("is idempotent", async () => {
    const ids = await seedBoard();
    await addMessage(ids, "a", "compro 2 pista onix", "ruido");

    await reclassifyMessages(prisma, { apply: true });
    const second = await reclassifyMessages(prisma, { apply: true });

    expect(second.changed).toBe(0);
    expect(second.signalsCreated).toBe(0);
    expect(await prisma.signal.count()).toBe(1);
  });
});
