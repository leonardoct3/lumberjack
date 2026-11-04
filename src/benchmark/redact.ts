import { TICKET_NOUNS } from "@/domain/classify";

export type RedactionCounts = {
  email: number;
  phone: number;
  document: number;
  pixKey: number;
  number: number;
  urlParam: number;
  name: number;
};

export type RedactOptions = {
  /** Sender and group names seen in the export; any of their words is identifying. */
  knownNames?: string[];
  /** Event names and aliases: a promoter called after their festa keeps the festa. */
  protectedTerms?: string[];
};

/** Bumped whenever a rule changes, so a manifest says which rules its text went through. */
export const REDACTION_VERSION = 1;

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;
/** WhatsApp bold and closing brackets cling to the end of a pasted link. */
const URL_TRAILER = /[)\]*_.,;:!?'"]+$/;
const WHATSAPP_HOSTS = new Set(["wa.me", "api.whatsapp.com", "chat.whatsapp.com"]);
const TRACKING_PARAM =
  /^(utm_\w+|fbclid|gclid|_gl|igshid|igsh|si|mc_cid|mc_eid|ref|ref_src)$/i;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PIX_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const MENTION = /@\d{8,15}(?!\d)/g;
/**
 * A phone needs its area code or the mobile 9 plus a separator to count, so
 * `R$ 1.120,00`, `27/12/2026` and `2026-2027` never read as one.
 */
const PHONE_WITH_AREA =
  /(?<![\w$.,])(?:\+\s?)?(?:55[\s.-]?)?\(?[1-9]\d\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\w)/g;
const MOBILE = /(?<![\w$.,])9\d{4}[\s-]?\d{4}(?!\w)/g;
const LONG_NUMBER = /(?<![\w$.,])\d{11,}(?!\w)/g;

/** Words of this market: a push name like "Vendo Ingressos" must not erase them. */
const DOMAIN_TERMS = [
  ...TICKET_NOUNS,
  "vendo",
  "compro",
  "festa",
  "festas",
  "evento",
  "eventos",
  "ingressos",
  "ticket",
  "tickets",
  "promo",
  "agenda",
  "oficial",
  "produtora",
  "grupo",
];

const MIN_NAME_TOKEN = 4;

