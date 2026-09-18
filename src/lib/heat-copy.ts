import type { HeatVerdict, Trend } from "@/domain/heat";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function clock(days: number | null): string | null {
  if (days == null) return null;
  if (days < 0) return "já passou";
  if (days === 0) return "é hoje";
  if (days === 1) return "falta 1 dia";
  return `faltam ${days} dias`;
}

/**
 * The row in words, because a bare ratio never told the operator what to do.
 * Reads the way the decision is actually made: how many people want in, how
 * many are letting go, and how long there is left to act.
 */
export function readHeat(input: {
  buyers: number;
  sellers: number;
  days: number | null;
}): string {
  const parts = [
    plural(input.buyers, "procurando", "procurando"),
    plural(input.sellers, "vendendo", "vendendo"),
  ];
  const left = clock(input.days);
  if (left) parts.push(left);
  return parts.join(", ");
}

export const VERDICT_LABEL: Record<HeatVerdict, string> = {
  scarce: "escassez: mais procura que oferta",
  balanced: "equilíbrio entre procura e oferta",
  flooded: "oferta sobrando",
  unknown: "pouca gente para concluir",
};

export const TREND_LABEL: Record<Trend, string> = {
  up: "subindo",
  flat: "estável",
  down: "caindo",
};
