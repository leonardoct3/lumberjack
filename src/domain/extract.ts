import { normalizeText } from "./normalize";
import { zonedParts } from "./timezone";

export type Platform =
  | "sympla"
  | "gandaya"
  | "blacktag"
  | "ingresse"
  | "other"
  | "unknown";

export type ExtractedCandidate = {
  name: string | null;
  url: string | null;
  lotLabel: string | null;
  officialPrice: number | null;
  eventAt: Date | null;
  platform: Platform;
};

const URL_RE = /https?:\/\/\S+/i;
const PRICE_RE = /r\$\s?(\d+(?:[.,]\d{2})?)/i;
const LOT_RE = /(\d+º?\s*lote|primeiro lote|camarote|pista vip)/i;
/**
 * Ads write the day as 27/12, 25.09 or 31-12. The lookbehind keeps thousands
 * separators out, so `R$1.120` is a price and not the 12th of January.
 */
const DATE_RE = /(?<![\d$])(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/g;

function platformFromUrl(url: string): Platform {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "other";
  }
  const n = normalizeText(host);
  if (n.includes("sympla.com")) return "sympla";
  if (n.includes("gandaya.com")) return "gandaya";
  if (n.includes("blacktag")) return "blacktag";
  if (n.includes("ingresse.com")) return "ingresse";
  return "other";
}

/** Promoters bold their sales pitch too, and it is never a festa's name. */
const BOLD_NOISE = [
  "cupom",
  "desconto",
  "sem taxa",
  "pix",
  "cartao",
  "link",
  "lote",
  "ingresso",
  "vendas",
  "lista",
  "atencao",
  "promo",
  "ultimos",
  "garanta",
  "vaga",
  "aberta",
];

function isNameLike(segment: string): boolean {
  const n = normalizeText(segment).replace(/[*_~:]/g, "").trim();
  // Dates, times and prices are digits with at most an "R$" hanging off them.
  if (n.replace(/[^a-z]/g, "").length < 3) return false;
  return !BOLD_NOISE.some((noise) => n.includes(noise));
}

/**
 * An ad names the festa in WhatsApp bold — "⚠️ *Araxás* 27/12 a 02/01 …" — which
 * beats the first line by a mile on these blasts. Falls back to the first line
 * for everything written by a person.
 */
function extractName(text: string): string | null {
  for (const match of text.matchAll(/\*([^*\n]{2,60})\*/g)) {
    const segment = match[1].trim();
    if (isNameLike(segment)) return segment.slice(0, 80);
  }

  // Every bold part was a pitch, so drop them: what is left reads better.
  const stripped = text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\*[^*\n]{2,60}\*/g, " ")
    .replace(/[^\S\r\n]+/g, " ");
  const line = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.slice(0, 80);
}

function extractEventAt(text: string, now: Date): Date | null {
  for (const m of text.matchAll(DATE_RE)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    // A number pair that cannot be a date is a price, a time or a lot count.
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;

    const year = m[3]
      ? m[3].length <= 2
        ? 2000 + Number(m[3])
        : Number(m[3])
      : zonedParts(now).year;

    return new Date(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T03:00:00Z`,
    );
  }
  return null;
}

export function extractCandidate(text: string, now: Date = new Date()): ExtractedCandidate {
  const urlMatch = text.match(URL_RE);
  const url = urlMatch ? urlMatch[0] : null;
  const platform = url ? platformFromUrl(url) : "unknown";

  const priceMatch = text.match(PRICE_RE);
  const officialPrice = priceMatch
    ? Number(priceMatch[1].replace(",", "."))
    : null;

  const lotMatch = text.match(LOT_RE);
  const lotLabel = lotMatch
    ? lotMatch[1].replace(/\s+/g, " ").trim()
    : null;

  return {
    name: extractName(text),
    url,
    lotLabel,
    officialPrice,
    eventAt: extractEventAt(text, now),
    platform,
  };
}
