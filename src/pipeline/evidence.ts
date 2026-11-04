import { z } from "zod";

/** Shared by human labels and model output, so both are held to the same evidence. */
export const INTENTS = [
  "demand",
  "offer",
  "promotion",
  "update",
  "withdrawal_claim",
  "unrelated",
  "unresolved",
] as const;

export const spanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  /** The quoted text itself, so a shifted offset is caught instead of trusted. */
  text: z.string().min(1),
});

export const priceSchema = z
  .object({
    amount: z.number().positive(),
    currency: z.enum(["BRL", "other"]),
    meaning: z.enum(["asking", "offered", "official", "paid", "unknown"]),
  })
  .nullable();

/** A missing year stays null: it is never filled in from the calendar. */
export const eventDateSchema = z
  .object({
    year: z.number().int().nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    day: z.number().int().min(1).max(31).nullable(),
    basis: z.enum(["explicit", "inferred", "absent"]),
  })
  .nullable();

export const relationshipSchema = z.object({
  kind: z.enum([
    "none",
    "duplicate",
    "renewed_intent",
    "price_update",
    "withdrawal",
    "unknown",
  ]),
  relatedMessage: z.string().nullable(),
});

type Evidence = {
  intent: (typeof INTENTS)[number];
  spans: z.infer<typeof spanSchema>[];
  eventDate: z.infer<typeof eventDateSchema>;
  relationship: z.infer<typeof relationshipSchema>;
};

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
 * Valid JSON is the easy part. These are the checks a schema cannot express:
 * evidence quotes the message, dates exist, and links name what they link to.
 */
export function evidenceErrors(
  observation: Evidence,
  text: string,
  at: string,
): string[] {
  const errors: string[] = [];
  if (observation.intent !== "unrelated" && observation.spans.length === 0) {
    errors.push(`${at} needs at least one supporting span`);
  }
  observation.spans.forEach((span, j) => {
    if (span.end > text.length || span.start >= span.end) {
      errors.push(
        `${at}.spans[${j}] is outside the message (${span.start}..${span.end})`,
      );
    } else if (text.slice(span.start, span.end) !== span.text) {
      errors.push(
        `${at}.spans[${j}] does not match the message text at ${span.start}..${span.end}`,
      );
    }
  });
  const date = observation.eventDate;
  if (
    date?.month != null &&
    date.day != null &&
    !isCalendarDate(date.year, date.month, date.day)
  ) {
    errors.push(`${at}.eventDate is not a calendar date`);
  }
  const { kind, relatedMessage } = observation.relationship;
  if (RELATIONSHIPS_NEEDING_TARGET.has(kind) && relatedMessage == null) {
    errors.push(`${at}.relationship ${kind} needs relatedMessage`);
  }
  return errors;
}

export function formatIssues(error: z.ZodError, root: string): string[] {
  return error.issues.map(
    (issue) => `${issue.path.join(".") || root}: ${issue.message}`,
  );
}
