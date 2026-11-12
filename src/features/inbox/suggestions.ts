import type { PrismaClient, ResolutionDecision } from "@prisma/client";

export type Span = { start: number; end: number; text: string };
export type PartyOption = { id: string; name: string };

/** A proposal as stored, with the observation it is about. */
export type ProposalRow = {
  decision: ResolutionDecision;
  partyId: string | null;
  /** `[{ partyId, score, reasons }]`, best first, as retrieval offered them. */
  candidates: unknown;
  reason: string | null;
  observation: {
    position: number;
    eventMention: string | null;
    eventYear: number | null;
    eventMonth: number | null;
    eventDay: number | null;
    spans: unknown;
  };
};

export type Suggestion =
  | { kind: "link"; runId: string; party: PartyOption; spans: Span[] }
  | {
      kind: "new_event";
      runId: string;
      name: string;
      /** `YYYY-MM-DDTHH:mm`, only when the interpreter read day, month and year. */
      eventAtLocal: string | null;
      spans: Span[];
    }
  | {
      kind: "doubt";
      runId: string;
      options: PartyOption[];
      reasons: string[];
      spans: Span[];
    };

export type Cluster = { party: PartyOption; memberIds: string[]; weight: number };

/** Abstentions offer at most this many shortlisted festas, best first. */
const DOUBT_OPTIONS_PER_PROPOSAL = 3;

function parseSpans(raw: unknown): Span[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is Span =>
      typeof s === "object" &&
      s !== null &&
      Number.isInteger((s as Span).start) &&
      Number.isInteger((s as Span).end) &&
      typeof (s as Span).text === "string",
  );
}

function shortlistIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) =>
      typeof c === "object" && c !== null ? (c as { partyId?: unknown }).partyId : null,
    )
    .filter((id): id is string => typeof id === "string");
}

