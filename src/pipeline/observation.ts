import { z } from "zod";
import {
  evidenceErrors,
  eventDateSchema,
  formatIssues,
  INTENTS,
  priceSchema,
  relationshipSchema,
  spanSchema,
} from "./evidence";

export const INTERPRETATION_SCHEMA_VERSION = 1;

/**
 * What an interpreter may say about a message. Which catalog edition it means
 * is the resolver's job, so only the mention as written appears here.
 */
export const interpretedObservationSchema = z.object({
  intent: z.enum(INTENTS),
  eventMention: z.string().nullable(),
  ticketCategory: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  price: priceSchema,
  eventDate: eventDateSchema,
  spans: z.array(spanSchema),
  relationship: relationshipSchema,
  ambiguities: z.array(z.string()),
});

export const interpretationSchema = z.object({
  observations: z.array(interpretedObservationSchema),
});

export type InterpretedObservation = z.infer<typeof interpretedObservationSchema>;

/** All or nothing: one unsupported observation rejects the whole output. */
export function validateInterpretation(
  raw: unknown,
  text: string,
): { observations: InterpretedObservation[] | null; errors: string[] } {
  const parsed = interpretationSchema.safeParse(raw);
  if (!parsed.success)
    return { observations: null, errors: formatIssues(parsed.error, "output") };

  const errors = parsed.data.observations.flatMap((observation, i) =>
    evidenceErrors(observation, text, `observations[${i}]`),
  );
  return errors.length > 0
    ? { observations: null, errors }
    : { observations: parsed.data.observations, errors: [] };
}
