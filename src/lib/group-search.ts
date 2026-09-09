export type SearchableGroup = { id: string; name: string };

export const GROUP_SEARCH_LIMIT = 30;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function searchGroups<T extends SearchableGroup>(
  groups: T[],
  query: string,
  limit: number = GROUP_SEARCH_LIMIT,
): { matches: T[]; total: number } {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { matches: [], total: 0 };

  const hits = groups.filter((group) => {
    const name = normalize(group.name);
    return terms.every((term) => name.includes(term));
  });

  return { matches: hits.slice(0, limit), total: hits.length };
}

// WhatsApp lets several groups share a subject, so names alone cannot identify a pick.
export function duplicateNames(groups: SearchableGroup[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.name)) duplicates.add(group.name);
    seen.add(group.name);
  }
  return duplicates;
}

export function shortWaId(waId: string): string {
  return (waId.split("@")[0] ?? waId).slice(-4);
}
