import type { PrismaClient, ReviewAction, SuggestionKind } from "@prisma/client";
import { loadSuggestions } from "@/features/inbox/suggestions";

/**
 * Records what the operator did beside what the Inbox suggested at that moment.
 * The suggestion is read here, on the server, so a record never trusts the browser.
 */
export async function recordReviews(
  db: PrismaClient,
  input: { messageIds: string[]; action: ReviewAction; chosenPartyId?: string | null },
  now: Date,
): Promise<void> {
  if (input.messageIds.length === 0) return;
  const suggestions = await loadSuggestions(db, input.messageIds);
  await db.proposalReview.createMany({
    data: input.messageIds.map((messageId) => {
      const suggestion = suggestions.get(messageId);
      return {
        messageId,
        action: input.action,
        chosenPartyId: input.chosenPartyId ?? null,
        suggestion: suggestion?.kind ?? null,
        suggestedPartyId: suggestion?.kind === "link" ? suggestion.party.id : null,
        runId: suggestion?.runId ?? null,
        createdAt: now,
      };
    }),
  });
}

/**
 * Takes back one bulk link: only the signals those messages carry to that festa,
 * so a message linked elsewhere since then is left alone.
 */
export async function undoLinks(
  db: PrismaClient,
  input: { partyId: string; messageIds: string[] },
): Promise<string[]> {
  return db.$transaction(async (tx) => {
    const signals = await tx.signal.findMany({
      where: { partyId: input.partyId, messageId: { in: input.messageIds } },
      select: { id: true, messageId: true },
    });
    if (signals.length === 0) return [];
    const messageIds = signals.map((s) => s.messageId);
    await tx.signal.deleteMany({ where: { id: { in: signals.map((s) => s.id) } } });
    await tx.message.updateMany({
      where: { id: { in: messageIds }, partyId: input.partyId },
      data: { partyId: null },
    });
    return messageIds;
  });
}

export type ReviewCounts = {
  /** Operator actions by what was suggested; `none` is a message with no resolve run yet. */
  bySuggestion: Record<SuggestionKind | "none", Partial<Record<ReviewAction, number>>>;
  /** Link suggestions the operator linked to the suggested festa. */
  linkAccepted: number;
};

export async function reviewCounts(db: PrismaClient): Promise<ReviewCounts> {
  const [grouped, accepted] = await Promise.all([
    db.proposalReview.groupBy({
      by: ["suggestion", "action"],
      _count: { _all: true },
    }),
    db.proposalReview.count({
      where: {
        suggestion: "link",
        action: "linked",
        chosenPartyId: { equals: db.proposalReview.fields.suggestedPartyId },
      },
    }),
  ]);
  const bySuggestion: ReviewCounts["bySuggestion"] = {
    link: {},
    new_event: {},
    doubt: {},
    none: {},
  };
  for (const row of grouped) {
    bySuggestion[row.suggestion ?? "none"][row.action] = row._count._all;
  }
  return { bySuggestion, linkAccepted: accepted };
}
