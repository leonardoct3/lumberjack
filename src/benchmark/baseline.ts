import { classifyMessage, type MessageClass, type SenderRole } from "@/domain/classify";
import { extractCandidates } from "@/domain/extract";
import { isPastEvent } from "@/domain/gates";
import { matchParty } from "@/domain/match";
import type { Annotation } from "./annotation";
import type { ExportedMessage } from "./export";

export const BASELINE_VERSION = 1;

export type ExportedParty = {
  id: string;
  name: string;
  aliases: string[];
  eventAt: string;
  statusNow: string;
  createdAt: string;
};

export type BaselinePrediction = {
  messageId: string;
  replayedClass: MessageClass;
  intents: string[];
  partyId: string | null;
  candidateNames: string[];
  /** What production stored at the time, for drift between then and the current rules. */
  stored: { class: string | null; partyId: string | null };
};

const INTENT_OF: Record<MessageClass, string> = {
  admin_promo: "promotion",
  pista_oferta: "offer",
  pista_procura: "demand",
  ruido: "unrelated",
};

/**
 * The catalog a message could have been matched against when it arrived. Names
 * and aliases are still today's; the export manifest discloses that leak.
 */
export function catalogAsOf(
  parties: ExportedParty[],
  at: Date,
  mode: CatalogMode = "as_of_message",
): ExportedParty[] {
  return parties.filter(
    (party) =>
      (mode === "retrospective" || new Date(party.createdAt) <= at) &&
      !isPastEvent(new Date(party.eventAt), at),
  );
}

/**
 * `as_of_message` is online replay: only events catalogued before the message.
 * `retrospective` is cleanup with hindsight, using events catalogued later; it
 * may never be reported as what the system could have known at the time.
 */
export type CatalogMode = "as_of_message" | "retrospective";

/**
 * The existing rules, replayed message by message. Copies and muted senders
 * never link or open a candidate, exactly as ingestion treats them, so this
 * measures the system that ran rather than a kinder version of it.
 */
export function runBaseline(
  messages: ExportedMessage[],
  parties: ExportedParty[],
  options: { catalog: CatalogMode } = { catalog: "as_of_message" },
): BaselinePrediction[] {
  return messages.map((message) => {
    const sentAt = new Date(message.sentAt);
    const replayedClass = classifyMessage({
      text: message.text,
      senderRole: message.senderRoleNow as SenderRole,
    });
    const acts = message.duplicateOf == null && !message.senderMutedNow;

    let partyId: string | null = null;
    if (
      acts &&
      (replayedClass === "pista_oferta" || replayedClass === "pista_procura")
    ) {
      const catalog = catalogAsOf(parties, sentAt, options.catalog).map((party) => ({
        id: party.id,
        name: party.name,
        aliases: party.aliases,
        status: "upcoming" as const,
      }));
      partyId = matchParty(message.text, catalog)?.id ?? null;
    }

    const candidateNames =
      acts && replayedClass === "admin_promo"
        ? extractCandidates(message.text, sentAt)
            .map((candidate) => candidate.name)
            .filter((name): name is string => name != null)
        : [];

    return {
      messageId: message.id,
      replayedClass,
      intents: [INTENT_OF[replayedClass]],
      partyId,
      candidateNames,
      stored: { class: message.storedClass, partyId: message.partyId },
    };
  });
}

const Z = 1.96;

/** 95% Wilson score interval; honest about how little a small clean sample proves. */
export function wilsonInterval(successes: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const p = successes / n;
  const denominator = 1 + (Z * Z) / n;
  const centre = p + (Z * Z) / (2 * n);
  const spread = Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n));
  const round = (x: number) => Math.min(1, Math.max(0, Math.round(x * 1e9) / 1e9));
  return [
    round((centre - spread) / denominator),
    round((centre + spread) / denominator),
  ];
}

export type IntentScore = {
  tp: number;
  fp: number;
  fn: number;
  support: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  precisionInterval: [number, number] | null;
  recallInterval: [number, number] | null;
};

