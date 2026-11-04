import { z } from "zod";
import {
  evidenceErrors,
  eventDateSchema,
  formatIssues,
  INTENTS,
  priceSchema,
  relationshipSchema,
  spanSchema,
} from "@/pipeline/evidence";

export { INTENTS };

export const ANNOTATION_SCHEMA_VERSION = 1;

const observation = z.object({
  intent: z.enum(INTENTS),
  event: z.object({
    /** As written in the message, before any normalisation. */
    mention: z.string().nullable(),
    /** The edition in the catalog, only when the permitted context proves which one. */
    partyId: z.string().nullable(),
    resolution: z.enum(["resolved", "new_event", "ambiguous", "not_mentioned"]),
  }),
  ticketCategory: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  price: priceSchema,
  eventDate: eventDateSchema,
  spans: z.array(spanSchema),
  relationship: relationshipSchema,
  ambiguities: z.array(z.string()),
});

export const annotationSchema = z.object({
  schemaVersion: z.literal(ANNOTATION_SCHEMA_VERSION),
  messageId: z.string().min(1),
  /** A reviewer pseudonym, never a real name. */
  annotator: z.string().min(1),
  annotatedAt: z.iso.datetime(),
  /** Model drafts bootstrap labelling; only human-reviewed labels are gold. */
  source: z.enum(["human", "model_draft"]),
  observations: z.array(observation),
  needsReview: z.boolean(),
  contextUsed: z.array(z.string()),
  notes: z.string().nullable(),
});

export type Annotation = z.infer<typeof annotationSchema>;

/**
 * The shared evidence checks, plus what only a label can get wrong: naming an
 * edition it calls resolved, and leaning on context the labeller was not shown.
 */
export function validateAnnotation(
  raw: unknown,
  context: { text: string; availableContext?: string[] },
): { annotation: Annotation | null; errors: string[] } {
  const parsed = annotationSchema.safeParse(raw);
  if (!parsed.success) {
    return { annotation: null, errors: formatIssues(parsed.error, "annotation") };
  }

  const value = parsed.data;
  const errors: string[] = [];

  value.observations.forEach((obs, i) => {
    const at = `observations[${i}]`;
    errors.push(...evidenceErrors(obs, context.text, at));
    if (obs.event.resolution === "resolved" && obs.event.partyId == null) {
      errors.push(`${at}.event is resolved but names no partyId`);
    }
  });

  if (context.availableContext) {
    const offered = new Set(context.availableContext);
    for (const id of value.contextUsed) {
      if (!offered.has(id)) errors.push(`contextUsed ${id} was not offered as context`);
    }
  }

  return { annotation: value, errors };
}

export function annotationJsonSchema(): unknown {
  return z.toJSONSchema(annotationSchema);
}
