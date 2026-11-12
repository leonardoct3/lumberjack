import type { SenderRole } from "@prisma/client";
import type { Interpreter, InterpretationRequest } from "@/pipeline/interpreter";
import {
  validateInterpretation,
  type InterpretedObservation,
} from "@/pipeline/observation";
import type { Annotation } from "./annotation";
import { scoreIntents, wilsonInterval } from "./baseline";
import type { LoadedExport } from "./dataset";
import { writtenDate } from "./draft/compare";
import { buildItemView, type ItemView, type LabelItem } from "./label/item";
import { runCalls, type CallRecord, type RunReport } from "./runner";

/** What production would have sent for this message, rebuilt from the export. */
export function requestFromView(view: ItemView): InterpretationRequest {
  return {
    text: view.text,
    sentAt: new Date(view.sentAt),
    senderRole: view.senderRole as SenderRole,
    context: view.context.map((c) => ({
      id: c.id,
      sentAt: new Date(c.sentAt),
      text: c.text,
      sameGroup: c.sameGroup,
      sameSender: c.sameSender,
    })),
    catalog: view.catalog.map((p) => ({
      id: p.id,
      name: p.name,
      aliases: p.aliases,
      status: "upcoming",
      eventAt: new Date(p.eventAt),
    })),
  };
}

export type InterpretationRecord = CallRecord & {
  observations: InterpretedObservation[] | null;
};

export type InterpretationRunReport = RunReport & {
  interpreter: Pick<
    Interpreter,
    "name" | "version" | "provider" | "model" | "promptVersion"
  >;
};

/**
 * Runs an interpreter over the given items, appending one record per message
 * to `file` and skipping messages it already answered.
 */
export async function runInterpretations(options: {
  data: LoadedExport;
  items: LabelItem[];
  interpreter: Interpreter;
  file: string;
  budgetUsd: number;
  reserveUsd: (request: InterpretationRequest) => number;
  concurrency?: number;
  limit?: number;
  timeoutMs?: number;
  retries?: number;
  log?: (line: string) => void;
}): Promise<InterpretationRunReport> {
  const { interpreter } = options;
  const run = await runCalls({
    ...options,
    name: interpreter.name,
    paid: interpreter.paid,
    emptyPayload: { observations: null },
    prepare(item) {
      const request = requestFromView(buildItemView(options.data, item));
      return {
        reserveUsd: options.reserveUsd(request),
        invoke: (signal) => interpreter.interpret(request, signal),
        check(output) {
          const checked = validateInterpretation(output, request);
          return {
            ok: checked.observations != null,
            payload: { observations: checked.observations },
            errors: checked.errors,
          };
        },
      };
    },
  });
  return {
    interpreter: {
      name: interpreter.name,
      version: interpreter.version,
      provider: interpreter.provider,
      model: interpreter.model,
      promptVersion: interpreter.promptVersion,
    },
    ...run,
  };
}

// ---- scoring ----

const FIELDS = [
  "mention",
  "category",
  "quantity",
  "price",
  "date",
  "relationship",
] as const;
type Field = (typeof FIELDS)[number];

type Comparable = Record<Field, unknown> & { intent: string };

const normalizeName = (value: string | null) =>
  value == null
    ? null
    : value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim() || null;

function fromGold(o: Annotation["observations"][number]): Comparable {
  return {
    intent: o.intent,
    mention: normalizeName(o.event.mention),
    category: o.ticketCategory?.trim().toLowerCase() || null,
    quantity: o.quantity,
    price: o.price ? [o.price.amount, o.price.currency, o.price.meaning] : null,
    date: writtenDate(o.eventDate),
    relationship: o.relationship.kind,
  };
}

