import { normalizeText } from "./normalize";

export type SenderRole = "admin" | "pista" | "unknown";
export type MessageClass =
  | "admin_promo"
  | "pista_oferta"
  | "pista_procura"
  | "ruido";

const TICKET_HOSTS = ["sympla.com", "gandaya.com", "blacktag", "ingresse.com"];
const SHORTENERS = ["bit.ly", "tinyurl.com"];
const LOT = ["lote", "primeiro lote", "1o lote", "2o lote", "camarote"];

/**
 * What the message is about. Weak markers only count next to one of these,
 * because "quero" and "pago" show up in plain conversation all day. Exported so
 * the Inbox can ask the database for undecided messages that mention a ticket.
 */
export const TICKET_NOUNS = [
  "pista",
  "ingresso",
  "camarote",
  "entrada",
  "vip",
  "combo",
  "convite",
  "pulseira",
  "bilhete",
  "lote",
  "open bar",
] as const;

const TICKET_NOUN = new RegExp(`\\b(${TICKET_NOUNS.join("|")})s?\\b`);

/** "preciso de 2 pra hoje" names no ticket, but the count says what it is about. */
const SMALL_COUNT = /\b[1-6]\b/;

function aboutTickets(text: string): boolean {
  return TICKET_NOUN.test(text) || SMALL_COUNT.test(text);
}

/** Unambiguous on their own: the verb already carries the direction. */
const DEMAND_STRONG = [
  /\bcompr(o|amos|ar|arei|aria)\b/,
  /\bprocur(o|a|as|ando|amos)\b/,
  /\bquero\s+compr/,
  // "quem vende", "alguem ta vendendo", "quem tem": asking, not selling.
  /\b(quem|alguem)\b[^?!.]*\bvend\w*/,
  /\b(quem|alguem)\s+(tem|com|tiver|teria)\b/,
  /\btem\s+alguem\b/,
  // "pago acima", "pago 250": only a buyer talks about paying over the table.
  /\bpag(o|amos)\s+(acima|mais|bem|qualquer|ate|\d)/,
];

/** Need a ticket noun in the message to count. */
const DEMAND_WEAK = [
  /\bprecis(o|amos|ando)\b/,
  /\bquer(o|ia|emos)\b/,
  /\bbusc(o|ando)\b/,
  /\bpag(o|ando)\b/,
  /\binteress(e|ado|ada|ados)\b/,
  /\baceito\b/,
];

const OFFER_STRONG = [
  /\bvend(o|endo|emos)\b/,
  /\breven(do|da|dendo)\b/,
  /\brepass(o|ando)\b/,
  /\btransfir(o|amos)\b/,
  /\btransferindo\b/,
  /\btenho\s+extra/,
  /\ba\s+venda\b/,
  /\b(pra|para)\s+vender\b/,
  // Group jargon: "saida onix hoje" is a spot leaving someone's hands.
  /\bsaida\b/,
];

const OFFER_WEAK = [
  /\bpasso\b/,
  /\bsobr(a|ou|ando)\b/,
  /\bdisponive(l|is)\b/,
  /\brest(a|am|ou)\b/,
  /\bultim(a|as)\b/,
  /\btenho\b/,
];

function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

function matches(hay: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(hay));
}

/**
 * Strong markers are read before weak ones on purpose: "vendo 2 pista, alguem
 * interessado?" is a seller, even though it ends with a demand word.
 */
function pistaClass(text: string): MessageClass {
  if (matches(text, DEMAND_STRONG)) return "pista_procura";
  if (matches(text, OFFER_STRONG)) return "pista_oferta";

  if (aboutTickets(text)) {
    if (matches(text, DEMAND_WEAK)) return "pista_procura";
    if (matches(text, OFFER_WEAK)) return "pista_oferta";
  }

  return "ruido";
}

export function classifyMessage(input: {
  text: string;
  senderRole: SenderRole;
}): MessageClass {
  const n = normalizeText(input.text);

  if (input.senderRole === "admin") {
    const hasPromo =
      hasAny(n, TICKET_HOSTS) || hasAny(n, SHORTENERS) || hasAny(n, LOT);
    return hasPromo ? "admin_promo" : "ruido";
  }

  return pistaClass(n);
}