export type IntentReport = {
  messages: number;
  perIntent: Record<string, IntentScore>;
  missedDemand: number;
  multiIntent: { messages: number; fullyRecovered: number };
};

function goldIntents(annotation: Annotation): Set<string> {
  const intents = new Set(annotation.observations.map((o) => o.intent));
  return intents.size === 0 ? new Set(["unrelated"]) : intents;
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function scoreIntents(
  gold: Annotation[],
  predictions: BaselinePrediction[],
): IntentReport {
  const predicted = new Map(predictions.map((p) => [p.messageId, new Set(p.intents)]));
  const counts: Record<string, { tp: number; fp: number; fn: number }> = {};
  const bump = (intent: string, key: "tp" | "fp" | "fn") => {
    counts[intent] ??= { tp: 0, fp: 0, fn: 0 };
    counts[intent][key] += 1;
  };

  let multi = 0;
  let recovered = 0;
  for (const annotation of gold) {
    const truth = goldIntents(annotation);
    const guess = predicted.get(annotation.messageId) ?? new Set<string>();
    for (const intent of truth) bump(intent, guess.has(intent) ? "tp" : "fn");
    for (const intent of guess) if (!truth.has(intent)) bump(intent, "fp");

    const substantive = [...truth].filter(
      (i) => i !== "unrelated" && i !== "unresolved",
    );
    if (substantive.length > 1) {
      multi += 1;
      if (substantive.every((i) => guess.has(i))) recovered += 1;
    }
  }

  const perIntent: Record<string, IntentScore> = {};
  for (const [intent, { tp, fp, fn }] of Object.entries(counts)) {
    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);
    perIntent[intent] = {
      tp,
      fp,
      fn,
      support: tp + fn,
      precision,
      recall,
      f1:
        precision == null || recall == null || precision + recall === 0
          ? null
          : (2 * precision * recall) / (precision + recall),
      precisionInterval: wilsonInterval(tp, tp + fp),
      recallInterval: wilsonInterval(tp, tp + fn),
    };
  }

  return {
    messages: gold.length,
    perIntent,
    missedDemand: perIntent.demand?.fn ?? 0,
    multiIntent: { messages: multi, fullyRecovered: recovered },
  };
}

export type LinkReport = {
  labelledWithEdition: number;
  predictedLinks: number;
  correctLinks: number;
  wrongEdition: number;
  linkedWithoutGoldEdition: number;
  missedLinks: number;
  /** Of the links the rules made, how many named the right edition. */
  precision: number | null;
  precisionInterval: [number, number] | null;
  /** Of the messages whose edition is known, how many the rules linked at all. */
  coverage: number | null;
};

export function scoreLinks(
  gold: Annotation[],
  predictions: BaselinePrediction[],
): LinkReport {
  const byMessage = new Map(predictions.map((p) => [p.messageId, p.partyId]));
  const report = {
    labelledWithEdition: 0,
    predictedLinks: 0,
    correctLinks: 0,
    wrongEdition: 0,
    linkedWithoutGoldEdition: 0,
    missedLinks: 0,
  };
  let covered = 0;

  for (const annotation of gold) {
    const editions = new Set(
      annotation.observations
        .filter((o) => o.event.resolution === "resolved" && o.event.partyId != null)
        .map((o) => o.event.partyId!),
    );
    const linked = byMessage.get(annotation.messageId) ?? null;
    if (editions.size > 0) report.labelledWithEdition += 1;
    if (linked == null) {
      if (editions.size > 0) report.missedLinks += 1;
      continue;
    }
    report.predictedLinks += 1;
    if (editions.size === 0) report.linkedWithoutGoldEdition += 1;
    else {
      covered += 1;
      if (editions.has(linked)) report.correctLinks += 1;
      else report.wrongEdition += 1;
    }
  }

  return {
    ...report,
    precision: ratio(report.correctLinks, report.predictedLinks),
    precisionInterval: wilsonInterval(report.correctLinks, report.predictedLinks),
    coverage: ratio(covered, report.labelledWithEdition),
  };
}
