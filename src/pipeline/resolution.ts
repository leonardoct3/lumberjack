import { z } from "zod";
import { normalizeText } from "@/domain/normalize";
import { partyAffinity } from "@/domain/similar";
import { zonedParts } from "@/domain/timezone";
import type { INTENTS } from "./evidence";
import type { CatalogEntry, InterpreterResult } from "./interpreter";

export const RESOLUTION_SCHEMA_VERSION = 1;

/** How many editions retrieval hands to selection; one it leaves out can never be chosen. */
export const SHORTLIST_SIZE = 5;

export const DECISIONS = ["link", "new_event", "abstain", "not_mentioned"] as const;
export type Decision = (typeof DECISIONS)[number];

/** What resolution reads of one observation; the interpreter never picked an edition. */
export type ResolutionObservation = {
  position: number;
  intent: (typeof INTENTS)[number];
  eventMention: string | null;
  ticketCategory: string | null;
  eventDate: {
    year: number | null;
    month: number | null;
    day: number | null;
    basis: string;
  } | null;
  /** The earlier message this observation answers or updates, when the interpreter named one. */
  relatedText: string | null;
};

export type Candidate = {
  partyId: string;
  name: string;
  aliases: string[];
  eventAt: Date;
  /** 3 the same name, 2 one name inside the other, 1 most words shared, 0.5 one word shared. */
  nameMatch: number;
  /** Positive when the written date fits the edition, negative when it contradicts it. */
  dateFit: number;
  score: number;
  /** Short codes such as `mention:exact` or `date:conflict`, kept as evidence for review. */
  reasons: string[];
};

export type ResolutionRequest = {
  text: string;
  sentAt: Date;
  observations: ResolutionObservation[];
  catalog: CatalogEntry[];
  /** Retrieval's answer, one list per observation in the same order. */
  shortlists: Candidate[][];
};

export interface Resolver {
  name: string;
  version: string;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  paid: boolean;
  resolve(request: ResolutionRequest, signal: AbortSignal): Promise<InterpreterResult>;
}

const NOISE = new Set(["festa", "show", "baile", "the", "com", "das", "dos"]);

const words = (value: string) =>
  normalizeText(value)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4 && !NOISE.has(w));

/** Whole-word containment, so "sp" never matches inside "spa". */
function mentions(haystack: string, needle: string): boolean {
  const n = normalizeText(needle)
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim();
  if (n.length < 3) return false;
  const h = ` ${normalizeText(haystack).replace(/[^a-z0-9 ]+/g, " ")} `;
  return h.includes(` ${n} `);
}

const MENTION_REASON: Record<number, string> = {
  3: "mention:exact",
  2: "mention:contains",
  1: "mention:words",
};

function nameMatch(
  observation: ResolutionObservation,
  text: string,
  party: CatalogEntry,
): { match: number; reasons: string[] } {
  const names = [party.name, ...party.aliases];
  const mention = observation.eventMention?.trim();
  if (mention) {
    const affinity = partyAffinity(mention, party);
    if (affinity > 0) return { match: affinity, reasons: [MENTION_REASON[affinity]] };
    const own = new Set(words(mention));
    if (names.some((n) => words(n).some((w) => own.has(w))))
      return { match: 0.5, reasons: ["mention:word"] };
    return { match: 0, reasons: [] };
  }
  // With no mention the whole text is searched; with one, other events a blast names are not this one's.
  if (names.some((n) => mentions(text, n))) return { match: 2, reasons: ["text:name"] };
  if (
    observation.relatedText &&
    names.some((n) => mentions(observation.relatedText!, n))
  )
    return { match: 1.5, reasons: ["related:name"] };
  return { match: 0, reasons: [] };
}

const DAY_MS = 86_400_000;

