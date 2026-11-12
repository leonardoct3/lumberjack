import { z } from "zod";
import { formatIssues, INTENTS } from "@/pipeline/evidence";
import type { ItemView } from "../label/item";

const RESOLUTIONS = ["resolved", "new_event", "ambiguous", "not_mentioned"] as const;
const CURRENCIES = ["BRL", "other"] as const;
const MEANINGS = ["asking", "offered", "official", "paid", "unknown"] as const;
const BASES = ["explicit", "inferred", "absent"] as const;
const RELATIONSHIPS = [
  "none",
  "duplicate",
  "renewed_intent",
  "price_update",
  "withdrawal",
  "unknown",
] as const;

/**
 * What a drafting model answers. It quotes evidence instead of counting
 * characters, which models get wrong; offsets are found here.
 */
const draftObservation = z.object({
  intent: z.enum(INTENTS),
  event: z.object({
    mention: z.string().nullable(),
    partyId: z.string().nullable(),
    resolution: z.enum(RESOLUTIONS),
  }),
  ticketCategory: z.string().nullable(),
  quantity: z.number().nullable(),
  price: z
    .object({
      amount: z.number(),
      currency: z.enum(CURRENCIES),
      meaning: z.enum(MEANINGS),
    })
    .nullable(),
  eventDate: z
    .object({
      year: z.number().nullable(),
      month: z.number().nullable(),
      day: z.number().nullable(),
      basis: z.enum(BASES),
    })
    .nullable(),
  quotes: z.array(z.string()),
  relationship: z.object({
    kind: z.enum(RELATIONSHIPS),
    relatedMessage: z.string().nullable(),
  }),
  ambiguities: z.array(z.string()),
});

export const draftSchema = z.object({
  observations: z.array(draftObservation),
  needsReview: z.boolean(),
  contextUsed: z.array(z.string()),
  notes: z.string().nullable(),
});

export type Draft = z.infer<typeof draftSchema>;

type JsonSchema = Record<string, unknown>;

const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: "null" }],
});
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: "string" };
const integer = { type: "integer" };
const oneOf = (values: readonly string[]) => ({ type: "string", enum: [...values] });

/**
 * Written by hand because both providers' strict modes accept only a subset of
 * JSON Schema: every property required, no numeric bounds. The bounds are
 * enforced afterwards by `validateAnnotation`.
 */
export const DRAFT_JSON_SCHEMA: JsonSchema = object({
  observations: {
    type: "array",
    items: object({
      intent: oneOf(INTENTS),
      event: object({
        mention: nullable(string),
        partyId: nullable(string),
        resolution: oneOf(RESOLUTIONS),
      }),
      ticketCategory: nullable(string),
      quantity: nullable(integer),
      price: nullable(
        object({
          amount: { type: "number" },
          currency: oneOf(CURRENCIES),
          meaning: oneOf(MEANINGS),
        }),
      ),
      eventDate: nullable(
        object({
          year: nullable(integer),
          month: nullable(integer),
          day: nullable(integer),
          basis: oneOf(BASES),
        }),
      ),
      quotes: { type: "array", items: string },
      relationship: object({
        kind: oneOf(RELATIONSHIPS),
        relatedMessage: nullable(string),
      }),
      ambiguities: { type: "array", items: string },
    }),
  },
  needsReview: { type: "boolean" },
  contextUsed: { type: "array", items: string },
  notes: nullable(string),
});

/**
 * Turns a model's answer into the body a human label would send, so drafts go
 * through the same `buildLabel` checks. Errors are worded for the model to fix
 * and never repeat message text.
 */
export function draftToLabelBody(
  output: unknown,
  view: ItemView,
): { body: unknown; errors: string[] } {
  const parsed = draftSchema.safeParse(output);
  if (!parsed.success)
    return { body: null, errors: formatIssues(parsed.error, "draft") };

  const draft = parsed.data;
  const errors: string[] = [];
  const parties = new Set(view.catalog.map((p) => p.id));
  const earlier = new Set(view.context.map((c) => c.id));
  const used = new Set(draft.contextUsed);

  const observations = draft.observations.map((obs, i) => {
    const at = `observations[${i}]`;
    const { partyId } = obs.event;
    if (partyId != null && !parties.has(partyId)) {
      errors.push(`${at}.event.partyId ${partyId} is not a catalog party id`);
    }
    const { relatedMessage } = obs.relationship;
    if (relatedMessage != null && !earlier.has(relatedMessage)) {
      errors.push(
        `${at}.relationship.relatedMessage ${relatedMessage} is not an earlier message id`,
      );
    }
    if (partyId != null) used.add(partyId);
    if (relatedMessage != null) used.add(relatedMessage);

    const { quotes, ...rest } = obs;
    const spans = quotes.flatMap((quote, j) => {
      const start = quote.length > 0 ? view.text.indexOf(quote) : -1;
      if (start < 0) {
        errors.push(`${at}.quotes[${j}] is not an exact substring of the message`);
        return [];
      }
      return [{ start, end: start + quote.length, text: quote }];
    });
    return { ...rest, spans };
  });

  return {
    body: {
      observations,
      needsReview: draft.needsReview,
      contextUsed: [...used],
      notes: draft.notes,
    },
    errors,
  };
}
