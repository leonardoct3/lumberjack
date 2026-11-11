import type { InterpretedObservation } from "@/pipeline/observation";
import {
  prepareResolution,
  validateResolution,
  type Decision,
  type ResolutionObservation,
  type ResolutionRequest,
  type Resolver,
} from "@/pipeline/resolution";
import type { Annotation } from "./annotation";
import { wilsonInterval } from "./baseline";
import type { LoadedExport } from "./dataset";
import { requestFromView } from "./interpret";
import { buildItemView, type ItemView, type LabelItem } from "./label/item";
import { runCalls, type CallRecord, type RunReport } from "./runner";

function related(view: ItemView, id: string | null): string | null {
  return id == null ? null : (view.context.find((c) => c.id === id)?.text ?? null);
}

/** The labelled observations, so resolution is measured apart from interpretation's mistakes. */
export function observationsFromLabel(
  label: Annotation,
  view: ItemView,
): ResolutionObservation[] {
  return label.observations.map((o, i) => ({
    position: i,
    intent: o.intent,
    eventMention: o.event.mention,
    ticketCategory: o.ticketCategory,
    eventDate: o.eventDate,
    relatedText: related(view, o.relationship.relatedMessage),
  }));
}

/** What an interpreter read, which is what the pipeline would resolve. */
export function observationsFromInterpretation(
  observations: InterpretedObservation[],
  view: ItemView,
): ResolutionObservation[] {
  return observations.map((o, i) => ({
    position: i,
    intent: o.intent,
    eventMention: o.eventMention,
    ticketCategory: o.ticketCategory,
    eventDate: o.eventDate,
    relatedText: related(view, o.relationship.relatedMessage),
  }));
}

export function resolutionRequestFromView(
  view: ItemView,
  observations: ResolutionObservation[],
): ResolutionRequest {
  const { text, sentAt, catalog } = requestFromView(view);
  return prepareResolution({ text, sentAt, observations, catalog });
}

export type Proposal = {
  observation: number;
  intent: string;
  decision: Decision;
  partyId: string | null;
  reason: string | null;
  /** Shortlisted edition ids, best first. */
  shortlist: string[];
};

export type ResolutionRecord = CallRecord & { proposals: Proposal[] | null };

export type ResolutionRunReport = RunReport & {
  resolver: Pick<Resolver, "name" | "version" | "provider" | "model" | "promptVersion">;
};

export async function runResolutions(options: {
  data: LoadedExport;
  items: LabelItem[];
  resolver: Resolver;
  /** null skips the item, such as one the interpreter never answered. */
  observationsFor: (item: LabelItem, view: ItemView) => ResolutionObservation[] | null;
  file: string;
  budgetUsd: number;
  reserveUsd: (request: ResolutionRequest) => number;
  concurrency?: number;
  limit?: number;
  log?: (line: string) => void;
}): Promise<ResolutionRunReport> {
  const { resolver } = options;
  const run = await runCalls({
    ...options,
    name: resolver.name,
    paid: resolver.paid,
    emptyPayload: { proposals: null },
    prepare(item) {
      const view = buildItemView(options.data, item);
      const observations = options.observationsFor(item, view);
      if (!observations) return null;
      const request = resolutionRequestFromView(view, observations);
      return {
        reserveUsd: options.reserveUsd(request),
        invoke: (signal) => resolver.resolve(request, signal),
        check(output) {
          const { resolutions, errors } = validateResolution(output, request);
          return {
            ok: resolutions != null,
            errors,
            payload: {
              proposals:
                resolutions?.map((r) => ({
                  observation: r.observation,
                  intent: request.observations[r.observation].intent,
                  decision: r.decision,
                  partyId: r.partyId,
                  reason: r.reason,
                  shortlist: request.shortlists[r.observation].map((c) => c.partyId),
                })) ?? null,
            },
          };
        },
      };
    },
  });
  return {
    resolver: {
      name: resolver.name,
      version: resolver.version,
      provider: resolver.provider,
      model: resolver.model,
      promptVersion: resolver.promptVersion,
    },
    ...run,
  };
}

export function latestProposals(records: ResolutionRecord[]) {
  const latest = new Map<string, Proposal[] | null>();
  for (const r of records) latest.set(r.messageId, r.proposals);
  return latest;
}

