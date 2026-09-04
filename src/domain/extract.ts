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
const DATE_RE = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;

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

function extractName(text: string): string | null {
  const stripped = text.replace(/https?:\/\/\S+/gi, "");
  const line = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.slice(0, 80);
}

function extractEventAt(text: string, now: Date): Date | null {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  let year: number;
  if (m[3]) {
    year = m[3].length <= 2 ? 2000 + Number(m[3]) : Number(m[3]);
  } else {
    year = zonedParts(now).year;
  }
  return new Date(`${year}-${month}-${day}T03:00:00Z`);
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
