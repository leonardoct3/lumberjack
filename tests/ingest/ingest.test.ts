import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { resetDb } from "../helpers/db";
import { DEDUPE_WINDOW_MS } from "@/domain/dedupe";
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

    const candidate = await prisma.partyCandidate.findFirstOrThrow({
      where: { sourceMessageId: r.messageId },
    });
    expect(candidate.status).toBe("pending");
    expect(candidate.platform).toBe("sympla");
    expect(candidate.url).toContain("sympla.com.br/onix");
    expect(candidate.officialPrice).toBe(80);
    expect(candidate.name?.toLowerCase()).toContain("onix");
    expect(await prisma.party.count()).toBe(0);
  });

  it("an ad with nothing to act on does not open a candidate", async () => {
    const r = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-empty-promo",
        senderIsGroupAdmin: true,
        text: "temos sem taxa e com desconto!",
      }),
    );

    const message = await prisma.message.findUniqueOrThrow({
      where: { id: r.messageId },
    });
    expect(message.class).toBe("admin_promo");
    expect(await prisma.partyCandidate.count()).toBe(0);
  });

  it("a season blast opens a candidate per festa, each with its own lines", async () => {
    const r = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-season",
        senderIsGroupAdmin: true,
        text: [
          "🌞 RÉVEILLONS BÚZIOS E RJ CAPITAL",
          "🌊 *RÉVEILLON AREIA BÚZIOS* 🌊 _27.12_",
          "🎟️ Garanta com *DESCONTO*: https://tinyurl.com/Areia2027",
          "🪩 31.12 • *RÉVEILLON SAL* 🪩",
          "🎟️ Garanta com *DESCONTO*: https://www.sympla.com.br/evento/reveillon-sal/3543836",
        ].join("\n"),
      }),
    );

    const candidates = await prisma.partyCandidate.findMany({
      where: { sourceMessageId: r.messageId },
      orderBy: { name: "asc" },
    });
    expect(candidates.map((c) => c.name)).toEqual([
      "RÉVEILLON AREIA BÚZIOS",
      "RÉVEILLON SAL",
    ]);
    // Each row carries the lines it was read from, so the queue shows the festa
    // and not the whole season three times over.
    expect(candidates[0]?.excerpt).toContain("Areia2027");
    expect(candidates[0]?.excerpt).not.toContain("RÉVEILLON SAL");
    expect(candidates[1]?.platform).toBe("sympla");
  });

  it("a silenced sender opens no candidate and no signal", async () => {
    const party = await prisma.party.create({
      data: {
        name: "ONIX",
        aliases: ["onix"],
        eventAt: new Date("2026-09-12T03:00:00Z"),
        status: "upcoming",
      },
    });
    await prisma.sender.create({
      data: { waId: "s-quiet", name: "Cassi", role: "pista", muted: true },
    });

    const ad = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-quiet-promo",
        senderWaId: "s-quiet",
        text: "*ONIX* 1º LOTE SEM TAXA R$180 https://www.sympla.com.br/onix",
      }),
    );
    const offer = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-quiet-offer",
        senderWaId: "s-quiet",
        text: "vendo 1 pista onix",
      }),
    );

    // Stored and classified, so nothing is lost and nothing acts.
    const stored = await prisma.message.findMany({
      where: { id: { in: [ad.messageId, offer.messageId] } },
      orderBy: { waMessageId: "asc" },
    });
    expect(stored.map((m) => m.class).sort()).toEqual([
      "admin_promo",
      "pista_oferta",
    ]);
    expect(await prisma.partyCandidate.count()).toBe(0);
    expect(await prisma.signal.count()).toBe(0);
    expect(
      await prisma.message.count({ where: { partyId: party.id } }),
    ).toBe(0);
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

  it("the same offer cross-posted to another group counts as one signal", async () => {
    const party = await prisma.party.create({
      data: {
        name: "ONIX",
        aliases: ["onix"],
        eventAt: new Date("2026-09-12T03:00:00Z"),
        status: "upcoming",
      },
    });

    const first = await ingestRawMessage(
      prisma,
      baseInput({ waMessageId: "wa-a", text: "Vendo 2 pista ONIX!" }),
    );
    const second = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-b",
        groupWaId: "g-outro",
        groupName: "outro",
        sentAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        text: "🎟️ vendo 2 pista onix 🔥",
      }),
    );

    expect(second.created).toBe(true);
    expect(second.duplicateOfId).toBe(first.messageId);
    expect(await prisma.message.count()).toBe(2);

    const copy = await prisma.message.findUniqueOrThrow({
      where: { id: second.messageId },
    });
    expect(copy.class).toBe("pista_oferta");
    expect(copy.duplicateOfId).toBe(first.messageId);
    expect(copy.partyId).toBeNull();

    const signals = await prisma.signal.findMany();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.messageId).toBe(first.messageId);
    expect(signals[0]?.partyId).toBe(party.id);
  });

  it("the same admin promo cross-posted creates a single candidate", async () => {
    const promo = "ONIX\n1º lote R$ 80 05/09 https://www.sympla.com.br/onix";
    const first = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-promo-a",
        senderIsGroupAdmin: true,
        text: promo,
      }),
    );
    const second = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-promo-b",
        groupWaId: "g-outro",
        groupName: "outro",
        senderIsGroupAdmin: true,
        sentAt: new Date(now.getTime() + 60_000),
        text: promo,
      }),
    );

    expect(second.duplicateOfId).toBe(first.messageId);
    const candidates = await prisma.partyCandidate.findMany();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sourceMessageId).toBe(first.messageId);
  });

  it("every copy points at the first occurrence, never at another copy", async () => {
    const first = await ingestRawMessage(
      prisma,
      baseInput({ waMessageId: "wa-a", text: "vendo pista onix" }),
    );
    await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-b",
        groupWaId: "g-2",
        groupName: "dois",
        sentAt: new Date(now.getTime() + 60_000),
        text: "vendo pista onix",
      }),
    );
    const third = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-c",
        groupWaId: "g-3",
        groupName: "tres",
        sentAt: new Date(now.getTime() + 120_000),
        text: "vendo pista onix",
      }),
    );

    expect(third.duplicateOfId).toBe(first.messageId);
    expect(
      await prisma.message.count({ where: { duplicateOfId: first.messageId } }),
    ).toBe(2);
  });

  it("the same text from another sender is its own intent", async () => {
    const first = await ingestRawMessage(
      prisma,
      baseInput({ waMessageId: "wa-a", text: "vendo pista onix" }),
    );
    const second = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-b",
        senderWaId: "s-2",
        senderName: "Bruno",
        text: "vendo pista onix",
      }),
    );

    expect(second.duplicateOfId).toBeUndefined();
    const copy = await prisma.message.findUniqueOrThrow({
      where: { id: second.messageId },
    });
    expect(copy.duplicateOfId).toBeNull();
    expect(copy.id).not.toBe(first.messageId);
  });

  it("a repost after the window is a renewed intent", async () => {
    await prisma.party.create({
      data: {
        name: "ONIX",
        aliases: ["onix"],
        eventAt: new Date("2026-09-30T03:00:00Z"),
        status: "upcoming",
      },
    });

    await ingestRawMessage(
      prisma,
      baseInput({ waMessageId: "wa-a", text: "vendo pista onix" }),
    );
    const later = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-b",
        sentAt: new Date(now.getTime() + DEDUPE_WINDOW_MS + 1000),
        text: "vendo pista onix",
      }),
    );

    expect(later.duplicateOfId).toBeUndefined();
    expect(await prisma.signal.count()).toBe(2);
  });

  it("messages without identifying content never collapse", async () => {
    await ingestRawMessage(
      prisma,
      baseInput({ waMessageId: "wa-a", text: "🔥🔥🔥" }),
    );
    const second = await ingestRawMessage(
      prisma,
      baseInput({
        waMessageId: "wa-b",
        sentAt: new Date(now.getTime() + 60_000),
        text: "🔥🔥🔥",
      }),
    );

    expect(second.duplicateOfId).toBeUndefined();
    const copy = await prisma.message.findUniqueOrThrow({
      where: { id: second.messageId },
    });
    expect(copy.fingerprint).toBeNull();
    expect(copy.duplicateOfId).toBeNull();
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
