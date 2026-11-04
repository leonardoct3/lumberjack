import { z } from "zod";

export const ANNOTATION_SCHEMA_VERSION = 1;

export const INTENTS = [
  "demand",
  "offer",
  "promotion",
  "update",
  "withdrawal_claim",
  "unrelated",
  "unresolved",
] as const;

const span = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  /** The quoted text itself, so a shifted offset is caught instead of trusted. */
  text: z.string().min(1),
});

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
  price: z
    .object({
      amount: z.number().positive(),
      currency: z.enum(["BRL", "other"]),
      meaning: z.enum(["asking", "offered", "official", "paid", "unknown"]),
    })
    .nullable(),
  /** A missing year stays null: it is never filled in from the calendar. */
  eventDate: z
    .object({
      year: z.number().int().nullable(),
      month: z.number().int().min(1).max(12).nullable(),
      day: z.number().int().min(1).max(31).nullable(),
      basis: z.enum(["explicit", "inferred", "absent"]),
    })
    .nullable(),
  spans: z.array(span),
  relationship: z.object({
    kind: z.enum([
      "none",
      "duplicate",
      "renewed_intent",
      "price_update",
      "withdrawal",
      "unknown",
    ]),
    relatedMessage: z.string().nullable(),
  }),
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

const RELATIONSHIPS_NEEDING_TARGET = new Set([
  "duplicate",
  "renewed_intent",
  "price_update",
  "withdrawal",
]);

function isCalendarDate(year: number | null, month: number, day: number): boolean {
  // A leap year accepts 29/02 when the year is unknown.
  const probe = new Date(Date.UTC(year ?? 2028, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * Valid JSON is the easy part. These checks are the semantic ones a schema
 * cannot express: evidence quotes the message, dates exist, links name what
 * they link to, and nothing leans on context the labeller was not shown.
 */
export function validateAnnotation(
  raw: unknown,
  context: { text: string; availableContext?: string[] },
): { annotation: Annotation | null; errors: string[] } {
  const parsed = annotationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      annotation: null,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "annotation"}: ${issue.message}`,
      ),
    };
  }

  const value = parsed.data;
  const errors: string[] = [];

  value.observations.forEach((obs, i) => {
    const at = `observations[${i}]`;
    if (obs.intent !== "unrelated" && obs.spans.length === 0) {
      errors.push(`${at} needs at least one supporting span`);
    }
    obs.spans.forEach((s, j) => {
      if (s.end > context.text.length || s.start >= s.end) {
        errors.push(`${at}.spans[${j}] is outside the message (${s.start}..${s.end})`);
      } else if (context.text.slice(s.start, s.end) !== s.text) {
        errors.push(
          `${at}.spans[${j}] does not match the message text at ${s.start}..${s.end}`,
        );
      }
    });
    const date = obs.eventDate;
    if (
      date?.month != null &&
      date.day != null &&
      !isCalendarDate(date.year, date.month, date.day)
    ) {
      errors.push(`${at}.eventDate is not a calendar date`);
    }
    if (obs.event.resolution === "resolved" && obs.event.partyId == null) {
      errors.push(`${at}.event is resolved but names no partyId`);
    }
    if (
      RELATIONSHIPS_NEEDING_TARGET.has(obs.relationship.kind) &&
      obs.relationship.relatedMessage == null
    ) {
      errors.push(`${at}.relationship ${obs.relationship.kind} needs relatedMessage`);
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