// ---- scoring ----

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
const EXAMPLES = 10;

export type WrongLink = {
  messageId: string;
  linked: string;
  /** The labelled editions, or why there is none. */
  expected: string[];
  reason: string | null;
};

/**
 * Scored per message, so observations never need aligning: the labelled
 * editions of a message against the editions its proposals link.
 */
export function scoreResolutions(
  labels: Annotation[],
  results: Map<string, Proposal[] | null>,
  partyName: (id: string) => string,
  options: { retrieval: boolean } = { retrieval: true },
) {
  const decisions: Record<string, number> = {};
  let answered = 0;
  let editions = 0;
  let retrieved = 0;
  let retrievedFirst = 0;
  let links = 0;
  let correct = 0;
  let wrongEdition = 0;
  let linkedNewEvent = 0;
  let linkedUnlabelled = 0;
  let abstainedOnKnown = 0;
  let newEventMessages = 0;
  let newEventDetected = 0;
  let newEventPredicted = 0;
  let newEventPredictedRight = 0;
  const wrong: WrongLink[] = [];

  for (const label of labels) {
    const proposals = results.get(label.messageId);
    if (!proposals) continue;
    answered++;
    const gold = new Set(
      label.observations.flatMap((o) =>
        o.event.resolution === "resolved" && o.event.partyId ? [o.event.partyId] : [],
      ),
    );
    const goldNew = label.observations.some((o) => o.event.resolution === "new_event");
    for (const p of proposals) decisions[p.decision] = (decisions[p.decision] ?? 0) + 1;

    const shortlisted = new Set(proposals.flatMap((p) => p.shortlist));
    const firsts = new Set(proposals.flatMap((p) => p.shortlist.slice(0, 1)));
    const linked = new Set(proposals.flatMap((p) => (p.partyId ? [p.partyId] : [])));
    editions += gold.size;
    for (const id of gold) {
      if (shortlisted.has(id)) retrieved++;
      if (firsts.has(id)) retrievedFirst++;
    }
    const abstained = proposals.some((p) => p.decision === "abstain");
    for (const id of gold) if (!linked.has(id) && abstained) abstainedOnKnown++;

    for (const id of linked) {
      links++;
      if (gold.has(id)) {
        correct++;
        continue;
      }
      if (gold.size > 0) wrongEdition++;
      else if (goldNew) linkedNewEvent++;
      else linkedUnlabelled++;
      if (wrong.length < EXAMPLES) {
        wrong.push({
          messageId: label.messageId,
          linked: partyName(id),
          expected:
            gold.size > 0
              ? [...gold].map(partyName)
              : [goldNew ? "(a new event)" : "(no edition)"],
          reason: proposals.find((p) => p.partyId === id)?.reason ?? null,
        });
      }
    }

    const predictedNew = proposals.some((p) => p.decision === "new_event");
    if (goldNew) {
      newEventMessages++;
      if (predictedNew) newEventDetected++;
    }
    if (predictedNew) {
      newEventPredicted++;
      if (goldNew) newEventPredictedRight++;
    }
  }

  return {
    messages: labels.length,
    answered,
    decisions,
    retrieval: options.retrieval
      ? {
          editions,
          retrieved,
          recallAtShortlist: ratio(retrieved, editions),
          recallInterval: wilsonInterval(retrieved, editions),
          recallAtFirst: ratio(retrievedFirst, editions),
        }
      : null,
    links: {
      editions,
      links,
      correct,
      wrongEdition,
      linkedNewEvent,
      linkedUnlabelled,
      abstainedOnKnown,
      /** Of the links made, how many named a labelled edition. */
      precision: ratio(correct, links),
      precisionInterval: wilsonInterval(correct, links),
      /** Of the labelled editions, how many were linked. */
      coverage: ratio(correct, editions),
      coverageInterval: wilsonInterval(correct, editions),
    },
    newEvents: {
      messages: newEventMessages,
      detected: newEventDetected,
      recall: ratio(newEventDetected, newEventMessages),
      predicted: newEventPredicted,
      precision: ratio(newEventPredictedRight, newEventPredicted),
    },
    wrongLinks: wrong,
  };
}
