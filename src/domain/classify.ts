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
const DEMAND = ["procuro", "preciso", "quero comprar", "alguem tem", "alguem com"];
const OFFER = ["vendo", "tenho extra", "saida", "revendo"];

function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

export function classifyMessage(input: {
  text: string;
  senderRole: SenderRole;
}): MessageClass {
  const n = normalizeText(input.text);
  const hasPromo =
    hasAny(n, TICKET_HOSTS) || hasAny(n, SHORTENERS) || hasAny(n, LOT);

  if (input.senderRole === "admin") {
    return hasPromo ? "admin_promo" : "ruido";
  }
  if (hasAny(n, DEMAND)) return "pista_procura";
  if (hasAny(n, OFFER)) return "pista_oferta";
  return "ruido";
}
