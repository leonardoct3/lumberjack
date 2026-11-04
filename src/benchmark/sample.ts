import { createHmac } from "node:crypto";
import { normalizeText } from "@/domain/normalize";
import type { ExportedMessage } from "./export";

export const SAMPLER_VERSION = 1;

/**
 * One intent and every copy of it. Duplicate detection is judged on families,
 * and a family never sits on both sides of a split.
 */
export type Family = {
  id: string;
  /** The message a labeller reads: the canonical one, or its first copy inside the interval. */
  representative: ExportedMessage;
  members: string[];
  firstSentAt: string;
  lastSentAt: string;
};

export function buildFamilies(messages: ExportedMessage[]): Family[] {
  const byRoot = new Map<string, ExportedMessage[]>();
  for (const message of messages) {
    const root = message.duplicateOf ?? message.id;
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(message);
  }

  const families: Family[] = [];
  for (const [root, members] of byRoot) {
    members.sort(
      (a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id),
    );
    const canonical = members.find((m) => m.id === root);
    const representative = canonical?.inInterval
      ? canonical
      : members.find((m) => m.inInterval);
    if (!representative) continue;
    families.push({
      id: root,
      representative,
      members: members.map((m) => m.id),
      firstSentAt: members[0].sentAt,
      lastSentAt: members[members.length - 1].sentAt,
    });
  }

  return families.sort(
    (a, b) =>
      a.representative.sentAt.localeCompare(b.representative.sentAt) ||
      a.id.localeCompare(b.id),
  );
}

export type ChallengeContext = {
  candidateCount: number;
  parties: { id: string; name: string; aliases: string[] }[];
};

const RELATIVE_DATE =
  /\b(hoje|amanha|ontem|fds|fim de semana|semana que vem|proxim[ao]|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/;
const OFFER_WORD = /\b(vend\w*|repass\w*|passo)\b/;
const DEMAND_WORD = /\b(compr\w*|procur\w*|busco)\b/;
const SWAP_WORD = /\btroc(o|a|ar)\b/;
const CORRECTION =
  /\b(corrig\w*|correcao|errata|na verdade|atualiz\w*|baixei|abaixei|baixou|novo valor|novo preco|agora por)\b/;
const WITHDRAWAL =
  /\b(vendid[oa]s?|ja foi|ja foram|nao tenho mais|esgotad[oa]s?|consegui|encerrad[oa]s?)\b/;
const PRICE = /r\$\s?\d/g;
const DAY_MONTH = /(?<![\d$.,])(\d{1,2})[./-](\d{1,2})(?!\d)(?![./-]\d)/g;
const CATEGORIES = [
  "pista",
  "camarote",
  "vip",
  "open bar",
  "backstage",
  "frontstage",
  "meia",
  "inteira",
  "lounge",
  "mesa",
];
/** Heuristic: the group shorthand that rules keyed on full words tend to miss. */
const SLANG = /\b(saida|pvt|ingr|ings|role|bora|cola|tmj|vlw)\b/;

function mentions(text: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(text);
}

/**
 * Cheap, explainable reasons a message is hard for the current rules. They only
 * choose what gets labelled; nothing downstream treats them as ground truth.
 */
export function challengeTags(family: Family, context: ChallengeContext): string[] {
  const message = family.representative;
  const text = normalizeText(message.text);
  const tags = new Set<string>();

  if (message.storedClass?.startsWith("pista_") && message.partyId == null)
    tags.add("orphan");
  if (family.members.length > 1) tags.add("cross_post");
  if (message.senderMutedNow) tags.add("muted_sender");
  if (context.candidateCount > 1) tags.add("multi_candidate");

  const namesMentioned = new Set<string>();
  const partiesByNeedle = new Map<string, Set<string>>();
  for (const party of context.parties) {
    for (const needle of [party.name, ...party.aliases].map(normalizeText)) {
      if (!mentions(text, needle)) continue;
      namesMentioned.add(normalizeText(party.name));
      if (!partiesByNeedle.has(needle)) partiesByNeedle.set(needle, new Set());
      partiesByNeedle.get(needle)!.add(party.id);
    }
  }
  if (namesMentioned.size > 1) tags.add("multi_event");
  if ([...partiesByNeedle.values()].some((ids) => ids.size > 1))
    tags.add("same_name_editions");

  if (RELATIVE_DATE.test(text)) tags.add("relative_date");
  if ((OFFER_WORD.test(text) && DEMAND_WORD.test(text)) || SWAP_WORD.test(text)) {
    tags.add("mixed_intent");
  }
  if (CORRECTION.test(text)) tags.add("correction_or_update");
  if (WITHDRAWAL.test(text)) tags.add("withdrawal_claim");
  if ((text.match(PRICE)?.length ?? 0) > 1) tags.add("multiple_prices");

  for (const match of text.matchAll(DAY_MONTH)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      tags.add("date_without_year");
      break;
    }
  }
  if (CATEGORIES.filter((category) => mentions(text, category)).length > 1)
    tags.add("category_mix");
  if (SLANG.test(text)) tags.add("slang");

  return [...tags].sort();
}

