import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  annotationJsonSchema,
  validateAnnotation,
  type Annotation,
} from "@/benchmark/annotation";
import {
  BASELINE_VERSION,
  type CatalogMode,
  runBaseline,
  scoreIntents,
  scoreLinks,
  type BaselinePrediction,
} from "@/benchmark/baseline";
import { loadExport, readJsonl } from "@/benchmark/dataset";
import {
  anthropicDrafter,
  listModels,
  openaiDrafter,
  type Price,
} from "@/benchmark/draft/providers";
import { cursorDrafter, listCursorModels } from "@/benchmark/draft/cursor";
import { runDrafts } from "@/benchmark/draft/run";
import { exportDataset } from "@/benchmark/export";
import { buildInventory } from "@/benchmark/inventory";
import type { LabelItem } from "@/benchmark/label/item";
import { startLabelServer } from "@/benchmark/label/server";
import { createLabelStore, latestAnnotations } from "@/benchmark/labels";
import { createPseudonymizer } from "@/benchmark/pseudonymize";
import { withReadOnlySnapshot } from "@/benchmark/read-only";
import {
  assignSplits,
  buildFamilies,
  challengeTags,
  drawSample,
  SAMPLER_VERSION,
  type SampleItem,
  type SplitAssignment,
} from "@/benchmark/sample";
import { createJsonlSink } from "@/benchmark/sink";
import {
  assertOutsideRepo,
  loadApiKey,
  loadPseudonymKey,
  REPO_ROOT,
} from "@/benchmark/storage";
import { startOfDaySp } from "@/domain/timezone";

const USAGE = `Usage: npm run bench -- <command> [options]

  inventory --out FILE
  export    --from YYYY-MM-DD --to YYYY-MM-DD --out DIR [--context-days 7] [--deployed-revision SHA]
  sample    --export DIR --seed SEED --calibration-from YYYY-MM-DD --test-from YYYY-MM-DD
            [--random-size 300] [--per-tag 15]
  baseline  --export DIR --out DIR [--sample DIR] [--gold FILE]
  label     --export DIR --sample DIR --annotator ID [--port 4319]
  models
  draft     --export DIR --sample DIR --budget-usd N
            [--openai MODEL --openai-price IN/OUT] [--anthropic MODEL --anthropic-price IN/OUT]
            [--cursor MODEL[,param=value...]@IN/OUT]... [--limit N] [--concurrency 4]
  schema

Dates are São Paulo calendar days; --to is exclusive. Every path must be outside the repository.
API keys are read from the files named by OPENAI_API_KEY_FILE, ANTHROPIC_API_KEY_FILE and
CURSOR_API_KEY_FILE.`;

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function required(name: string): string {
  const value = argValue(name);
  if (!value) throw new Error(`Missing ${name}.\n\n${USAGE}`);
  return value;
}