/** Day difference on the São Paulo calendar, with a missing year taken from the edition. */
function dateFit(
  date: ResolutionObservation["eventDate"],
  eventAt: Date,
): { fit: number; reasons: string[] } {
  if (!date || date.basis === "absent" || (date.month == null && date.day == null))
    return { fit: 0, reasons: [] };
  const edition = zonedParts(eventAt);
  const explicit = date.basis === "explicit";
  if (date.year != null && date.year !== edition.year)
    return { fit: explicit ? -2 : -1, reasons: ["date:other-year"] };
  if (date.month != null && date.day != null) {
    const written = Date.UTC(date.year ?? edition.year, date.month - 1, date.day);
    const off = Math.abs(
      Math.round(
        (written - Date.UTC(edition.year, edition.month - 1, edition.day)) / DAY_MS,
      ),
    );
    // Parties run past midnight, so the day after is the same night.
    if (off === 0) return { fit: 2, reasons: ["date:same-day"] };
    if (off === 1) return { fit: 1, reasons: ["date:adjacent-day"] };
    return { fit: explicit ? -2 : -1, reasons: ["date:conflict"] };
  }
  if (date.month != null)
    return date.month === edition.month
      ? { fit: 0.5, reasons: ["date:same-month"] }
      : { fit: explicit ? -2 : -1, reasons: ["date:other-month"] };
  return { fit: 0, reasons: [] };
}

/**
 * Deterministic retrieval: names and aliases first, written dates second.
 * Every edition that answers to the name is kept, even one the date
 * contradicts, so selection can see that the name alone is not enough.
 */
export function retrieveEditions(
  observation: ResolutionObservation,
  text: string,
  catalog: CatalogEntry[],
  size: number = SHORTLIST_SIZE,
): Candidate[] {
  if (observation.intent === "unrelated") return [];
  return catalog
    .flatMap((party) => {
      const name = nameMatch(observation, text, party);
      if (name.match === 0) return [];
      const date = dateFit(observation.eventDate, party.eventAt);
      return [
        {
          partyId: party.id,
          name: party.name,
          aliases: party.aliases,
          eventAt: party.eventAt,
          nameMatch: name.match,
          dateFit: date.fit,
          score: name.match * 2 + date.fit,
          reasons: [...name.reasons, ...date.reasons],
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.eventAt.getTime() - b.eventAt.getTime() ||
        a.partyId.localeCompare(b.partyId),
    )
    .slice(0, size);
}

export function prepareResolution(input: {
  text: string;
  sentAt: Date;
  observations: ResolutionObservation[];
  catalog: CatalogEntry[];
}): ResolutionRequest {
  return {
    ...input,
    shortlists: input.observations.map((o) =>
      retrieveEditions(o, input.text, input.catalog),
    ),
  };
}

const REASON_LIMIT = 300;

export const resolutionSchema = z.object({
  resolutions: z.array(
    z.object({
      observation: z.number().int().min(0),
      decision: z.enum(DECISIONS),
      partyId: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
});

export type ResolvedObservation = z.infer<
  typeof resolutionSchema
>["resolutions"][number];

/**
 * One decision per observation, and a link only to an edition retrieval
 * offered for that observation: a resolver cannot reach past the shortlist.
 */
export function validateResolution(
  raw: unknown,
  request: Pick<ResolutionRequest, "observations" | "shortlists">,
): { resolutions: ResolvedObservation[] | null; errors: string[] } {
  const parsed = resolutionSchema.safeParse(raw);
  if (!parsed.success)
    return {
      resolutions: null,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "output"}: ${issue.message}`,
      ),
    };

  const errors: string[] = [];
  const seen = new Set<number>();
  for (const r of parsed.data.resolutions) {
    const at = `resolutions for observation ${r.observation}`;
    if (r.observation >= request.observations.length) {
      errors.push(`${at}: there is no such observation`);
      continue;
    }
    if (seen.has(r.observation)) errors.push(`${at}: decided twice`);
    seen.add(r.observation);
    const offered = request.shortlists[r.observation].map((c) => c.partyId);
    if (r.decision === "link") {
      if (r.partyId == null || !offered.includes(r.partyId))
        errors.push(`${at}: links to an edition that was not shortlisted`);
    } else if (r.partyId != null) {
      errors.push(`${at}: ${r.decision} names an edition`);
    }
  }
  request.observations.forEach((_, i) => {
    if (!seen.has(i)) errors.push(`observation ${i} has no decision`);
  });
  if (errors.length > 0) return { resolutions: null, errors };
  return {
    resolutions: [...parsed.data.resolutions]
      .sort((a, b) => a.observation - b.observation)
      .map((r) => ({ ...r, reason: r.reason?.slice(0, REASON_LIMIT) ?? null })),
    errors: [],
  };
}
