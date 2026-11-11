import { describe, expect, it } from "vitest";
import type { Annotation } from "@/benchmark/annotation";
import {
  auditReport,
  buildReviewPlan,
  compareAnnotations,
} from "@/benchmark/draft/compare";
import { item } from "./draft-fixture";

type Obs = Annotation["observations"][number];

function obs(over: Partial<Obs> = {}): Obs {
  return {
    intent: "offer",
    event: { mention: "syon", partyId: "party-1", resolution: "resolved" },
    ticketCategory: "fem",
    quantity: null,
    price: { amount: 330, currency: "BRL", meaning: "asking" },
    eventDate: null,
    spans: [{ start: 0, end: 4, text: "syon" }],
    relationship: { kind: "none", relatedMessage: null },
    ambiguities: [],
    ...over,
  };
}

function annotation(
  messageId: string,
  observations: Obs[],
  source: Annotation["source"] = "model_draft",
): Annotation {
  return {
    schemaVersion: 1,
    messageId,
    annotator: source === "human" ? "lc" : "model",
    annotatedAt: "2026-11-11T00:00:00.000Z",
    source,
    observations,
    needsReview: false,
    contextUsed: [],
    notes: null,
  };
}

describe("compareAnnotations", () => {
  it("ignores evidence wording, case in categories and observation order", () => {
    const a = annotation("m", [obs(), obs({ intent: "demand", price: null })]);
    const b = annotation("m", [
      obs({ intent: "demand", price: null, spans: [] }),
      obs({ ticketCategory: " FEM ", ambiguities: ["unit or total?"] }),
    ]);
    expect(compareAnnotations(a, b)).toEqual([]);
  });

  it("names every scored field that differs", () => {
    const a = annotation("m", [obs()]);
    const b = annotation("m", [
      obs({
        price: { amount: 300, currency: "BRL", meaning: "asking" },
        eventDate: { year: null, month: 10, day: 17, basis: "explicit" },
      }),
    ]);
    expect(compareAnnotations(a, b)).toEqual(["price", "date"]);
    expect(compareAnnotations(a, annotation("m", [obs(), obs()]))[0]).toBe(
      "observations",
    );
  });
});

describe("buildReviewPlan", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);
  const items = [
    ...ids.map((id, i) => item(id, { split: i < 2 ? "test" : "development" })),
    item("gone", { excluded: "template_leak" }),
  ];
  const a = new Map(ids.map((id) => [id, annotation(id, [obs()])]));
  const b = new Map(
    ids
      .filter((id) => id !== "m11")
      .map((id) => [id, annotation(id, [id === "m2" ? obs({ quantity: 2 }) : obs()])]),
  );
  const plan = buildReviewPlan({
    items,
    drafts: [
      { id: "A", byMessage: a },
      { id: "B", byMessage: b },
    ],
    seed: "seed",
    auditSize: 3,
  });

  it("sends disagreements, missing drafts, the test split and an audit to review", () => {
    const reasons = Object.fromEntries(
      plan.review.map((e) => [e.messageId, e.reasons]),
    );
    expect(reasons.m0).toEqual(["test"]);
    expect(reasons.m2).toEqual(["disagreement"]);
    expect(reasons.m11).toEqual(["missing_draft"]);
    expect(plan.review.find((e) => e.messageId === "m2")!.differing).toEqual([
      "quantity",
    ]);
    expect(plan.counts).toMatchObject({
      usable: 12,
      agreed: 10,
      test: 2,
      audit: 3,
      disagreement: 1,
      missing_draft: 1,
    });
  });

  it("keeps the rest as silver, never the test split or an excluded item", () => {
    expect(plan.silver).toHaveLength(10 - 2 - 3);
    const reviewed = new Set(plan.review.map((e) => e.messageId));
    for (const id of plan.silver) {
      expect(reviewed.has(id)).toBe(false);
      expect(["m0", "m1", "gone"]).not.toContain(id);
    }
  });

  it("draws the same audit for the same seed", () => {
    const again = buildReviewPlan({
      items,
      drafts: [
        { id: "A", byMessage: a },
        { id: "B", byMessage: b },
      ],
      seed: "seed",
      auditSize: 3,
    });
    expect(again).toEqual(plan);
  });

  it("measures silver error from reviewed audit items only", () => {
    const audited = plan.review
      .filter((e) => e.reasons.includes("audit"))
      .map((e) => e.messageId);
    const human = new Map([
      [audited[0], annotation(audited[0], [obs()], "human")],
      [audited[1], annotation(audited[1], [obs({ intent: "demand" })], "human")],
    ]);
    expect(auditReport(plan, a, human)).toMatchObject({
      audited: 3,
      reviewed: 2,
      changed: 1,
      errorRate: 0.5,
      changedFields: { intent: 1 },
    });
  });
});
