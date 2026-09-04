import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { resetDb } from "../helpers/db";
import { ingestRawMessage } from "@/ingest/ingest";

const now = new Date("2026-09-03T15:00:00Z");

function baseInput(overrides: Partial<Parameters<typeof ingestRawMessage>[1]> = {}) {
  return {
    waMessageId: "wa-1",
    groupWaId: "g-ingressos",
    groupName: "ingressos",
    senderWaId: "s-1",
    senderName: "Ana",
    sentAt: now,
    text: "bom dia galera",
    ...overrides,
  };
}

describe("ingestRawMessage", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("first insert creates group, sender, and message", async () => {
    const r = await ingestRawMessage(prisma, baseInput());
    expect(r.created).toBe(true);
    expect(r.messageId).toBeTruthy();

    expect(await prisma.message.count()).toBe(1);
    const message = await prisma.message.findUniqueOrThrow({
      where: { id: r.messageId },
    });
    expect(message.waMessageId).toBe("wa-1");
    expect(message.text).toBe("bom dia galera");
    expect(message.class).toBe("ruido");

    const group = await prisma.group.findUniqueOrThrow({
      where: { waId: "g-ingressos" },
    });
    expect(group.name).toBe("ingressos");
    expect(group.listen).toBe(false);

    const sender = await prisma.sender.findUniqueOrThrow({
      where: { waId: "s-1" },
    });
    expect(sender.name).toBe("Ana");
    expect(sender.role).toBe("unknown");
  });

  it("second insert with the same waMessageId does not duplicate or reclassify", async () => {
    const first = await ingestRawMessage(prisma, baseInput());
    const second = await ingestRawMessage(
      prisma,
      baseInput({
        text: "Abriu o 1º lote da ONIX https://www.sympla.com.br/onix",
        senderIsGroupAdmin: true,
      }),
    );

    expect(second.created).toBe(false);
    expect(second.messageId).toBe(first.messageId);
    expect(await prisma.message.count()).toBe(1);
    expect(await prisma.partyCandidate.count()).toBe(0);

    const message = await prisma.message.findUniqueOrThrow({
      where: { id: first.messageId },
    });
    expect(message.class).toBe("ruido");
    expect(message.text).toBe("bom dia galera");
  });

  it("duplicate ingest still upserts sender role from senderIsGroupAdmin", async () => {
    const first = await ingestRawMessage(prisma, baseInput());
    const second = await ingestRawMessage(
      prisma,
      baseInput({ senderIsGroupAdmin: true }),
    );

    expect(second.created).toBe(false);
    expect(second.messageId).toBe(first.messageId);

    const sender = await prisma.sender.findUniqueOrThrow({
      where: { waId: "s-1" },
    });
    expect(sender.role).toBe("admin");
  });

  it("admin promo creates a pending party candidate", async () => {
    const r = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-promo",
        senderIsGroupAdmin: true,
        text: "ONIX\n1º lote R$ 80 05/09 https://www.sympla.com.br/onix",
      }),
    );

    expect(r.created).toBe(true);
    const message = await prisma.message.findUniqueOrThrow({
      where: { id: r.messageId },
    });
    expect(message.class).toBe("admin_promo");

    const sender = await prisma.sender.findUniqueOrThrow({
      where: { waId: "s-1" },
    });
    expect(sender.role).toBe("admin");

    const candidate = await prisma.partyCandidate.findUniqueOrThrow({
      where: { sourceMessageId: r.messageId },
    });
    expect(candidate.status).toBe("pending");
    expect(candidate.platform).toBe("sympla");
    expect(candidate.url).toContain("sympla.com.br/onix");
    expect(candidate.officialPrice).toBe(80);
    expect(candidate.name?.toLowerCase()).toContain("onix");
    expect(await prisma.party.count()).toBe(0);
  });

  it("pista demand with a matching upcoming party creates a demand signal", async () => {
    const party = await prisma.party.create({
      data: {
        name: "ONIX",
        aliases: ["onix"],
        eventAt: new Date("2026-09-12T03:00:00Z"),
        status: "upcoming",
      },
    });

    const r = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-demand",
        text: "procuro pista onix sexta",
      }),
    );

    expect(r.created).toBe(true);
    const message = await prisma.message.findUniqueOrThrow({
      where: { id: r.messageId },
    });
    expect(message.class).toBe("pista_procura");
    expect(message.partyId).toBe(party.id);

    const signal = await prisma.signal.findUniqueOrThrow({
      where: { messageId: r.messageId },
    });
    expect(signal.type).toBe("demand");
    expect(signal.partyId).toBe(party.id);
    expect(await prisma.party.count()).toBe(1);
  });

  it("pista demand with only a past party of the same name creates no signal and no party", async () => {
    await prisma.party.create({
      data: {
        name: "ONIX",
        aliases: ["onix"],
        eventAt: new Date("2026-08-01T03:00:00Z"),
        status: "past",
      },
    });

    const r = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-orphan",
        text: "procuro pista onix sexta",
      }),
    );

    const message = await prisma.message.findUniqueOrThrow({
      where: { id: r.messageId },
    });
    expect(message.class).toBe("pista_procura");
    expect(message.partyId).toBeNull();
    expect(await prisma.signal.count()).toBe(0);
    expect(await prisma.party.count()).toBe(1);
  });
});