function observedDate(row: ProposalRow): string | null {
  const { eventYear: y, eventMonth: m, eventDay: d } = row.observation;
  if (y == null || m == null || d == null) return null;
  // Midnight in São Paulo, the same default the rule extractor gives a bare date.
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00`;
}

/**
 * What the Inbox suggests for one message, from the proposals of its accepted
 * resolve run. `upcoming` maps the festas that can still be linked to their names;
 * a proposal pointing anywhere else is dropped, never shown.
 */
export function suggestionFrom(
  rows: ProposalRow[],
  upcoming: Map<string, string>,
  runId: string,
): Suggestion | null {
  const ordered = [...rows].sort(
    (a, b) => a.observation.position - b.observation.position,
  );
  const links = ordered.filter(
    (r) => r.decision === "link" && r.partyId != null && upcoming.has(r.partyId),
  );
  const newEvents = ordered.filter((r) => r.decision === "new_event");
  const abstentions = ordered.filter((r) => r.decision === "abstain");
  const considered = [...links, ...newEvents, ...abstentions];
  if (considered.length === 0) return null;

  const spans = ordered
    .filter((r) => considered.includes(r))
    .flatMap((r) => parseSpans(r.observation.spans));
  const linked = [...new Set(links.map((r) => r.partyId!))];
  const option = (id: string): PartyOption => ({ id, name: upcoming.get(id)! });

  if (newEvents.length === 0 && abstentions.length === 0 && linked.length === 1) {
    return { kind: "link", runId, party: option(linked[0]), spans };
  }
  if (links.length === 0 && abstentions.length === 0) {
    const name = newEvents.map((r) => r.observation.eventMention?.trim()).find(Boolean);
    const eventAtLocal = newEvents.map(observedDate).find((d) => d != null) ?? null;
    return { kind: "new_event", runId, name: name ?? "", eventAtLocal, spans };
  }

  const shortlisted = abstentions.flatMap((r) =>
    shortlistIds(r.candidates)
      .filter((id) => upcoming.has(id))
      .slice(0, DOUBT_OPTIONS_PER_PROPOSAL),
  );
  const reasons = [
    ...new Set(considered.map((r) => r.reason?.trim()).filter((r): r is string => !!r)),
  ];
  return {
    kind: "doubt",
    runId,
    options: [...new Set([...linked, ...shortlisted])].map(option),
    reasons,
    spans,
  };
}

/**
 * Orphans the resolver would link, grouped by festa. A wrong cluster spreads one
 * mistake over every member, so the heaviest clusters come first: those are the
 * ones worth the operator's attention.
 */
export function clusterSuggestions(
  orphans: { id: string; groupReach: number; suggestion: Suggestion | null }[],
): Cluster[] {
  const byParty = new Map<string, Cluster>();
  for (const orphan of orphans) {
    if (orphan.suggestion?.kind !== "link") continue;
    const { party } = orphan.suggestion;
    const cluster = byParty.get(party.id) ?? { party, memberIds: [], weight: 0 };
    cluster.memberIds.push(orphan.id);
    cluster.weight += orphan.groupReach;
    byParty.set(party.id, cluster);
  }
  return [...byParty.values()].sort(
    (a, b) =>
      b.weight - a.weight ||
      b.memberIds.length - a.memberIds.length ||
      a.party.name.localeCompare(b.party.name, "pt-BR"),
  );
}

/**
 * The message cut into plain and evidence pieces. A span whose offsets do not
 * quote the text exactly is skipped rather than trusted.
 */
export function highlight(
  text: string,
  spans: Span[],
): { text: string; mark: boolean }[] {
  const valid = spans
    .filter(
      (s) =>
        s.start >= 0 &&
        s.end <= text.length &&
        s.start < s.end &&
        text.slice(s.start, s.end) === s.text,
    )
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const span of valid) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ start: span.start, end: span.end });
  }

  const pieces: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const span of merged) {
    if (span.start > at) pieces.push({ text: text.slice(at, span.start), mark: false });
    pieces.push({ text: text.slice(span.start, span.end), mark: true });
    at = span.end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), mark: false });
  return pieces;
}

/**
 * The current suggestion of each message: the proposals of the run accepted by
 * its most recently completed resolve job. Messages without one are absent.
 */
export async function loadSuggestions(
  db: PrismaClient,
  messageIds: string[],
): Promise<Map<string, Suggestion>> {
  const suggestions = new Map<string, Suggestion>();
  if (messageIds.length === 0) return suggestions;

  const jobs = await db.processingJob.findMany({
    where: {
      stage: "resolve",
      status: "succeeded",
      messageId: { in: messageIds },
      resultRunId: { not: null },
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: { messageId: true, resultRunId: true },
  });
  const runOf = new Map<string, string>();
  for (const job of jobs) {
    if (!runOf.has(job.messageId)) runOf.set(job.messageId, job.resultRunId!);
  }
  if (runOf.size === 0) return suggestions;

  const proposals = await db.resolutionProposal.findMany({
    where: { runId: { in: [...new Set(runOf.values())] } },
    select: {
      runId: true,
      decision: true,
      partyId: true,
      candidates: true,
      reason: true,
      observation: {
        select: {
          position: true,
          eventMention: true,
          eventYear: true,
          eventMonth: true,
          eventDay: true,
          spans: true,
        },
      },
    },
  });
  const byRun = new Map<string, ProposalRow[]>();
  for (const { runId, ...row } of proposals) {
    byRun.set(runId, [...(byRun.get(runId) ?? []), row]);
  }

  const partyIds = new Set(
    proposals.flatMap((p) => [
      ...(p.partyId ? [p.partyId] : []),
      ...shortlistIds(p.candidates),
    ]),
  );
  const parties = await db.party.findMany({
    where: { id: { in: [...partyIds] }, status: "upcoming" },
    select: { id: true, name: true },
  });
  const upcoming = new Map(parties.map((p) => [p.id, p.name]));

  for (const [messageId, runId] of runOf) {
    const suggestion = suggestionFrom(byRun.get(runId) ?? [], upcoming, runId);
    if (suggestion) suggestions.set(messageId, suggestion);
  }
  return suggestions;
}