function fromInterpretation(o: InterpretedObservation): Comparable {
  return {
    intent: o.intent,
    mention: normalizeName(o.eventMention),
    category: o.ticketCategory?.trim().toLowerCase() || null,
    quantity: o.quantity,
    price: o.price ? [o.price.amount, o.price.currency, o.price.meaning] : null,
    date: writtenDate(o.eventDate),
    relationship: o.relationship.kind,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** "baile da syon" written as "syon" is the same mention; the resolver links either. */
const sameMention = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string"
    ? a === b || a.includes(b) || b.includes(a)
    : a === b;
const equal = (field: Field, a: unknown, b: unknown) =>
  field === "mention" ? sameMention(a, b) : same(a, b);
const absent = (field: Field, value: unknown) =>
  field === "relationship" ? value === "none" : value == null;

/** Gold observations matched to predicted ones of the same intent, mention first. */
function align(gold: Comparable[], predicted: Comparable[]) {
  const unused = [...predicted];
  const pairs: [Comparable, Comparable][] = [];
  for (const g of gold) {
    const candidates = unused.filter((p) => p.intent === g.intent);
    const pick =
      candidates.find((p) => sameMention(p.mention, g.mention)) ?? candidates[0];
    if (!pick) continue;
    unused.splice(unused.indexOf(pick), 1);
    pairs.push([g, pick]);
  }
  return pairs;
}

export type FieldScore = {
  pairs: number;
  /** Gold has a value: how often the interpreter got that value. */
  goldPresent: number;
  recovered: number;
  recovery: number | null;
  recoveryInterval: [number, number] | null;
  /** Gold has none: how often the interpreter made one up anyway. */
  goldAbsent: number;
  invented: number;
  inventionRate: number | null;
  examples: { messageId: string; gold: unknown; predicted: unknown }[];
};

const EXAMPLES = 8;

export function scoreInterpretations(
  labels: Annotation[],
  results: Map<string, InterpretedObservation[] | null>,
) {
  const intents = scoreIntents(
    labels,
    labels.map((l) => ({
      messageId: l.messageId,
      intents: (results.get(l.messageId) ?? []).map((o) => o.intent),
    })),
  );
  const fields = Object.fromEntries(
    FIELDS.map((f) => [
      f,
      {
        pairs: 0,
        goldPresent: 0,
        recovered: 0,
        goldAbsent: 0,
        invented: 0,
        examples: [] as FieldScore["examples"],
      },
    ]),
  ) as Record<
    Field,
    Omit<FieldScore, "recovery" | "recoveryInterval" | "inventionRate">
  >;

  let answered = 0;
  let exactIntents = 0;
  for (const label of labels) {
    const predicted = results.get(label.messageId);
    if (predicted) answered++;
    const gold = label.observations
      .filter((o) => o.intent !== "unrelated")
      .map(fromGold);
    const mine = (predicted ?? [])
      .filter((o) => o.intent !== "unrelated")
      .map(fromInterpretation);
    const goldSet = new Set(label.observations.map((o) => o.intent));
    const mineSet = new Set((predicted ?? []).map((o) => o.intent));
    if (predicted && same([...goldSet].sort(), [...mineSet].sort())) exactIntents++;

    for (const [g, p] of align(gold, mine)) {
      for (const f of FIELDS) {
        const score = fields[f];
        score.pairs++;
        const ok = equal(f, g[f], p[f]);
        if (absent(f, g[f])) {
          score.goldAbsent++;
          if (!absent(f, p[f])) score.invented++;
        } else {
          score.goldPresent++;
          if (ok) score.recovered++;
        }
        if (!ok && score.examples.length < EXAMPLES) {
          score.examples.push({
            messageId: label.messageId,
            gold: g[f],
            predicted: p[f],
          });
        }
      }
    }
  }

  return {
    messages: labels.length,
    answered,
    exactIntents,
    exactIntentRate: labels.length ? exactIntents / labels.length : null,
    intents,
    fields: Object.fromEntries(
      FIELDS.map((f) => {
        const s = fields[f];
        return [
          f,
          {
            ...s,
            recovery: s.goldPresent ? s.recovered / s.goldPresent : null,
            recoveryInterval: wilsonInterval(s.recovered, s.goldPresent),
            inventionRate: s.goldAbsent ? s.invented / s.goldAbsent : null,
          } satisfies FieldScore,
        ];
      }),
    ) as Record<Field, FieldScore>,
  };
}

/** Latest answer per message; a failed call counts as answering nothing. */
export function latestResults(records: InterpretationRecord[]) {
  const latest = new Map<string, InterpretedObservation[] | null>();
  for (const r of records) latest.set(r.messageId, r.observations);
  return latest;
}
