import { describe, expect, it } from "vitest";
import { validateInterpretation } from "@/pipeline/observation";

const text = "vendo 2 pista onix R$ 250, e compro 1 camarote";
const request = { text, context: [{ id: "msg_earlier" }] };

const offer = {
  intent: "offer",
  eventMention: "onix",
  ticketCategory: "pista",
  quantity: 2,
  price: { amount: 250, currency: "BRL", meaning: "asking" },
  eventDate: null,
  spans: [{ start: 0, end: 25, text: "vendo 2 pista onix R$ 250" }],
  relationship: { kind: "none", relatedMessage: null },
  ambiguities: [],
};

describe("validateInterpretation", () => {
  it("accepts several evidence-backed observations from one message", () => {
    const demand = {
      ...offer,
      intent: "demand",
      eventMention: null,
      ticketCategory: "camarote",
      quantity: 1,
      price: null,
      spans: [{ start: 29, end: 46, text: "compro 1 camarote" }],
      ambiguities: ["camarote of which event"],
    };
    const result = validateInterpretation({ observations: [offer, demand] }, request);
    expect(result.errors).toEqual([]);
    expect(result.observations).toHaveLength(2);
  });

  it("rejects output that does not fit the schema", () => {
    const result = validateInterpretation(
      { observations: [{ intent: "sell" }] },
      request,
    );
    expect(result.observations).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects evidence the message does not contain", () => {
    const result = validateInterpretation(
      {
        observations: [
          {
            ...offer,
            spans: [{ start: 0, end: 25, text: "vendo 4 pista onix R$ 900" }],
          },
        ],
      },
      request,
    );
    expect(result.observations).toBeNull();
    expect(result.errors).toEqual([
      "observations[0].spans[0] does not match the message text at 0..25",
    ]);
  });

  it("rejects an observation without evidence unless the message is unrelated", () => {
    expect(
      validateInterpretation({ observations: [{ ...offer, spans: [] }] }, request)
        .errors,
    ).toEqual(["observations[0] needs at least one supporting span"]);
    expect(
      validateInterpretation(
        { observations: [{ ...offer, intent: "unrelated", spans: [] }] },
        request,
      ).errors,
    ).toEqual([]);
  });

  it("lets a relationship point only at an earlier message it was given", () => {
    const linked = (relatedMessage: string) => ({
      observations: [
        { ...offer, relationship: { kind: "renewed_intent", relatedMessage } },
      ],
    });
    expect(validateInterpretation(linked("msg_earlier"), request).errors).toEqual([]);
    expect(validateInterpretation(linked("msg_elsewhere"), request).errors).toEqual([
      "observations[0].relationship.relatedMessage msg_elsewhere is not an earlier message id",
    ]);
  });

  it("rejects impossible dates instead of storing them", () => {
    const result = validateInterpretation(
      {
        observations: [
          { ...offer, eventDate: { year: null, month: 2, day: 31, basis: "explicit" } },
        ],
      },
      request,
    );
    expect(result.errors).toEqual(["observations[0].eventDate is not a calendar date"]);
  });
});
