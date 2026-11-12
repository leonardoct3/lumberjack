import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Annotation } from "@/benchmark/annotation";
import { readJsonl } from "@/benchmark/dataset";
import {
  latestResults,
  requestFromView,
  runInterpretations,
  scoreInterpretations,
  type InterpretationRecord,
} from "@/benchmark/interpret";
import { buildItemView } from "@/benchmark/label/item";
import {
  InterpreterError,
  type Interpreter,
  type InterpretationRequest,
} from "@/pipeline/interpreter";
import type { InterpretedObservation } from "@/pipeline/observation";
import { exportWith, item, message } from "./draft-fixture";

type Obs = InterpretedObservation;

const obs = (over: Partial<Obs> = {}): Obs => ({
  intent: "offer",
  eventMention: "Syon",
  ticketCategory: "fem",
  quantity: null,
  price: { amount: 330, currency: "BRL", meaning: "asking" },
  eventDate: null,
  spans: [{ start: 0, end: 5, text: "vendo" }],
  relationship: { kind: "none", relatedMessage: null },
  ambiguities: [],
  ...over,
});

function label(messageId: string, observations: Partial<Obs>[]): Annotation {
  return {
    schemaVersion: 1,
    messageId,
    annotator: "lc",
    annotatedAt: "2026-11-11T00:00:00.000Z",
    source: "human",
    observations: observations.map((over) => {
      const { eventMention, ...o } = obs(over);
      return {
        ...o,
        event: { mention: eventMention, partyId: null, resolution: "not_mentioned" },
      };
    }),
    needsReview: false,
    contextUsed: [],
    notes: null,
  };
}

describe("requestFromView", () => {
  it("rebuilds what production sends: earlier context and the catalog as of the message", () => {
    const data = exportWith([
      message("m0", -2, "vendo syon"),
      message("m1", 0, "vendo syon fem 330"),
      message("m2", 1, "later"),
    ]);
    const request = requestFromView(buildItemView(data, item("m1")));
    expect(request.text).toBe("vendo syon fem 330");
    expect(request.context.map((c) => c.id)).toEqual(["m0"]);
    expect(request.catalog).toEqual([
      expect.objectContaining({ id: "party-1", name: "Syon", status: "upcoming" }),
    ]);
    expect(request.catalog[0].eventAt).toBeInstanceOf(Date);
  });
});

describe("scoreInterpretations", () => {
  const labels = [
    label("a", [{ quantity: 2 }]),
    label("b", [{ intent: "demand", price: null, eventMention: "Baile da Syon" }]),
    label("c", [
      { intent: "unrelated", price: null, ticketCategory: null, eventMention: null },
    ]),
  ];

  it("scores intents per message, and fields only on observations it could pair", () => {
    const results = new Map<string, Obs[] | null>([
      ["a", [obs({ quantity: 2, ticketCategory: "FEM " })]],
      [
        "b",
        [
          obs({
            intent: "demand",
            price: { amount: 1, currency: "BRL", meaning: "offered" },
          }),
        ],
      ],
      ["c", null],
    ]);
    const score = scoreInterpretations(labels, results);
    expect(score).toMatchObject({ messages: 3, answered: 2, exactIntents: 2 });
    expect(score.intents.perIntent.unrelated).toMatchObject({ fn: 1 });
    expect(score.fields.quantity).toMatchObject({
      pairs: 2,
      goldPresent: 1,
      recovered: 1,
    });
    expect(score.fields.category).toMatchObject({ goldPresent: 2, recovered: 2 });
    expect(score.fields.mention).toMatchObject({ goldPresent: 2, recovered: 2 });
    expect(score.fields.price).toMatchObject({ goldAbsent: 1, invented: 1 });
    expect(score.fields.price.examples).toEqual([
      { messageId: "b", gold: null, predicted: [1, "BRL", "offered"] },
    ]);
  });
});

describe("runInterpretations", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "interpret-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const data = exportWith([
    message("m1", 0, "vendo syon fem 330"),
    message("m2", 1, "vendo syon fem 300"),
    message("m3", 2, "vendo syon fem 280"),
  ]);
  const items = ["m1", "m2", "m3"].map((id) => item(id));

  function fake(
    behave: (request: InterpretationRequest) => unknown,
    paid = true,
  ): Interpreter {
    return {
      name: "fake",
      version: "1",
      provider: "test",
      model: "m",
      promptVersion: "p",
      paid,
      async interpret(request) {
        const output = behave(request);
        return { output, usage: { costUsd: 0.1 } };
      },
    };
  }
  const answer = (request: InterpretationRequest) => ({
    observations: [
      obs({ spans: [{ start: 0, end: 5, text: request.text.slice(0, 5) }] }),
    ],
  });

  it("records answers, stops before the budget, and resumes without paying twice", async () => {
    const file = path.join(dir, "out", "fake.jsonl");
    const first = await runInterpretations({
      data,
      items,
      interpreter: fake(answer),
      file,
      budgetUsd: 0.25,
      reserveUsd: () => 0.1,
      concurrency: 1,
    });
    expect(first).toMatchObject({ byStatus: { ok: 2 }, stoppedForBudget: true });
    expect(first.spentUsd).toBeCloseTo(0.2);

    const second = await runInterpretations({
      data,
      items,
      interpreter: fake(answer),
      file,
      budgetUsd: 1,
      reserveUsd: () => 0.1,
    });
    expect(second).toMatchObject({ alreadyDone: 2, attempted: 1, byStatus: { ok: 1 } });
    expect(second.priorSpentUsd).toBeCloseTo(0.2);
    const results = latestResults(readJsonl<InterpretationRecord>(file));
    expect([...results.keys()].sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("keeps invalid answers as such, and stops on an error retrying cannot fix", async () => {
    const file = path.join(dir, "fake.jsonl");
    const invalid = await runInterpretations({
      data,
      items: items.slice(0, 1),
      interpreter: fake(() => ({ observations: [obs({ spans: [] })] }), false),
      file,
      budgetUsd: 0,
      reserveUsd: () => 0,
    });
    expect(invalid.byStatus).toEqual({ invalid: 1 });
    expect(readJsonl<InterpretationRecord>(file)[0].errors).toEqual([
      "observations[0] needs at least one supporting span",
    ]);

    const broken = await runInterpretations({
      data,
      items: items.slice(1),
      interpreter: fake(() => {
        throw new InterpreterError("internal", "HTTP 401");
      }),
      file,
      budgetUsd: 1,
      reserveUsd: () => 0.1,
      concurrency: 1,
    });
    expect(broken).toMatchObject({ abortedBy: "HTTP 401", byStatus: { failed: 1 } });
  });
});
