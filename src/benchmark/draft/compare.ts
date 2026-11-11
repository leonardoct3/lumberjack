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
  date: (o) =>
    o.eventDate ? [o.eventDate.year, o.eventDate.month, o.eventDate.day] : null,
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
};

export type ReviewPlan = {
  drafters: [string, string];
  auditSize: number;
  review: ReviewEntry[];
  /** Agreed, outside the test split and not audited: these are trusted without review. */
  silver: string[];
  counts: Record<"usable" | "agreed" | "review" | "silver" | ReviewReason, number>;
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

  const review = [...entries.values()];
  const count = (reason: ReviewReason) =>
    review.filter((e) => e.reasons.includes(reason)).length;
  return {
    drafters: [a.id, b.id],
    auditSize: options.auditSize,
    review,
    silver,
    counts: {
      usable: usable.length,
      agreed: agreed.length,
      review: review.length,
      silver: silver.length,
      disagreement: count("disagreement"),
      missing_draft: count("missing_draft"),
      test: count("test"),
      audit: count("audit"),
    },
  };
}

/**
 * Silver error, estimated from the audit: how often the reviewer changed a
 * scored field of an agreement. Unreviewed audit items are not counted.
 */
export function auditReport(
  plan: ReviewPlan,
  draftA: Map<string, Annotation>,
  human: Map<string, Annotation>,
) {
  const audited = plan.review.filter((e) => e.reasons.includes("audit"));
  const reviewed = audited.filter((e) => human.get(e.messageId)?.source === "human");
  const changed = reviewed.filter(
    (e) =>
      compareAnnotations(draftA.get(e.messageId)!, human.get(e.messageId)!).length > 0,
  );
  const byField: Partial<Record<ComparedField, number>> = {};
  for (const e of changed) {
    for (const field of compareAnnotations(
      draftA.get(e.messageId)!,
      human.get(e.messageId)!,
    )) {
      byField[field] = (byField[field] ?? 0) + 1;
    }
  }
  return {
    audited: audited.length,
    reviewed: reviewed.length,
    changed: changed.length,
    errorRate: reviewed.length > 0 ? changed.length / reviewed.length : null,
    errorRateInterval: wilsonInterval(changed.length, reviewed.length),
    changedFields: byField,
  };
}
