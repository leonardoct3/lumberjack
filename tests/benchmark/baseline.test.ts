import { describe, expect, it } from "vitest";
import { ANNOTATION_SCHEMA_VERSION, type Annotation } from "@/benchmark/annotation";
import {
  catalogAsOf,
  runBaseline,
  scoreIntents,
  scoreLinks,
  wilsonInterval,
  type BaselinePrediction,
  type ExportedParty,
} from "@/benchmark/baseline";
import type { ExportedMessage } from "@/benchmark/export";

const parties: ExportedParty[] = [
  {
    id: "onix",
    name: "ONIX Festival",
    aliases: ["onix"],
    eventAt: "2026-10-24T03:00:00.000Z",
    statusNow: "past",
    createdAt: "2026-09-10T12:00:00.000Z",
  },
  {
    id: "later",
    name: "Araxás",
    aliases: [],
    eventAt: "2026-12-27T03:00:00.000Z",
    statusNow: "upcoming",
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "gone",
    name: "Sunset",
    aliases: [],
    eventAt: "2026-09-01T03:00:00.000Z",
    statusNow: "past",
    createdAt: "2026-08-01T12:00:00.000Z",
  },
];

function msg(
  id: string,
  text: string,
  overrides: Partial<ExportedMessage> = {},
): ExportedMessage {
  return {
    id,
    group: "grp_1",
    sender: "snd_1",
    sentAt: "2026-09-16T15:00:00.000Z",
    createdAt: "2026-09-16T15:00:01.000Z",
    text,
    storedClass: "pista_oferta",
    partyId: "onix",
    duplicateOf: null,
    dismissed: false,
    inInterval: true,
    senderRoleNow: "unknown",
    senderMutedNow: false,
    ...overrides,
  };
}

describe("catalogAsOf", () => {
  it("only offers events that existed and were not yet past when the message was sent", () => {
    const ids = catalogAsOf(parties, new Date("2026-09-16T15:00:00Z")).map((p) => p.id);
    expect(ids).toEqual(["onix"]);
  });
});

describe("runBaseline", () => {
  it("replays the current classifier and matcher against the catalog of the time", () => {
    const [prediction] = runBaseline([msg("m1", "vendo 2 pista onix")], parties);
    expect(prediction).toMatchObject({
      messageId: "m1",
      replayedClass: "pista_oferta",
      intents: ["offer"],
      partyId: "onix",
      stored: { class: "pista_oferta", partyId: "onix" },
    });
  });

  it("cannot link an event the catalog did not hold yet", () => {
    const [prediction] = runBaseline(
      [msg("m2", "compro araxás", { partyId: null })],
      parties,
    );
    expect(prediction.intents).toEqual(["demand"]);
    expect(prediction.partyId).toBeNull();
  });

  it("can read retrospectively, against every event the catalog holds today", () => {
    const [prediction] = runBaseline(
      [msg("m2", "compro araxás", { partyId: null })],
      parties,
      {
        catalog: "retrospective",
      },
    );
    expect(prediction.partyId).toBe("later");
  });

  it("still never links an event that was already over when the message was sent", () => {
    const [prediction] = runBaseline([msg("m3", "vendo sunset")], parties, {
      catalog: "retrospective",
    });
    expect(prediction.partyId).toBeNull();
  });

  it("links nothing for copies and muted senders, as ingestion does", () => {
    const predictions = runBaseline(
      [
        msg("copy", "vendo 2 pista onix", { duplicateOf: "m1" }),
        msg("muted", "vendo 2 pista onix", { senderMutedNow: true }),
      ],
      parties,
    );
    expect(predictions.map((p) => p.partyId)).toEqual([null, null]);
  });

  it("counts the festas a promotion announces", () => {
    const [prediction] = runBaseline(
      [
        msg(
          "promo",
          "*ONIX Festival* 24/10 https://www.sympla.com.br/evento/onix/1 lote R$ 120",
          {
            senderRoleNow: "admin",
          },
        ),
      ],
      parties,
    );
    expect(prediction.intents).toEqual(["promotion"]);
    expect(prediction.candidateNames).toEqual(["ONIX Festival"]);
  });

  it("maps noise to unrelated", () => {
    const [prediction] = runBaseline([msg("n", "bom dia grupo")], parties);
    expect(prediction.intents).toEqual(["unrelated"]);
  });
});