function emptyCounts(): RedactionCounts {
  return {
    email: 0,
    phone: 0,
    document: 0,
    pixKey: 0,
    number: 0,
    urlParam: 0,
    name: 0,
  };
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function splitOnce(text: string, separator: string): [string, string | null] {
  const at = text.indexOf(separator);
  return at < 0 ? [text, null] : [text.slice(0, at), text.slice(at + 1)];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function looksPersonal(value: string): boolean {
  return [EMAIL, PHONE_WITH_AREA, MOBILE, CPF, CNPJ, LONG_NUMBER].some((re) => {
    re.lastIndex = 0;
    const hit = re.test(value);
    re.lastIndex = 0;
    return hit;
  });
}

/**
 * Edition identity lives in the path and in the parameters a platform needs, so
 * only tracking and personal parameters go, and an untouched link is returned
 * byte for byte rather than re-serialised.
 */
function redactUrl(raw: string, counts: RedactionCounts): string {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return raw;
  }

  const [beforeHash, hash] = splitOnce(raw, "#");
  const [base, query] = splitOnce(beforeHash, "?");
  const pieces = query ? query.split("&").filter((piece) => piece.length > 0) : [];

  if (WHATSAPP_HOSTS.has(host)) {
    const path = base.replace(/\d{6,}/g, () => {
      counts.phone += 1;
      return "[PHONE]";
    });
    for (const piece of pieces) {
      const [name] = splitOnce(piece, "=");
      if (name.toLowerCase() === "phone") counts.phone += 1;
      else counts.urlParam += 1;
    }
    return path;
  }

  const kept = pieces.filter((piece) => {
    const [name, value] = splitOnce(piece, "=");
    const drop =
      TRACKING_PARAM.test(safeDecode(name)) || looksPersonal(safeDecode(value ?? ""));
    if (drop) counts.urlParam += 1;
    return !drop;
  });
  if (kept.length === pieces.length) return raw;

  const rebuilt = kept.length > 0 ? `${base}?${kept.join("&")}` : base;
  return hash == null ? rebuilt : `${rebuilt}#${hash}`;
}

function nameTokens(names: string[], protectedTerms: string[]): string[] {
  const shielded = new Set(
    [...protectedTerms, ...DOMAIN_TERMS].flatMap((term) =>
      fold(term).split(/[^\p{L}\p{N}]+/u),
    ),
  );
  const tokens = new Set(
    names
      .flatMap((name) => fold(name).split(/[^\p{L}\p{N}]+/u))
      .filter((token) => token.length >= MIN_NAME_TOKEN && !shielded.has(token)),
  );
  return [...tokens].sort((a, b) => b.length - a.length);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matching runs on a folded copy so "JÚLIA" and "julia" both hit, and every
 * folded character remembers where it came from so the original is cut.
 */
function redactNames(text: string, tokens: string[], counts: RedactionCounts): string {
  if (tokens.length === 0) return text;

  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i)!);
    const piece = fold(char);
    for (let k = 0; k < piece.length; k++) origin.push(i);
    folded += piece;
    i += char.length;
  }
  origin.push(text.length);

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${tokens.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "gu",
  );

  const ranges: [number, number][] = [];
  for (const match of folded.matchAll(pattern)) {
    const start = match.index;
    ranges.push([origin[start], origin[start + match[0].length]]);
  }

  let out = text;
  for (const [start, end] of ranges.reverse()) {
    out = `${out.slice(0, start)}[NAME]${out.slice(end)}`;
    counts.name += 1;
  }
  return out;
}

function redactProse(text: string, tokens: string[], counts: RedactionCounts): string {
  const swap =
    (re: RegExp, label: string, key: keyof RedactionCounts) => (input: string) =>
      input.replace(re, () => {
        counts[key] += 1;
        return label;
      });

  const steps = [
    swap(EMAIL, "[EMAIL]", "email"),
    swap(PIX_UUID, "[PIX_KEY]", "pixKey"),
    swap(CNPJ, "[DOCUMENT]", "document"),
    swap(CPF, "[DOCUMENT]", "document"),
    swap(MENTION, "@[PHONE]", "phone"),
    swap(PHONE_WITH_AREA, "[PHONE]", "phone"),
    swap(MOBILE, "[PHONE]", "phone"),
    swap(LONG_NUMBER, "[NUMBER]", "number"),
  ];
  const scrubbed = steps.reduce((acc, step) => step(acc), text);
  return redactNames(scrubbed, tokens, counts);
}

/**
 * Pseudonymised ids alone do not anonymise a message body: people paste their
 * phone, their PIX key and each other's names. Links are handled apart from the
 * prose so an event id in a path is never mistaken for a phone number.
 */
export function redactText(
  text: string,
  options: RedactOptions = {},
): { text: string; counts: RedactionCounts } {
  const counts = emptyCounts();
  const tokens = nameTokens(options.knownNames ?? [], options.protectedTerms ?? []);

  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(URL_RE)) {
    const trailer = match[0].match(URL_TRAILER)?.[0] ?? "";
    const raw = match[0].slice(0, match[0].length - trailer.length);
    out += redactProse(text.slice(cursor, match.index), tokens, counts);
    out += redactUrl(raw, counts) + trailer;
    cursor = match.index + match[0].length;
  }
  out += redactProse(text.slice(cursor), tokens, counts);

  return { text: out, counts };
}

export function addCounts(
  into: RedactionCounts,
  from: RedactionCounts,
): RedactionCounts {
  for (const key of Object.keys(into) as (keyof RedactionCounts)[])
    into[key] += from[key];
  return into;
}

export { emptyCounts as emptyRedactionCounts };
