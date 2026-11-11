import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { SenderRole } from "@prisma/client";
import {
  InterpreterError,
  type Interpreter,
  type InterpretationRequest,
} from "@/pipeline/interpreter";
import {
  validateInterpretation,
  type InterpretedObservation,
} from "@/pipeline/observation";
import type { Annotation } from "./annotation";
import { scoreIntents, wilsonInterval } from "./baseline";
import { readJsonl, type LoadedExport } from "./dataset";
import { writtenDate } from "./draft/compare";
import { buildItemView, type ItemView, type LabelItem } from "./label/item";

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

export type InterpretationRecord = {
  messageId: string;
  status: "ok" | "invalid" | "failed";
  observations: InterpretedObservation[] | null;
  errors: string[];
  failureKind: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  latencyMs: number;
  at: string;
};

export type InterpretationRunReport = {
  interpreter: Pick<
    Interpreter,
    "name" | "version" | "provider" | "model" | "promptVersion"
  >;
  file: string;
  budgetUsd: number;
  priorSpentUsd: number;
  spentUsd: number;
  stoppedForBudget: boolean;
  abortedBy: string | null;
  alreadyDone: number;
  attempted: number;
  byStatus: Record<string, number>;
  failures: Record<string, number>;
  latencyMs: { p50: number | null; p95: number | null };
};

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs an interpreter over the given items, appending one record per message
 * to `file` and skipping messages it already answered. Each paid call first
 * reserves `reserveUsd` of the budget, so the budget is never overshot.
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
  const { interpreter, file } = options;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const retries = options.retries ?? 2;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const previous = existsSync(file) ? readJsonl<InterpretationRecord>(file) : [];
  const done = new Set(
    previous.filter((r) => r.status !== "failed").map((r) => r.messageId),
  );
  const priorSpentUsd = previous.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  const todo = options.items
    .filter((i) => i.excluded == null && !done.has(i.messageId))
    .slice(0, options.limit ?? Infinity);
  let spent = priorSpentUsd;
  let reserved = 0;
  let stoppedForBudget = false;
  let abortedBy: string | null = null;
  const latencies: number[] = [];
  const byStatus: Record<string, number> = {};
  const failures: Record<string, number> = {};

  const write = (record: InterpretationRecord) => {
    appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    if (record.failureKind)
      failures[record.failureKind] = (failures[record.failureKind] ?? 0) + 1;
  };

  const once = async (request: InterpretationRequest) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await interpreter.interpret(request, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw new InterpreterError("timeout", "timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const one = async (item: LabelItem) => {
    const request = requestFromView(buildItemView(options.data, item));
    const reservation = interpreter.paid ? options.reserveUsd(request) : 0;
    if (spent + reserved + reservation > options.budgetUsd) {
      stoppedForBudget = true;
      return;
    }
    reserved += reservation;
    const started = performance.now();
    let cost = 0;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await once(request);
          cost += result.usage?.costUsd ?? 0;
          const checked = validateInterpretation(result.output, request);
          write({
            messageId: item.messageId,
            status: checked.observations ? "ok" : "invalid",
            observations: checked.observations,
            errors: checked.errors,
            failureKind: checked.observations ? null : "schema",
            inputTokens: result.usage?.inputTokens ?? null,
            outputTokens: result.usage?.outputTokens ?? null,
            costUsd: cost,
            latencyMs: Math.round(performance.now() - started),
            at: new Date().toISOString(),
          });
          break;
        } catch (error) {
          const kind = error instanceof InterpreterError ? error.kind : "internal";
          if (error instanceof InterpreterError) cost += error.usage?.costUsd ?? 0;
          const message = error instanceof Error ? error.message : String(error);
          const retry =
            (kind === "transient" || kind === "timeout") && attempt < retries;
          if (retry) {
            await sleep(2_000 * 2 ** attempt);
            continue;
          }
          write({
            messageId: item.messageId,
            status: "failed",
            observations: null,
            errors: [message.slice(0, 300)],
            failureKind: kind,
            inputTokens: null,
            outputTokens: null,
            costUsd: cost,
            latencyMs: Math.round(performance.now() - started),
            at: new Date().toISOString(),
          });
          if (kind === "internal") abortedBy = message.slice(0, 300);
          break;
        }
      }
    } finally {
      reserved -= reservation;
      spent += cost;
      latencies.push(Math.round(performance.now() - started));
    }
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    if (total % 10 === 0) {
      options.log?.(
        `${interpreter.name}: ${total}/${todo.length}, US$ ${spent.toFixed(2)}`,
      );
    }
  };

  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency ?? 4) }, async () => {
      while (queue.length > 0 && !abortedBy && !stoppedForBudget)
        await one(queue.shift()!);
    }),
  );

  return {
    interpreter: {
      name: interpreter.name,
      version: interpreter.version,
      provider: interpreter.provider,
      model: interpreter.model,
      promptVersion: interpreter.promptVersion,
    },
    file: path.basename(file),
    budgetUsd: options.budgetUsd,
    priorSpentUsd,
    spentUsd: spent,
    stoppedForBudget,
    abortedBy,
    alreadyDone: done.size,
    attempted: todo.length,
    byStatus,
    failures,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
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
