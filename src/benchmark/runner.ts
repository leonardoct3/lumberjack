import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { InterpreterError, type InterpreterResult } from "@/pipeline/interpreter";
import { readJsonl } from "./dataset";
import type { LabelItem } from "./label/item";

/** One line per call; `payload` is what the stage keeps of a valid answer. */
export type CallRecord = {
  messageId: string;
  status: "ok" | "invalid" | "failed";
  errors: string[];
  failureKind: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  latencyMs: number;
  at: string;
};

export type RunReport = {
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

export type PreparedCall = {
  reserveUsd: number;
  invoke: (signal: AbortSignal) => Promise<InterpreterResult>;
  /** The fields a valid answer adds to its record, or the checks it failed. */
  check: (output: unknown) => {
    payload: Record<string, unknown>;
    errors: string[];
    ok: boolean;
  };
};

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls once per item, appending one record per message to `file` and
 * skipping messages it already answered. Each paid call first reserves its
 * share of the budget, so the budget is never overshot.
 */
export async function runCalls(options: {
  name: string;
  items: LabelItem[];
  file: string;
  paid: boolean;
  budgetUsd: number;
  prepare: (item: LabelItem) => PreparedCall | null;
  /** The payload of a record whose call failed. */
  emptyPayload: Record<string, unknown>;
  concurrency?: number;
  limit?: number;
  timeoutMs?: number;
  retries?: number;
  log?: (line: string) => void;
}): Promise<RunReport> {
  const { file } = options;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const retries = options.retries ?? 2;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const previous = existsSync(file) ? readJsonl<CallRecord>(file) : [];
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

  const write = (record: CallRecord & Record<string, unknown>) => {
    appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    if (record.failureKind)
      failures[record.failureKind] = (failures[record.failureKind] ?? 0) + 1;
  };

  const once = async (call: PreparedCall) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await call.invoke(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw new InterpreterError("timeout", "timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const one = async (item: LabelItem) => {
    const call = options.prepare(item);
    if (!call) return;
    const reservation = options.paid ? call.reserveUsd : 0;
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
          const result = await once(call);
          cost += result.usage?.costUsd ?? 0;
          const checked = call.check(result.output);
          write({
            messageId: item.messageId,
            status: checked.ok ? "ok" : "invalid",
            ...checked.payload,
            errors: checked.errors,
            failureKind: checked.ok ? null : "schema",
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
            ...options.emptyPayload,
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
        `${options.name}: ${total}/${todo.length}, US$ ${spent.toFixed(2)}`,
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
