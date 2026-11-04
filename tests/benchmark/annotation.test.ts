import { describe, expect, it } from "vitest";
import {
  ANNOTATION_SCHEMA_VERSION,
  annotationJsonSchema,
  validateAnnotation,
} from "@/benchmark/annotation";

const text = "vendo 2 pista onix R$ 250 dia 24/10";

type Draft = Record<string, unknown> & { observations: Record<string, unknown>[] };

function annotation(overrides: Record<string, unknown> = {}): Draft {
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    messageId: "msg_0001",
    annotator: "rev_a",
    annotatedAt: "2026-11-04T15:00:00.000Z",
    source: "human",
    needsReview: false,
    contextUsed: [],
    notes: null,
    observations: [
      {
        intent: "offer",
        event: { mention: "onix", partyId: "party-1", resolution: "resolved" },
        ticketCategory: "pista",
        quantity: 2,
        price: { amount: 250, currency: "BRL", meaning: "asking" },
        eventDate: { year: null, month: 10, day: 24, basis: "explicit" },
        spans: [{ start: 0, end: 18, text: "vendo 2 pista onix" }],
        relationship: { kind: "none", relatedMessage: null },
        ambiguities: [],
      },
    ],
    ...overrides,
  };
}

describe("validateAnnotation", () => {
  it("accepts a well-formed label whose evidence matches the message", () => {
    const result = validateAnnotation(annotation(), { text });
    expect(result.errors).toEqual([]);
    expect(result.annotation?.observations).toHaveLength(1);
  });

  it("allows zero observations for a message with nothing to say", () => {
    expect(
      validateAnnotation(annotation({ observations: [] }), { text }).errors,
    ).toEqual([]);
  });

  it("rejects a span that does not quote the message", () => {
    const bad = annotation();
    bad.observations[0].spans = [{ start: 0, end: 18, text: "compro 2 pista onix" }];
    expect(validateAnnotation(bad, { text }).errors).toEqual([
      "observations[0].spans[0] does not match the message text at 0..18",
    ]);
  });

  it("rejects a span that runs past the end of the message", () => {
    const bad = annotation();
    bad.observations[0].spans = [{ start: 30, end: 99, text: "x" }];
    expect(validateAnnotation(bad, { text }).errors[0]).toMatch(/outside the message/);
  });

  it("requires evidence for anything other than an unrelated message", () => {
    const bad = annotation();
    bad.observations[0].spans = [];
    expect(validateAnnotation(bad, { text }).errors).toContain(
      "observations[0] needs at least one supporting span",
    );
  });

  it("keeps an unknown year unknown and rejects impossible dates", () => {
    const bad = annotation();
    bad.observations[0].eventDate = {
      year: 2026,
      month: 2,
      day: 30,
      basis: "inferred",
    };
    expect(validateAnnotation(bad, { text }).errors).toContain(
      "observations[0].eventDate is not a calendar date",
    );
  });

  it("requires a catalog event when the edition is marked resolved", () => {
    const bad = annotation();
    bad.observations[0].event = {
      mention: "onix",
      partyId: null,
      resolution: "resolved",
    };
    expect(validateAnnotation(bad, { text }).errors).toContain(
      "observations[0].event is resolved but names no partyId",
    );
  });

  it("requires the related message for an update or a duplicate", () => {
    const bad = annotation();
    bad.observations[0].relationship = { kind: "price_update", relatedMessage: null };
    expect(validateAnnotation(bad, { text }).errors).toContain(
      "observations[0].relationship price_update needs relatedMessage",
    );
  });

  it("refuses context that was not available to the labeller", () => {
    const bad = annotation({ contextUsed: ["msg_9999"] });
    expect(
      validateAnnotation(bad, { text, availableContext: ["msg_0002"] }).errors,
    ).toEqual(["contextUsed msg_9999 was not offered as context"]);
  });

  it("reports structural problems instead of throwing", () => {
    const result = validateAnnotation({ messageId: 3 }, { text });
    expect(result.annotation).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("annotationJsonSchema", () => {
  it("exports a JSON Schema an annotation tool can load", () => {
    const schema = annotationJsonSchema() as {
      type: string;
      properties: Record<string, unknown>;
    };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["messageId", "observations", "needsReview"]),
    );
  });
});
