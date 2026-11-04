import { classifyMessage, type MessageClass } from "@/domain/classify";
import { extractCandidates, type ExtractedCandidate } from "@/domain/extract";
import { matchParty } from "@/domain/match";
import { zonedParts } from "@/domain/timezone";
import type { Interpreter, InterpretationRequest } from "../interpreter";
import type { InterpretedObservation } from "../observation";

const INTENT: Record<MessageClass, InterpretedObservation["intent"]> = {
  admin_promo: "promotion",
  pista_oferta: "offer",
  pista_procura: "demand",
  ruido: "unrelated",
};

/** The rules cannot point at the words they relied on, so they cite the passage they read. */
function spanOf(text: string, passage: string) {
  const trimmed = passage.trim();
  const start = trimmed.length > 0 ? text.indexOf(trimmed) : -1;
  if (start >= 0) return { start, end: start + trimmed.length, text: trimmed };
  const lead = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  return { start: lead, end, text: text.slice(lead, end) };
}

function observation(
  intent: InterpretedObservation["intent"],
  fields: Partial<InterpretedObservation> = {},
): InterpretedObservation {
  return {
    intent,
    eventMention: null,
    ticketCategory: null,
    quantity: null,
    price: null,
    eventDate: null,
    spans: [],
    relationship: { kind: "none", relatedMessage: null },
    ambiguities: [],
    ...fields,
  };
}

function fromCandidate(
  text: string,
  candidate: ExtractedCandidate,
): InterpretedObservation {
  const day = candidate.eventAt ? zonedParts(candidate.eventAt) : null;
  return observation("promotion", {
    eventMention: candidate.name,
    ticketCategory: candidate.lotLabel,
    price:
      candidate.officialPrice != null && candidate.officialPrice > 0
        ? { amount: candidate.officialPrice, currency: "BRL", meaning: "official" }
        : null,
    // The extractor fills a missing year from the calendar, so its year is not evidence.
    eventDate: day
      ? { year: null, month: day.month, day: day.day, basis: "explicit" }
      : null,
    spans: [spanOf(text, candidate.excerpt ?? text)],
  });
}

/**
 * Today's classifier, matcher and extractor, read as observations. It costs
 * nothing, so the whole pipeline runs without a provider, and it is the line
 * any model has to beat on the benchmark.
 */
export const rulesInterpreter: Interpreter = {
  name: "rules",
  version: "1",
  provider: null,
  model: null,
  promptVersion: null,
  paid: false,
  async interpret(request: InterpretationRequest) {
    const { text } = request;
    const intent = INTENT[classifyMessage({ text, senderRole: request.senderRole })];

    if (intent === "unrelated")
      return { output: { observations: [observation("unrelated")] } };

    if (intent === "promotion") {
      const candidates = extractCandidates(text, request.sentAt);
      if (candidates.length > 0) {
        return {
          output: { observations: candidates.map((c) => fromCandidate(text, c)) },
        };
      }
    }

    const party = matchParty(text, request.catalog);
    return {
      output: {
        observations: [
          observation(intent, {
            eventMention: party?.name ?? null,
            spans: [spanOf(text, text)],
          }),
        ],
      },
    };
  },
};
