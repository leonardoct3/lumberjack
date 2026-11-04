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
import { exportDataset } from "@/benchmark/export";
import { buildInventory } from "@/benchmark/inventory";
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
import { assertOutsideRepo, loadPseudonymKey, REPO_ROOT } from "@/benchmark/storage";
import { startOfDaySp } from "@/domain/timezone";

const USAGE = `Usage: npm run bench -- <command> [options]

  inventory --out FILE
  export    --from YYYY-MM-DD --to YYYY-MM-DD --out DIR [--context-days 7] [--deployed-revision SHA]
  sample    --export DIR --seed SEED --calibration-from YYYY-MM-DD --test-from YYYY-MM-DD
            [--random-size 300] [--per-tag 15]
  baseline  --export DIR --out DIR [--sample DIR] [--gold FILE]
  schema

Dates are São Paulo calendar days; --to is exclusive. Every path must be outside the repository.`;

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
    for (const raw of readJsonl<{ messageId?: unknown }>(assertOutsideRepo(goldFile))) {
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

const COMMANDS: Record<string, () => Promise<void>> = {
  inventory,
  export: exportCommand,
  sample,
  baseline,
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