export type SampleItem = {
  familyId: string;
  messageId: string;
  members: string[];
  set: "random" | "challenge";
  /** The tag that earned a challenge item its place; null for the random set. */
  selectedBy: string | null;
  tags: string[];
  /** Known for the random set only; the challenge set is oversampled on purpose. */
  inclusionProbability: number | null;
};

export type TagStats = {
  population: number;
  inRandom: number;
  alreadySelected: number;
  eligible: number;
  selected: number;
};

export type SampleDraw = { items: SampleItem[]; tagStats: Record<string, TagStats> };

export function drawSample(
  families: Family[],
  options: {
    seed: string;
    randomSize: number;
    perTag: number;
    tagsOf: (family: Family) => string[];
  },
): SampleDraw {
  const rank = (key: string) =>
    createHmac("sha256", options.seed).update(key).digest("hex");
  const tagsByFamily = new Map(families.map((f) => [f.id, options.tagsOf(f)]));
  const item = (
    family: Family,
    set: SampleItem["set"],
    selectedBy: string | null,
    inclusionProbability: number | null,
  ): SampleItem => ({
    familyId: family.id,
    messageId: family.representative.id,
    members: family.members,
    set,
    selectedBy,
    tags: tagsByFamily.get(family.id)!,
    inclusionProbability,
  });

  const byRank = [...families].sort((a, b) => rank(a.id).localeCompare(rank(b.id)));
  const randomCount = Math.min(options.randomSize, families.length);
  const probability =
    families.length === 0 ? 0 : Math.min(1, options.randomSize / families.length);
  const random = byRank.slice(0, randomCount);
  const inRandom = new Set(random.map((f) => f.id));

  const items = random.map((f) => item(f, "random", null, probability));
  const chosen = new Set<string>();
  const tagStats: Record<string, TagStats> = {};
  const allTags = [...new Set([...tagsByFamily.values()].flat())].sort();

  for (const tag of allTags) {
    const population = families.filter((f) => tagsByFamily.get(f.id)!.includes(tag));
    const eligible = population
      .filter((f) => !inRandom.has(f.id) && !chosen.has(f.id))
      .sort((a, b) =>
        rank(`${tag}\u0000${a.id}`).localeCompare(rank(`${tag}\u0000${b.id}`)),
      );
    const picked = eligible.slice(0, options.perTag);
    for (const family of picked) {
      chosen.add(family.id);
      items.push(item(family, "challenge", tag, null));
    }
    tagStats[tag] = {
      population: population.length,
      inRandom: population.filter((f) => inRandom.has(f.id)).length,
      alreadySelected:
        population.filter((f) => !inRandom.has(f.id)).length - eligible.length,
      eligible: eligible.length,
      selected: picked.length,
    };
  }

  return { items, tagStats };
}

export type Split = "development" | "calibration" | "test";

export type SplitAssignment = {
  familyId: string;
  split: Split;
  /** Why a family is kept out of evaluation; it is still labelled and disclosed. */
  excluded: "boundary_family" | "template_leak" | null;
};

/** Below this, a "template" is just a common short reply like "eu quero". */
const MIN_TEMPLATE_LENGTH = 12;

function templateKey(text: string): string {
  return normalizeText(text).replace(/[^\p{L}]+/gu, "");
}

/**
 * Earlier data develops, a separate period calibrates thresholds, the latest is
 * held out. A family that straddles a boundary, or a template already seen in
 * an earlier split, would leak the answer into evaluation, so it is set aside.
 */
export function assignSplits(
  families: Family[],
  bounds: { calibrationFrom: Date; testFrom: Date },
): SplitAssignment[] {
  const splitOf = (sentAt: string): Split => {
    const at = new Date(sentAt);
    if (at >= bounds.testFrom) return "test";
    if (at >= bounds.calibrationFrom) return "calibration";
    return "development";
  };
  const order: Split[] = ["development", "calibration", "test"];
  const firstSplitOfTemplate = new Map<string, Split>();

  const chronological = [...families].sort(
    (a, b) => a.firstSentAt.localeCompare(b.firstSentAt) || a.id.localeCompare(b.id),
  );
  const result = new Map<string, SplitAssignment>();
  for (const family of chronological) {
    const split = splitOf(family.firstSentAt);
    let excluded: SplitAssignment["excluded"] = null;
    if (splitOf(family.lastSentAt) !== split) excluded = "boundary_family";

    const key = templateKey(family.representative.text);
    if (key.length >= MIN_TEMPLATE_LENGTH) {
      const first = firstSplitOfTemplate.get(key);
      if (first == null) firstSplitOfTemplate.set(key, split);
      else if (order.indexOf(first) < order.indexOf(split))
        excluded ??= "template_leak";
    }
    result.set(family.id, { familyId: family.id, split, excluded });
  }

  return families.map((family) => result.get(family.id)!);
}
