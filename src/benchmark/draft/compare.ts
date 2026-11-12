import { createHmac } from "node:crypto";
import type { Annotation } from "../annotation";
import { wilsonInterval } from "../baseline";
import type { LabelItem } from "../label/item";

export const COMPARED_FIELDS = [
  "observations",
  "intent",
  "party",
  "resolution",
  "category",
  "quantity",
  "price",
  "date",
  "relationship",
] as const;

export type ComparedField = (typeof COMPARED_FIELDS)[number];

type Observation = Annotation["observations"][number];

export const COMPARE_VERSION = 2;

/**
 * Only what the message writes counts: an empty or "absent" date is no date, and an
 * inferred one is the linked event's date, which the party comparison already covers.
 */
export function writtenDate(date: Observation["eventDate"]) {
  if (!date || date.basis !== "explicit") return null;
  if (date.year == null && date.month == null && date.day == null) return null;
  return [date.year, date.month, date.day];
}

/**
 * What a benchmark scores, read off one observation. Spans, ambiguities and
 * notes are left out: two right answers can quote or explain differently.
 */
const readers: Record<
  Exclude<ComparedField, "observations">,
  (o: Observation) => unknown
> = {
  intent: (o) => o.intent,
  party: (o) => o.event.partyId,
  resolution: (o) => o.event.resolution,
  category: (o) => o.ticketCategory?.trim().toLowerCase() || null,
  quantity: (o) => o.quantity,
  price: (o) => (o.price ? [o.price.amount, o.price.currency, o.price.meaning] : null),
  date: (o) => writtenDate(o.eventDate),
  relationship: (o) => [o.relationship.kind, o.relationship.relatedMessage],
};

/** Observations come in no particular order, so each field is compared as a multiset. */
const values = (a: Annotation, read: (o: Observation) => unknown) =>
  a.observations.map((o) => JSON.stringify(read(o))).sort();

export function compareAnnotations(a: Annotation, b: Annotation): ComparedField[] {
  const differing: ComparedField[] = [];
  if (a.observations.length !== b.observations.length) differing.push("observations");
  for (const [field, read] of Object.entries(readers)) {
    if (JSON.stringify(values(a, read)) !== JSON.stringify(values(b, read))) {
      differing.push(field as ComparedField);
    }
  }
  return differing;
}

export type ReviewReason = "disagreement" | "missing_draft" | "test" | "audit";

export type ReviewEntry = {
  messageId: string;
  reasons: ReviewReason[];
  differing: ComparedField[];
  required?: boolean;
};

export type ReviewPlan = {
  compareVersion?: number;
  drafters: [string, string];
  auditSize: number;
  review: ReviewEntry[];
  /** Agreed, outside the test split and not audited: these are trusted without review. */
  silver: string[];
  counts: Record<
    "usable" | "agreed" | "review" | "required" | "silver" | ReviewReason,
    number
  >;
};

/**
 * A person reviews what the models disagree on, everything in the test split,
 * and a seeded random audit of agreements, which measures how wrong the
 * unreviewed agreements (silver) are likely to be.
 */
export function buildReviewPlan(options: {
  items: LabelItem[];
  drafts: [
    { id: string; byMessage: Map<string, Annotation> },
    { id: string; byMessage: Map<string, Annotation> },
  ];
  seed: string;
  auditSize: number;
}): ReviewPlan {
  const [a, b] = options.drafts;
  const usable = options.items.filter((i) => i.excluded == null);
  const entries = new Map<string, ReviewEntry>();
  const add = (
    messageId: string,
    reason: ReviewReason,
    differing: ComparedField[] = [],
  ) => {
    const entry = entries.get(messageId) ?? { messageId, reasons: [], differing };
    entry.reasons.push(reason);
    entries.set(messageId, entry);
  };

  const agreed: LabelItem[] = [];
  for (const item of usable) {
    const da = a.byMessage.get(item.messageId);
    const db = b.byMessage.get(item.messageId);
    const differing = da && db ? compareAnnotations(da, db) : [];
    if (!da || !db) add(item.messageId, "missing_draft");
    else if (differing.length > 0) add(item.messageId, "disagreement", differing);
    else agreed.push(item);
    if (item.split === "test") add(item.messageId, "test", differing);
  }

  const rank = (id: string) =>
    createHmac("sha256", `${options.seed}:audit`).update(id).digest("hex");
  const auditable = agreed
    .filter((i) => i.split !== "test")
    .sort((x, y) => rank(x.messageId).localeCompare(rank(y.messageId)));
  const audited = auditable.slice(0, options.auditSize);
  for (const item of audited) add(item.messageId, "audit");
  const auditedIds = new Set(audited.map((i) => i.messageId));
  const silver = auditable
    .filter((i) => !auditedIds.has(i.messageId))
    .map((i) => i.messageId);

  // Required first: the test split and the audit. A contested item outside the test
  // split is optional, and left out of silver whether or not anyone reviews it.
  const priority = (e: ReviewEntry) =>
    e.reasons.includes("test") ? 0 : e.reasons.includes("audit") ? 1 : 2;
  const review = [...entries.values()]
    .map((e) => ({ ...e, required: priority(e) < 2 }))
    .sort(
      (x, y) =>
        priority(x) - priority(y) || rank(x.messageId).localeCompare(rank(y.messageId)),
    );
  const count = (reason: ReviewReason) =>
    review.filter((e) => e.reasons.includes(reason)).length;
  return {
    compareVersion: COMPARE_VERSION,
    drafters: [a.id, b.id],
    auditSize: options.auditSize,
    review,
    silver,
    counts: {
      usable: usable.length,
      agreed: agreed.length,
      review: review.length,
      required: review.filter((e) => e.required).length,
      silver: silver.length,
      disagreement: count("disagreement"),
      missing_draft: count("missing_draft"),
      test: count("test"),
      audit: count("audit"),
    },
  };
}

/** Every usable item both drafts agree on, test split and audit included. */
export function agreedIds(plan: ReviewPlan): string[] {
  const contested = (e: ReviewEntry) =>
    e.reasons.includes("disagreement") || e.reasons.includes("missing_draft");
  return [
    ...plan.silver,
    ...plan.review.filter((e) => !contested(e)).map((e) => e.messageId),
  ];
}

export const auditIds = (plan: ReviewPlan) =>
  plan.review.filter((e) => e.reasons.includes("audit")).map((e) => e.messageId);

/**
 * Silver error: how often a person's label differs from an agreement on a
 * scored field, over the given agreed items that a person labelled.
 */
export function auditReport(
  ids: string[],
  draftA: Map<string, Annotation>,
  human: Map<string, Annotation>,
) {
  const reviewed = ids.filter((id) => human.get(id)?.source === "human");
  const byField: Partial<Record<ComparedField, number>> = {};
  let changed = 0;
  for (const id of reviewed) {
    const fields = compareAnnotations(draftA.get(id)!, human.get(id)!);
    if (fields.length > 0) changed += 1;
    for (const field of fields) byField[field] = (byField[field] ?? 0) + 1;
  }
  return {
    audited: ids.length,
    reviewed: reviewed.length,
    changed,
    errorRate: reviewed.length > 0 ? changed / reviewed.length : null,
    errorRateInterval: wilsonInterval(changed, reviewed.length),
    changedFields: byField,
  };
}