function spDay(name: string): Date {
  const value = required(name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  return startOfDaySp(new Date(`${value}T12:00:00Z`));
}

function positiveInt(name: string, fallback: number): number {
  const raw = argValue(name);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a whole number`);
  return value;
}

/** Which database this is, without the credentials in the URL. */
export function describeTarget(url: string | undefined): string {
  if (!url) return "an unset DATABASE_URL";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "an unparseable DATABASE_URL";
  }
}

function repoRevision(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT })
      .toString()
      .trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT })
      .toString()
      .trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return "unknown";
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient();
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

async function inventory(): Promise<void> {
  const target = assertOutsideRepo(required("--out"));
  const pseudonymizer = createPseudonymizer(loadPseudonymKey());
  const localMigrations = readdirSync(path.join(REPO_ROOT, "prisma/migrations"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  console.error(
    `inventory of ${describeTarget(process.env.DATABASE_URL)} (read-only snapshot)`,
  );
  const result = await withDb((db) =>
    withReadOnlySnapshot(db, (tx, snapshot) =>
      buildInventory(tx, { snapshot, pseudonymizer, localMigrations }),
    ),
  );
  writeJson(target, result);
  console.error(`wrote ${target}`);
}

async function exportCommand(): Promise<void> {
  const from = spDay("--from");
  const to = spDay("--to");
  if (to <= from) throw new Error("--to must be after --from");
  const root = assertOutsideRepo(required("--out"));
  const pseudonymizer = createPseudonymizer(loadPseudonymKey());
  const source = {
    target: describeTarget(process.env.DATABASE_URL),
    repoRevision: repoRevision(),
    deployedRevision: argValue("--deployed-revision") ?? "unverified",
  };

  console.error(`export of ${source.target} (read-only snapshot)`);
  const dir = path.join(
    root,
    `export-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  const sink = createJsonlSink(dir);
  const manifest = await withDb((db) =>
    withReadOnlySnapshot(
      db,
      (tx, snapshot) =>
        exportDataset(tx, {
          snapshot,
          pseudonymizer,
          interval: { start: from, end: to },
          contextDays: positiveInt("--context-days", 7),
          sink,
          source,
        }),
      { timeoutMs: 300_000 },
    ),
  );
  writeJson(path.join(dir, "manifest.json"), manifest);
  for (const file of manifest.files) console.error(`  ${file.name}: ${file.rows} rows`);
  console.error(`wrote ${dir}`);
}

async function sample(): Promise<void> {
  const exportDir = assertOutsideRepo(required("--export"));
  const seed = required("--seed");
  const data = loadExport(exportDir);
  const candidateCount = new Map<string, number>();
  for (const c of data.candidates)
    candidateCount.set(c.sourceMessage, (candidateCount.get(c.sourceMessage) ?? 0) + 1);

  const families = buildFamilies(data.messages);
  const randomSize = positiveInt("--random-size", 300);
  const perTag = positiveInt("--per-tag", 15);
  const draw = drawSample(families, {
    seed,
    randomSize,
    perTag,
    tagsOf: (family) =>
      challengeTags(family, {
        candidateCount: family.members.reduce(
          (n, id) => n + (candidateCount.get(id) ?? 0),
          0,
        ),
        parties: data.parties,
      }),
  });
  const bounds = {
    calibrationFrom: spDay("--calibration-from"),
    testFrom: spDay("--test-from"),
  };
  const splits = new Map(assignSplits(families, bounds).map((s) => [s.familyId, s]));

  const dir = path.join(exportDir, `sample-${seed.replace(/[^\w-]/g, "_")}`);
  const sink = createJsonlSink(dir);
  const file = sink.file("sample.jsonl");
  const tally: Record<string, Record<string, number>> = {};
  for (const item of draw.items) {
    const split = splits.get(item.familyId)!;
    file.write({ ...item, split: split.split, excluded: split.excluded });
    const bucket = split.excluded ? `${split.split}:${split.excluded}` : split.split;
    tally[item.set] ??= {};
    tally[item.set][bucket] = (tally[item.set][bucket] ?? 0) + 1;
  }
  const summary = await file.close();

  writeJson(path.join(dir, "sample-manifest.json"), {
    samplerVersion: SAMPLER_VERSION,
    createdAt: new Date().toISOString(),
    seed,
    exportManifestSha256: sha256File(path.join(exportDir, "manifest.json")),
    families: families.length,
    randomSize,
    perTag,
    splitBounds: {
      calibrationFrom: bounds.calibrationFrom.toISOString(),
      testFrom: bounds.testFrom.toISOString(),
    },
    bySetAndSplit: tally,
    tagStats: draw.tagStats,
    files: [summary],
    notes: [
      "Random-set inclusion probabilities apply to families, not individual copies.",
      "Challenge tags are heuristics chosen to find hard cases; report the challenge set separately and never as overall accuracy.",
    ],
  });
  console.error(
    `${families.length} families; ${draw.items.length} sampled; wrote ${dir}`,
  );
}

type ScoredSet = {
  intents: ReturnType<typeof scoreIntents>;
  links: ReturnType<typeof scoreLinks>;
};

function drift(predictions: BaselinePrediction[]) {
  const confusion: Record<string, number> = {};
  let sameClass = 0;
  let sameLink = 0;
  for (const p of predictions) {
    const key = `${p.stored.class ?? "unset"} -> ${p.replayedClass}`;
    confusion[key] = (confusion[key] ?? 0) + 1;
    if (p.stored.class === p.replayedClass) sameClass += 1;
    if (p.stored.partyId === p.partyId) sameLink += 1;
  }
  return { messages: predictions.length, sameClass, sameLink, confusion };
}

async function baseline(): Promise<void> {
  const exportDir = assertOutsideRepo(required("--export"));
  const outDir = assertOutsideRepo(required("--out"));
  const data = loadExport(exportDir);
  const families = buildFamilies(data.messages);
  const representatives = families.map((f) => f.representative);
  const modes: CatalogMode[] = ["as_of_message", "retrospective"];
  const predictionsBy = Object.fromEntries(
    modes.map((catalog) => [
      catalog,
      runBaseline(representatives, data.parties, { catalog }),
    ]),
  ) as Record<CatalogMode, BaselinePrediction[]>;

  const sink = createJsonlSink(outDir);
  const files = [];
  for (const mode of modes) {
    const file = sink.file(`predictions-${mode}.jsonl`);
    for (const prediction of predictionsBy[mode]) file.write(prediction);
    files.push(await file.close());
  }

  const report: Record<string, unknown> = {
    baselineVersion: BASELINE_VERSION,
    createdAt: new Date().toISOString(),
    repoRevision: repoRevision(),
    exportManifestSha256: sha256File(path.join(exportDir, "manifest.json")),
    scope: "family representatives inside the export interval",
    catalogModes: {
      as_of_message: "online replay: only events catalogued before each message",
      retrospective:
        "hindsight: events catalogued later count too; never report as what the system knew",
    },
    storedVersusReplayed: Object.fromEntries(
      modes.map((mode) => [mode, drift(predictionsBy[mode])]),
    ),
    files,
  };

  const goldFile = argValue("--gold");
  if (goldFile) {
    const texts = new Map(data.messages.map((m) => [m.id, m.text]));
    const valid: Annotation[] = [];
    const invalid: { messageId: unknown; errors: string[] }[] = [];
    const records = readJsonl<{ messageId?: unknown }>(assertOutsideRepo(goldFile));
    for (const raw of latestAnnotations(records)) {
      const text =
        typeof raw.messageId === "string" ? texts.get(raw.messageId) : undefined;
      if (text == null) {
        invalid.push({
          messageId: raw.messageId,
          errors: ["messageId is not in this export"],
        });
        continue;
      }
      const result = validateAnnotation(raw, { text });
      if (
        result.annotation &&
        result.errors.length === 0 &&
        result.annotation.source === "human"
      ) {
        valid.push(result.annotation);
      } else {
        invalid.push({
          messageId: raw.messageId,
          errors:
            result.errors.length > 0
              ? result.errors
              : ["only human-reviewed labels are scored"],
        });
      }
    }

    const sampleDir = argValue("--sample");
    const items = sampleDir
      ? readJsonl<SampleItem & SplitAssignment>(
          path.join(assertOutsideRepo(sampleDir), "sample.jsonl"),
        )
      : [];
    const score = (
      keep: (a: Annotation) => boolean,
    ): Record<CatalogMode, ScoredSet> => {
      const subset = valid.filter(keep);
      return Object.fromEntries(
        modes.map((mode) => [
          mode,
          {
            intents: scoreIntents(subset, predictionsBy[mode]),
            links: scoreLinks(subset, predictionsBy[mode]),
          },
        ]),
      ) as Record<CatalogMode, ScoredSet>;
    };
    const inItems = (filter: (i: SampleItem & SplitAssignment) => boolean) => {
      const ids = new Set(items.filter(filter).map((i) => i.messageId));
      return (a: Annotation) => ids.has(a.messageId);
    };

    report.gold = {
      file: path.basename(goldFile),
      sha256: sha256File(goldFile),
      scored: valid.length,
      rejected: invalid,
    };
    report.scores = sampleDir
      ? {
          random: score(inItems((i) => i.set === "random")),
          challenge: score(inItems((i) => i.set === "challenge")),
          heldOutTest: score(inItems((i) => i.split === "test" && i.excluded == null)),
        }
      : { all: score(() => true) };
  }

  writeJson(path.join(outDir, "report.json"), report);
  console.error(`wrote ${outDir}`);
}

function loadSample() {
  const exportDir = assertOutsideRepo(required("--export"));
  const sampleDir = assertOutsideRepo(required("--sample"));
  const manifest = JSON.parse(
    readFileSync(path.join(sampleDir, "sample-manifest.json"), "utf8"),
  ) as { seed: string; exportManifestSha256: string };
  if (
    manifest.exportManifestSha256 !== sha256File(path.join(exportDir, "manifest.json"))
  ) {
    throw new Error("This sample was drawn from a different export.");
  }
  return {
    sampleDir,
    manifest,
    data: loadExport(exportDir),
    items: readJsonl<LabelItem>(path.join(sampleDir, "sample.jsonl")),
  };
}

/** Blind labelling on loopback: the page never shows what the rules decided. */
async function label(): Promise<void> {
  const annotator = required("--annotator");
  if (!/^[a-z0-9_-]{2,32}$/.test(annotator)) {
    throw new Error(
      "--annotator must be a pseudonym: 2-32 lowercase letters, digits, - or _",
    );
  }
  const { sampleDir, manifest: sampleManifest, data, items } = loadSample();
  const store = createLabelStore(path.join(sampleDir, "labels", `${annotator}.jsonl`));
  const server = await startLabelServer({
    data,
    items,
    seed: sampleManifest.seed,
    store,
    annotator,
    port: positiveInt("--port", 4319),
  });
  console.error(
    `${items.length} items for ${annotator}; labels go to ${store.file}\n\n  open ${server.url}\n\nCtrl+C to stop.`,
  );
  await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  await server.close();
}

const KEY_FILES = {
  openai: "OPENAI_API_KEY_FILE",
  anthropic: "ANTHROPIC_API_KEY_FILE",
  cursor: "CURSOR_API_KEY_FILE",
} as const;

/** What each key can reach, so a person picks the strongest model before anything is spent. */
async function models(): Promise<void> {
  for (const provider of ["openai", "anthropic"] as const) {
    if (!process.env[KEY_FILES[provider]]) {
      console.log(`${provider}: ${KEY_FILES[provider]} not set, skipped`);
      continue;
    }
    const ids = await listModels(provider, loadApiKey(KEY_FILES[provider]));
    console.log(
      `${provider} (${ids.length}):\n${ids.map((id) => `  ${id}`).join("\n")}`,
    );
  }
  if (!process.env[KEY_FILES.cursor]) {
    console.log(`cursor: ${KEY_FILES.cursor} not set, skipped`);
    return;
  }
  const cursorModels = await listCursorModels(loadApiKey(KEY_FILES.cursor));
  console.log(`cursor (${cursorModels.length}):`);
  for (const model of cursorModels) {
    const params = model.parameters
      .map((p) => `${p.id}=${p.values.join("|")}`)
      .join(" ");
    console.log(`  ${model.id}${params ? `  ${params}` : ""}`);
  }
}

const PRICE = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/;

/** "IN/OUT" in US$ per million tokens, from the provider's price page. */
function parsePrice(raw: string, name: string): Price {
  const match = PRICE.exec(raw);
  if (!match)
    throw new Error(`${name} must be IN/OUT in US$ per million tokens, e.g. 3/15`);
  return { inputPerMTok: Number(match[1]), outputPerMTok: Number(match[2]) };
}

function price(name: string): Price {
  return parsePrice(required(name), name);
}

function argValues(name: string): string[] {
  return process.argv.flatMap((arg, i) =>
    arg === name && process.argv[i + 1] ? [process.argv[i + 1]] : [],
  );
}

/** `MODEL[,param=value...]@IN/OUT`, e.g. `claude-opus-5-5,thinking=high@5/25`. */
function cursorSpec(raw: string) {
  const at = raw.lastIndexOf("@");
  if (at < 0) throw new Error(`--cursor ${raw} needs @IN/OUT prices`);
  const [model, ...pairs] = raw.slice(0, at).split(",");
  const params = pairs.map((pair) => {
    const [id, value] = pair.split("=");
    if (!id || !value) throw new Error(`--cursor parameter ${pair} must be id=value`);
    return { id, value };
  });
  return {
    model,
    params: params.length > 0 ? params : undefined,
    price: parsePrice(raw.slice(at + 1), "--cursor"),
  };
}

/** Two providers draft every item independently; nothing here is gold until a person reviews it. */
async function draft(): Promise<void> {
  const budgetUsd = Number(required("--budget-usd"));
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0)
    throw new Error("--budget-usd must be positive");
  const { sampleDir, manifest, data, items } = loadSample();
  // Providers can run separately: each drafts into its own file and resumes there.
  const openaiModel = argValue("--openai");
  const anthropicModel = argValue("--anthropic");
  const viaCursor = argValues("--cursor").map(cursorSpec);
  if (!openaiModel && !anthropicModel && viaCursor.length === 0) {
    throw new Error(
      `Pass at least one of --openai, --anthropic, --cursor.\n\n${USAGE}`,
    );
  }
  const cursorKey = viaCursor.length > 0 ? loadApiKey(KEY_FILES.cursor) : "";
  const drafters = [
    ...viaCursor.map((spec) => cursorDrafter({ key: cursorKey, ...spec })),
    ...(openaiModel
      ? [
          openaiDrafter({
            key: loadApiKey(KEY_FILES.openai),
            model: openaiModel,
            price: price("--openai-price"),
          }),
        ]
      : []),
    ...(anthropicModel
      ? [
          anthropicDrafter({
            key: loadApiKey(KEY_FILES.anthropic),
            model: anthropicModel,
            price: price("--anthropic-price"),
          }),
        ]
      : []),
  ];
  const limit = argValue("--limit");
  const report = await runDrafts({
    data,
    items,
    seed: manifest.seed,
    drafters,
    dir: path.join(sampleDir, "drafts"),
    budgetUsd,
    limit: limit == null ? undefined : positiveInt("--limit", 0),
    concurrency: positiveInt("--concurrency", 4),
    meta: { exportManifestSha256: manifest.exportManifestSha256 },
    log: (line) => console.error(line),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.abortedBy) throw new Error(`Stopped: ${report.abortedBy}`);
}

const COMMANDS: Record<string, () => Promise<void>> = {
  inventory,
  export: exportCommand,
  sample,
  baseline,
  label,
  models,
  draft,
  schema: async () => {
    process.stdout.write(`${JSON.stringify(annotationJsonSchema(), null, 2)}\n`);
  },
};

async function main(): Promise<void> {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) throw new Error(USAGE);
  await command();
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
