import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { exportDataset, type ExportManifest } from "@/benchmark/export";
import { createPseudonymizer } from "@/benchmark/pseudonymize";
import { withReadOnlySnapshot } from "@/benchmark/read-only";
import { createMemorySink } from "@/benchmark/sink";
import { resetDb } from "../helpers/db";

const pseudonymizer = createPseudonymizer("e".repeat(32));
const interval = {
  start: new Date("2026-10-01T03:00:00Z"),
  end: new Date("2026-10-08T03:00:00Z"),
};
const source = {
  target: "localhost:5433/lumberjack_test",
  repoRevision: "abc123",
  deployedRevision: "unverified",
};

type Row = Record<string, unknown>;

const ids: Record<string, string> = {};

async function seed() {
  const group = await prisma.group.create({
    data: {
      waId: "120363000000000009@g.us",
      name: "Grupo Secreto Festas",
      listen: true,
    },
  });
  const seller = await prisma.sender.create({
    data: {
      waId: "5511999990000@s.whatsapp.net",
      name: "Guilherme Souza",
      role: "pista",
    },
  });
  const buyer = await prisma.sender.create({
    data: { waId: "5511988880000@s.whatsapp.net", name: "Mariana" },
  });
  const party = await prisma.party.create({
    data: {
      name: "ONIX Festival",
      aliases: ["onix"],
      eventAt: new Date("2026-10-24T23:00:00Z"),
      createdAt: new Date("2026-09-20T12:00:00Z"),
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
  ids.party = party.id;

  const message = async (
    key: string,
    senderId: string,
    sentAt: string,
    text: string,
    extra = {},
  ) => {
    const row = await prisma.message.create({
      data: {
        waMessageId: `wa-${key}`,
        groupId: group.id,
        senderId,
        sentAt: new Date(sentAt),
        createdAt: new Date(sentAt),
        text,
        ...extra,
      },
    });
    ids[key] = row.id;
    return row;
  };

  await message("tooEarly", seller.id, "2026-09-20T12:00:00Z", "vendo onix antigo");
  await message("context", buyer.id, "2026-09-29T12:00:00Z", "alguem vai na onix?", {
    class: "ruido",
  });
  const offer = await message(
    "offer",
    seller.id,
    "2026-10-02T12:00:00Z",
    "vendo 2 pista onix R$ 250, chama Mariana ou 11 98888-0000",
    { class: "pista_oferta", partyId: party.id },
  );
  await message(
    "copy",
    seller.id,
    "2026-10-02T12:05:00Z",
    "vendo 2 pista onix R$ 250, chama Mariana ou 11 98888-0000",
    {
      class: "pista_oferta",
      duplicateOfId: offer.id,
    },
  );
  const promo = await message(
    "promo",
    seller.id,
    "2026-10-03T12:00:00Z",
    "*ONIX Festival* 24/10 https://www.sympla.com.br/evento/onix/1?utm_source=wa",
    { class: "admin_promo" },
  );
  await message("tooLate", buyer.id, "2026-10-08T04:00:00Z", "compro onix", {
    class: "pista_procura",
  });

  await prisma.signal.create({
    data: {
      type: "offer",
      partyId: party.id,
      messageId: offer.id,
      senderId: seller.id,
    },
  });
  await prisma.partyCandidate.create({
    data: {
      sourceMessageId: promo.id,
      status: "confirmed",
      name: "ONIX Festival",
      url: "https://www.sympla.com.br/evento/onix/1?utm_source=wa",
      eventAt: new Date("2026-10-24T03:00:00Z"),
    },
  });
  const snapshot = (computedAt: string) =>
    prisma.heatSnapshot.create({
      data: {
        partyId: party.id,
        computedAt: new Date(computedAt),
        demand1d: 0,
        demand3d: 0,
        demand7d: 0,
        offer1d: 1,
        offer3d: 1,
        offer7d: 1,
        daysToEvent: 20,
        uniqueDemandSenders7d: 0,
      },
    });
  await snapshot("2026-09-01T12:00:00Z");
  await snapshot("2026-10-04T12:00:00Z");
  await prisma.waSession.create({ data: { state: "connected", qr: "SECRET-QR" } });
}

describe("exportDataset", () => {
  const sink = createMemorySink();
  let manifest: ExportManifest;
  const all = () =>
    [
      "messages",
      "groups",
      "senders",
      "parties",
      "lots",
      "candidates",
      "signals",
      "heat-snapshots",
    ]
      .map((name) => sink.contents(`${name}.jsonl`))
      .join("\n");
  const rows = (name: string) => sink.rows(`${name}.jsonl`) as Row[];

  beforeAll(async () => {
    await resetDb(prisma);
    await seed();
    manifest = await withReadOnlySnapshot(prisma, (tx, snapshot) =>
      exportDataset(tx, {
        snapshot,
        pseudonymizer,
        interval,
        contextDays: 3,
        sink,
        source,
      }),
    );
  });
  afterAll(async () => {
    await resetDb(prisma);
    await prisma.$disconnect();
  });

  it("exports the interval plus its context window, in timestamp order", () => {
    const messages = rows("messages");
    expect(messages.map((m) => m.id)).toEqual(
      ["context", "offer", "copy", "promo"].map((key) =>
        pseudonymizer.id("message", ids[key]),
      ),
    );
    expect(messages.map((m) => m.inInterval)).toEqual([false, true, true, true]);
    expect(manifest.contextStart).toBe("2026-09-28T03:00:00.000Z");
  });

  it("pseudonymises every identity and keeps the duplicate family intact", () => {
    const [, offer, copy] = rows("messages");
    expect(offer.group).toBe(pseudonymizer.id("group", "120363000000000009@g.us"));
    expect(offer.sender).toBe(
      pseudonymizer.id("sender", "5511999990000@s.whatsapp.net"),
    );
    expect(copy.duplicateOf).toBe(offer.id);
    expect(offer).toMatchObject({
      storedClass: "pista_oferta",
      partyId: ids.party,
      senderRoleNow: "pista",
    });
  });

  it("redacts phones and known names from the text but keeps the event", () => {
    const [, offer] = rows("messages");
    expect(offer.text).toBe("vendo 2 pista onix R$ 250, chama [NAME] ou [PHONE]");
    expect(manifest.redaction).toMatchObject({ phone: 2, name: 2 });
  });

  it("never writes names, WhatsApp ids or session state", () => {
    const text = all();
    for (const secret of [
      "Grupo Secreto",
      "Guilherme",
      "Mariana",
      "5511999990000",
      "120363000000000009",
      "98888-0000",
      "SECRET-QR",
      "wa-offer",
      "utm_source",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("links candidates and signals to exported messages by pseudonym", () => {
    expect(rows("candidates")).toEqual([
      expect.objectContaining({
        sourceMessage: pseudonymizer.id("message", ids.promo),
        status: "confirmed",
        url: "https://www.sympla.com.br/evento/onix/1",
      }),
    ]);
    expect(rows("signals")).toEqual([
      expect.objectContaining({
        message: pseudonymizer.id("message", ids.offer),
        type: "offer",
        partyId: ids.party,
      }),
    ]);
  });

  it("exports the catalog and only the snapshots inside the window", () => {
    expect(rows("parties")).toEqual([
      expect.objectContaining({
        id: ids.party,
        name: "ONIX Festival",
        aliases: ["onix"],
      }),
    ]);
    expect(rows("lots")).toHaveLength(1);
    expect(rows("heat-snapshots").map((s) => s.computedAt)).toEqual([
      "2026-10-04T12:00:00.000Z",
    ]);
    expect(rows("senders")).toHaveLength(2);
    expect(rows("groups")).toEqual([
      { id: pseudonymizer.id("group", "120363000000000009@g.us"), listenNow: true },
    ]);
  });

  it("writes a manifest whose checksums describe exactly what was written", () => {
    const byName = Object.fromEntries(manifest.files.map((f) => [f.name, f]));
    expect(byName["messages.jsonl"].rows).toBe(4);
    expect(byName["messages.jsonl"].sha256).toBe(
      createHash("sha256").update(sink.contents("messages.jsonl")).digest("hex"),
    );
    expect(manifest).toMatchObject({
      interval: { start: "2026-10-01T03:00:00.000Z", end: "2026-10-08T03:00:00.000Z" },
      keyFingerprint: pseudonymizer.keyFingerprint,
      source,
      consistency: "single read-only repeatable-read snapshot",
    });
    expect(manifest.limitations.join(" ")).toMatch(/current/);
    expect(manifest.excluded).toContain("WaSession");
  });

  it("refuses to run outside a read-only snapshot", async () => {
    await expect(
      exportDataset(prisma, {
        snapshot: {
          isolation: "read committed",
          readOnly: false,
          startedAt: new Date(),
        },
        pseudonymizer,
        interval,
        contextDays: 3,
        sink: createMemorySink(),
        source,
      }),
    ).rejects.toThrow(/read-only snapshot/);
  });
});
