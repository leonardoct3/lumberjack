import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { ANNOTATION_SCHEMA_VERSION } from "../annotation";
import type { LoadedExport } from "../dataset";
import {
  buildItemView,
  type ItemView,
  type LabelItem,
  labelQueue,
} from "../label/item";
import { buildLabel, createLabelStore, type LabelStore } from "../labels";
import { GUIDE_VERSION, LABELING_GUIDE, renderItem, renderRetry } from "./guide";
import {
  costUsd,
  DraftError,
  type DraftErrorKind,
  type Drafter,
  type Usage,
} from "./providers";
import { DRAFT_JSON_SCHEMA, draftToLabelBody } from "./schema";

export const RETENTION: Record<Drafter["route"], string> = {
  api: "provider default, unverified",
  cursor: "Cursor Privacy Mode and provider default, unverified",
};

export type DraftRunOptions = {
  data: LoadedExport;
  items: LabelItem[];
  seed: string;
  drafters: Drafter[];
  /** `<sample>/drafts`, outside the repository. */
  dir: string;
  budgetUsd: number;
  /** At most this many new messages per drafter, for a smoke run. */
  limit?: number;
  concurrency?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  transientRetries?: number;
  meta: { exportManifestSha256: string };
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

type FailureKind = DraftErrorKind | "invalid";

export type DrafterReport = {
  id: string;
  provider: Drafter["provider"];
  route: Drafter["route"];
  model: string;
  params: Drafter["params"] | null;
  price: Drafter["price"];
  retention: string;
  alreadyDrafted: number;
  attempted: number;
  drafted: number;
  correctedOnRetry: number;
  failed: Partial<Record<FailureKind, number>>;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: { p50: number | null; p95: number | null };
};

export type DraftRunReport = {
  guideVersion: string;
  schemaVersion: number;
  exportManifestSha256: string;
  sampleSeed: string;
  startedAt: string;
  finishedAt: string;
  budgetUsd: number;
  /** Earlier runs in the same directory count against the same budget. */
  priorSpentUsd: number;
  spentUsd: number;
  stoppedForBudget: boolean;
  abortedBy: string | null;
  drafters: DrafterReport[];
};

/** Rough enough to be an upper bound: Portuguese runs well above three characters a token. */
const estimateTokens = (text: string) => Math.ceil(text.length / 3);

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

class BudgetStop extends Error {}

export async function runDrafts(options: DraftRunOptions): Promise<DraftRunReport> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? (() => {});
  const maxOutputTokens = options.maxOutputTokens ?? 16_000;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const transientRetries = options.transientRetries ?? 3;
  const startedAt = now();

  mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  const failuresFile = (d: Drafter) => path.join(options.dir, `${d.id}.failures.jsonl`);

  const stores = new Map<string, LabelStore>();
  const stats = new Map<string, DrafterReport & { latencies: number[] }>();
  for (const drafter of options.drafters) {
    const store = createLabelStore(path.join(options.dir, `${drafter.id}.jsonl`));
    stores.set(drafter.id, store);
    stats.set(drafter.id, {
      id: drafter.id,
      provider: drafter.provider,
      route: drafter.route,
      model: drafter.model,
      params: drafter.params ?? null,
      price: drafter.price,
      retention: RETENTION[drafter.route],
      alreadyDrafted: store.latest().size,
      attempted: 0,
      drafted: 0,
      correctedOnRetry: 0,
      failed: {},
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: { p50: null, p95: null },
      latencies: [],
    });
  }

  // Excluded items never reach a benchmark, so they are not worth paying for.
  const queue = labelQueue(options.items, options.seed).filter(
    (i) => i.excluded == null,
  );
  const pending = options.drafters.map((drafter) => {
    const done = stores.get(drafter.id)!.latest();
    const todo = queue.filter((i) => !done.has(i.messageId));
    return (options.limit == null ? todo : todo.slice(0, options.limit)).map(
      (item) => ({ drafter, item }),
    );
  });
  // Interleaved, so a budget stop leaves both drafters covering the same messages.
  const tasks = interleave(pending);

  const priorSpentUsd = priorSpend(options.dir);
  let spent = priorSpentUsd;
  let reserved = 0;
  let stoppedForBudget = false;
  let abortedBy: string | null = null;

  async function call(drafter: Drafter, user: string) {
    const s = stats.get(drafter.id)!;
    const estimate = costUsd(
      {
        inputTokens: estimateTokens(
          LABELING_GUIDE + JSON.stringify(DRAFT_JSON_SCHEMA) + user,
        ),
        outputTokens: maxOutputTokens,
      },
      drafter.price,
    );
    if (spent + reserved + estimate > options.budgetUsd) throw new BudgetStop();
    reserved += estimate;
    const record = (usage: Usage | undefined, started: number) => {
      reserved -= estimate;
      s.calls += 1;
      s.latencies.push(Date.now() - started);
      if (!usage) return;
      const cost = costUsd(usage, drafter.price);
      spent += cost;
      s.costUsd += cost;
      s.inputTokens += usage.inputTokens;
      s.outputTokens += usage.outputTokens;
    };
    const started = Date.now();
    try {
      const reply = await drafter.draft({
        system: LABELING_GUIDE,
        user,
        schema: DRAFT_JSON_SCHEMA,
        maxOutputTokens,
        signal: AbortSignal.timeout(timeoutMs),
      });
      record(reply.usage, started);
      return reply;
    } catch (error) {
      record(error instanceof DraftError ? error.usage : undefined, started);
      throw error;
    }
  }

  async function callWithRetries(drafter: Drafter, user: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call(drafter, user);
      } catch (error) {
        if (
          !(error instanceof DraftError) ||
          error.kind !== "transient" ||
          attempt >= transientRetries
        )
          throw error;
        await sleep(Math.min(60_000, error.retryAfterMs ?? 2_000 * 2 ** attempt));
      }
    }
  }

  function check(output: unknown, view: ItemView, drafter: Drafter) {
    const converted = draftToLabelBody(output, view);
    if (converted.errors.length > 0)
      return { annotation: null, errors: converted.errors };
    return buildLabel(
      converted.body,
      {
        messageId: view.messageId,
        annotator: drafter.id,
        now: now(),
        source: "model_draft",
      },
      { text: view.text, availableContext: view.availableContext },
    );
  }

  function fail(
    drafter: Drafter,
    messageId: string,
    kind: FailureKind,
    detail: string[],
  ) {
    const s = stats.get(drafter.id)!;
    s.failed[kind] = (s.failed[kind] ?? 0) + 1;
    appendFileSync(
      failuresFile(drafter),
      `${JSON.stringify({ messageId, drafter: drafter.id, kind, detail, at: now().toISOString() })}\n`,
      { mode: 0o600 },
    );
  }

  async function runTask({ drafter, item }: { drafter: Drafter; item: LabelItem }) {
    const view = buildItemView(options.data, item);
    const s = stats.get(drafter.id)!;
    s.attempted += 1;
    try {
      let result = check(
        (await callWithRetries(drafter, renderItem(view))).output,
        view,
        drafter,
      );
      let corrected = false;
      if (!result.annotation) {
        result = check(
          (await callWithRetries(drafter, renderRetry(view, result.errors))).output,
          view,
          drafter,
        );
        corrected = true;
      }
      if (!result.annotation)
        return fail(drafter, item.messageId, "invalid", result.errors);
      stores.get(drafter.id)!.append(result.annotation);
      s.drafted += 1;
      if (corrected) s.correctedOnRetry += 1;
    } catch (error) {
      if (error instanceof BudgetStop) {
        s.attempted -= 1;
        stoppedForBudget = true;
        return;
      }
      if (!(error instanceof DraftError)) throw error;
      fail(drafter, item.messageId, error.kind, [error.message]);
      if (error.kind === "fatal") abortedBy = `${drafter.id}: ${error.message}`;
    }
  }

  let next = 0;
  let finished = 0;
  const worker = async () => {
    while (next < tasks.length && !stoppedForBudget && abortedBy == null) {
      const task = tasks[next++];
      await runTask(task);
      finished += 1;
      if (finished % 10 === 0 || finished === tasks.length) {
        log(`drafts: ${finished}/${tasks.length} done, US$ ${spent.toFixed(2)} spent`);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker),
  );

  const report: DraftRunReport = {
    guideVersion: GUIDE_VERSION,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    exportManifestSha256: options.meta.exportManifestSha256,
    sampleSeed: options.seed,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    budgetUsd: options.budgetUsd,
    priorSpentUsd: Number(priorSpentUsd.toFixed(6)),
    spentUsd: Number((spent - priorSpentUsd).toFixed(6)),
    stoppedForBudget,
    abortedBy,
    drafters: [...stats.values()].map(({ latencies, ...rest }) => {
      const sorted = [...latencies].sort((a, b) => a - b);
      return {
        ...rest,
        costUsd: Number(rest.costUsd.toFixed(6)),
        latencyMs: { p50: percentile(sorted, 50), p95: percentile(sorted, 95) },
      };
    }),
  };
  writeFileSync(
    path.join(options.dir, `run-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  return report;
}

function priorSpend(dir: string): number {
  return readdirSync(dir)
    .filter((name) => /^run-.*\.json$/.test(name))
    .reduce((sum, name) => {
      const run = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as {
        spentUsd?: unknown;
      };
      return sum + (typeof run.spentUsd === "number" ? run.spentUsd : 0);
    }, 0);
}

function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++)
    for (const list of lists) if (i < list.length) out.push(list[i]);
  return out;
}