function gold(
  messageId: string,
  observations: Partial<Annotation["observations"][number]>[],
): Annotation {
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    messageId,
    annotator: "rev_a",
    annotatedAt: "2026-11-04T15:00:00.000Z",
    source: "human",
    needsReview: false,
    contextUsed: [],
    notes: null,
    observations: observations.map((o) => ({
      intent: "offer",
      event: { mention: null, partyId: null, resolution: "not_mentioned" },
      ticketCategory: null,
      quantity: null,
      price: null,
      eventDate: null,
      spans: [],
      relationship: { kind: "none", relatedMessage: null },
      ambiguities: [],
      ...o,
    })),
  };
}

function prediction(
  messageId: string,
  intents: string[],
  partyId: string | null = null,
): BaselinePrediction {
  return {
    messageId,
    replayedClass: "ruido",
    intents,
    partyId,
    candidateNames: [],
    stored: { class: null, partyId: null },
  };
}

describe("scoreIntents", () => {
  it("scores each intent on message-level sets, with an empty label meaning unrelated", () => {
    const report = scoreIntents(
      [
        gold("a", [{ intent: "demand" }]),
        gold("b", [{ intent: "offer" }]),
        gold("c", []),
      ],
      [
        prediction("a", ["offer"]),
        prediction("b", ["offer"]),
        prediction("c", ["unrelated"]),
      ],
    );
    expect(report.messages).toBe(3);
    expect(report.perIntent.demand).toMatchObject({ tp: 0, fp: 0, fn: 1, recall: 0 });
    expect(report.perIntent.offer).toMatchObject({
      tp: 1,
      fp: 1,
      fn: 0,
      precision: 0.5,
      recall: 1,
    });
    expect(report.perIntent.unrelated).toMatchObject({ tp: 1, fp: 0, fn: 0, f1: 1 });
    expect(report.missedDemand).toBe(1);
  });

  it("measures how often every intention of a multi-intent message is recovered", () => {
    const report = scoreIntents(
      [gold("a", [{ intent: "offer" }, { intent: "demand" }])],
      [prediction("a", ["offer"])],
    );
    expect(report.multiIntent).toEqual({ messages: 1, fullyRecovered: 0 });
  });

  it("ignores predictions for messages nobody labelled", () => {
    const report = scoreIntents(
      [gold("a", [])],
      [prediction("a", ["unrelated"]), prediction("z", ["offer"])],
    );
    expect(report.messages).toBe(1);
    expect(report.perIntent.offer).toBeUndefined();
  });
});

describe("scoreLinks", () => {
  it("separates accepted-link precision, coverage and wrong-edition links", () => {
    const resolved = (partyId: string) => ({
      intent: "offer" as const,
      event: { mention: "x", partyId, resolution: "resolved" as const },
    });
    const report = scoreLinks(
      [
        gold("right", [resolved("onix")]),
        gold("wrong", [resolved("onix-2027")]),
        gold("missed", [resolved("onix")]),
        gold("none", [{ intent: "offer" }]),
      ],
      [
        prediction("right", ["offer"], "onix"),
        prediction("wrong", ["offer"], "onix"),
        prediction("missed", ["offer"], null),
        prediction("none", ["offer"], "onix"),
      ],
    );
    expect(report).toMatchObject({
      labelledWithEdition: 3,
      predictedLinks: 3,
      correctLinks: 1,
      wrongEdition: 1,
      linkedWithoutGoldEdition: 1,
      missedLinks: 1,
    });
    expect(report.precision).toBeCloseTo(1 / 3);
    expect(report.coverage).toBeCloseTo(2 / 3);
  });
});

describe("wilsonInterval", () => {
  it("gives a wide interval to a small sample with no observed errors", () => {
    const [low, high] = wilsonInterval(20, 20)!;
    expect(high).toBe(1);
    expect(low).toBeLessThan(0.85);
  });

  it("is undefined without observations", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});
