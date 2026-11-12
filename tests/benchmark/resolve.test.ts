import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Annotation } from "@/benchmark/annotation";
import { readJsonl } from "@/benchmark/dataset";
import { buildItemView } from "@/benchmark/label/item";
import {
  latestProposals,
  observationsFromLabel,
  runResolutions,
  scoreResolutions,
  type Proposal,
  type ResolutionRecord,
} from "@/benchmark/resolve";
import { rulesResolver } from "@/pipeline/resolvers/rules";
import { exportWith, item, message } from "./draft-fixture";

type Resolution = Annotation["observations"][number]["event"]["resolution"];

function label(
  messageId: string,
  events: { mention: string | null; partyId: string | null; resolution: Resolution }[],
): Annotation {
  return {
    schemaVersion: 1,
    messageId,
    annotator: "lc",
    annotatedAt: "2026-11-11T00:00:00.000Z",
    source: "human",
    observations: events.map((event) => ({
      intent: "offer",
      event,
      ticketCategory: null,
      quantity: null,
      price: null,
      eventDate: null,
      spans: [{ start: 0, end: 5, text: "vendo" }],
      relationship: { kind: "none", relatedMessage: null },
      ambiguities: [],
    })),
    needsReview: false,
    contextUsed: [],
    notes: null,
  };
}

const proposal = (over: Partial<Proposal>): Proposal => ({
  observation: 0,
  intent: "offer",
  decision: "abstain",
  partyId: null,
  reason: null,
  shortlist: [],
  ...over,
});

describe("scoreResolutions", () => {
  const labels = [
    label("right", [{ mention: "syon", partyId: "p1", resolution: "resolved" }]),
    label("wrong", [{ mention: "syon", partyId: "p2", resolution: "resolved" }]),
    label("new", [{ mention: "keine", partyId: null, resolution: "new_event" }]),
    label("missed", [{ mention: "syon", partyId: "p1", resolution: "resolved" }]),
    label("unanswered", [{ mention: "syon", partyId: "p1", resolution: "resolved" }]),
  ];
  const results = new Map<string, Proposal[] | null>([
    ["right", [proposal({ decision: "link", partyId: "p1", shortlist: ["p1", "p2"] })]],
    [
      "wrong",
      [
        proposal({
          decision: "link",
          partyId: "p1",
          shortlist: ["p1", "p2"],
          reason: "r",
        }),
      ],
    ],
    ["new", [proposal({ decision: "link", partyId: "p3", shortlist: ["p3"] })]],
    ["missed", [proposal({ shortlist: ["p2", "p1"] })]],
    ["unanswered", null],
  ]);

  it("separates retrieval from selection, and wrong editions from links to new events", () => {
    const score = scoreResolutions(labels, results, (id) => `name-${id}`);
    expect(score).toMatchObject({
      messages: 5,
      answered: 4,
      decisions: { link: 3, abstain: 1 },
      retrieval: {
        editions: 3,
        retrieved: 3,
        recallAtShortlist: 1,
        recallAtFirst: 1 / 3,
      },
      links: {
        editions: 3,
        links: 3,
        correct: 1,
        wrongEdition: 1,
        linkedNewEvent: 1,
        abstainedOnKnown: 1,
        precision: 1 / 3,
        coverage: 1 / 3,
      },
      newEvents: { messages: 1, detected: 0, predicted: 0 },
    });
    expect(score.wrongLinks).toEqual([
      { messageId: "wrong", linked: "name-p1", expected: ["name-p2"], reason: "r" },
      {
        messageId: "new",
        linked: "name-p3",
        expected: ["(a new event)"],
        reason: null,
      },
    ]);
  });

  it("leaves retrieval out for a matcher that has no shortlist", () => {
    expect(
      scoreResolutions(labels, results, (id) => id, { retrieval: false }).retrieval,
    ).toBeNull();
  });
});

describe("runResolutions", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "resolve-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("resolves the labelled observations against the catalog of the time, and skips what it is told to", async () => {
    const data = exportWith([
      message("m1", 0, "vendo syon fem 330"),
      message("m2", 1, "vendo syon fem 300"),
    ]);
    const labels = new Map([
      [
        "m1",
        label("m1", [{ mention: "Syon", partyId: "party-1", resolution: "resolved" }]),
      ],
    ]);
    const file = path.join(dir, "rules.jsonl");
    const run = await runResolutions({
      data,
      items: [item("m1"), item("m2")],
      resolver: rulesResolver,
      observationsFor: (i, view) => {
        const l = labels.get(i.messageId);
        return l ? observationsFromLabel(l, view) : null;
      },
      file,
      budgetUsd: 0,
      reserveUsd: () => 0,
    });
    expect(run).toMatchObject({ attempted: 2, byStatus: { ok: 1 } });
    const results = latestProposals(readJsonl<ResolutionRecord>(file));
    expect(results.get("m1")).toEqual([
      {
        observation: 0,
        intent: "offer",
        decision: "link",
        partyId: "party-1",
        reason: "mention:exact",
        shortlist: ["party-1"],
      },
    ]);
    expect(buildItemView(data, item("m1")).catalog.map((p) => p.id)).toEqual([
      "party-1",
    ]);
  });
});
