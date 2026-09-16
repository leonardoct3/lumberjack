import { normalizeText } from "@/domain/normalize";

/**
 * Duplicate detection for the catalog. Nothing here blocks an action: it only
 * tells the operator "a party like this already exists", because confirming a
 * second promo of the same festa is the main way duplicates get created.
 */

export type SimilarParty = {
  id: string;
  name: string;
  aliases: string[];
};

/** Words that carry no identity on their own and would match everything. */
const NOISE = new Set(["da", "de", "do", "das", "dos", "com", "the"]);

/** How much of the shorter name's identity has to overlap to count as similar. */
const SHARED_TOKEN_RATIO = 0.6;

function tokens(name: string): string[] {
  return normalizeText(name)
    .split(" ")
    .filter((token) => token.length > 2 && !NOISE.has(token));
}

/**
 * 3 for the same name, 2 when one name contains the other, 1 when they share
 * most of the shorter name's words, 0 when they are unrelated.
 */
export function nameAffinity(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 3;
  if (left.includes(right) || right.includes(left)) return 2;

  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const shortest = Math.min(leftTokens.length, rightTokens.length);
  if (shortest === 0) return 0;

  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  return shared / shortest >= SHARED_TOKEN_RATIO ? 1 : 0;
}

/** Best affinity between a loose name and everything a party answers to. */
export function partyAffinity(name: string, party: SimilarParty): number {
  return [party.name, ...party.aliases].reduce(
    (best, known) => Math.max(best, nameAffinity(name, known)),
    0,
  );
}

export function findSimilarParties<T extends SimilarParty>(
  name: string,
  parties: T[],
  options: { excludeId?: string } = {},
): T[] {
  return parties
    .filter((party) => party.id !== options.excludeId)
    .map((party) => ({ party, affinity: partyAffinity(name, party) }))
    .filter((entry) => entry.affinity > 0)
    .sort((a, b) => b.affinity - a.affinity)
    .map((entry) => entry.party);
}
