import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
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
  anthropicClient,
  listModels,
  openaiClient,
  openrouterClient,
  type Price,
} from "@/llm/client";
import {
  agreedIds,
  auditIds,
  auditReport,
  buildReviewPlan,
  COMPARE_VERSION,
  type ReviewPlan,
} from "@/benchmark/draft/compare";
import { cursorClient, listCursorModels } from "@/benchmark/draft/cursor";
import { runDrafts } from "@/benchmark/draft/run";
import { exportDataset } from "@/benchmark/export";
import {
  latestResults,
  runInterpretations,
  scoreInterpretations,
  type InterpretationRecord,
} from "@/benchmark/interpret";
import { INTERPRETER_GUIDE, renderRequest } from "@/pipeline/interpreters/guide";
import {
  INTERPRETATION_JSON_SCHEMA,
  MAX_OUTPUT_TOKENS,
  modelInterpreter,
} from "@/pipeline/interpreters/model";
import { rulesInterpreter } from "@/pipeline/interpreters/rules";
import {
  modelResolver,
  RESOLUTION_JSON_SCHEMA,
  RESOLVER_GUIDE,
  RESOLVER_MAX_OUTPUT_TOKENS,
  renderResolution,
} from "@/pipeline/resolvers/model";
import { rulesResolver } from "@/pipeline/resolvers/rules";
import {
  latestProposals,
  observationsFromInterpretation,
  observationsFromLabel,
  runResolutions,
  scoreResolutions,
  type Proposal,
  type ResolutionRecord,
} from "@/benchmark/resolve";
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
  baseline  --export DIR --out DIR [--sample DIR] [--gold FILE] [--silver FILE]
  label     --export DIR --sample DIR --annotator ID [--port 4319]
            [--review --drafts A_ID,B_ID [--audit-size 30]]
  models
  draft     --export DIR --sample DIR --budget-usd N
            [--openai MODEL --openai-price IN/OUT] [--anthropic MODEL --anthropic-price IN/OUT]
            [--cursor MODEL[,param=value...]@IN/OUT]... [--limit N] [--concurrency 4]
  silver    --export DIR --sample DIR --annotator ID --drafts A_ID,B_ID [--unreviewed]
  interpret --export DIR --sample DIR --labels FILE[,FILE...]
            (--rules | --cursor MODEL[,param=value...]@IN/OUT | --openai MODEL --openai-price IN/OUT
             | --openrouter MAKER/MODEL --openrouter-price IN/OUT)
            [--budget-usd N] [--limit N] [--concurrency 4]
  resolve   --export DIR --sample DIR --labels FILE[,FILE...] --observations (labels | INTERPRETER_ID)
            (--rules | --cursor MODEL[,param=value...]@IN/OUT | --openai MODEL --openai-price IN/OUT
             | --openrouter MAKER/MODEL --openrouter-price IN/OUT)
            [--budget-usd N] [--limit N] [--concurrency 4]
  schema

Dates are São Paulo calendar days; --to is exclusive. Every path must be outside the repository.
API keys are read from the files named by OPENAI_API_KEY_FILE, ANTHROPIC_API_KEY_FILE,
CURSOR_API_KEY_FILE and OPENROUTER_API_KEY_FILE.`;

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

  const sampleDir = argValue("--sample");
  const items = sampleDir
    ? readJsonl<SampleItem & SplitAssignment>(
        path.join(assertOutsideRepo(sampleDir), "sample.jsonl"),
      )
    : [];
  const scoreFile = (file: string, accept: Annotation["source"][]) =>
    scoreLabels({
      file,
      accept,
      data,
      items,
      predictionsBy,
      bySample: sampleDir != null,
    });

  const goldFile = argValue("--gold");
  if (goldFile) {
    const { labels, scores } = scoreFile(goldFile, ["human"]);
    report.gold = labels;
    report.scores = scores;
  }
  // Silver is model agreement, not ground truth: it is kept apart from gold and never
  // covers the held-out test split.
  const silverFile = argValue("--silver");
  if (silverFile) {
    const { labels, scores } = scoreFile(silverFile, ["model_draft"]);
    report.silver = labels;
    report.silverScores = scores;
  }

  writeJson(path.join(outDir, "report.json"), report);
  console.error(`wrote ${outDir}`);
}

function scoreLabels(options: {
  file: string;
  accept: Annotation["source"][];
  data: ReturnType<typeof loadExport>;
  items: (SampleItem & SplitAssignment)[];
  predictionsBy: Record<CatalogMode, BaselinePrediction[]>;
  bySample: boolean;
}) {
  const file = assertOutsideRepo(options.file);
  const texts = new Map(options.data.messages.map((m) => [m.id, m.text]));
  const valid: Annotation[] = [];
  const invalid: { messageId: unknown; errors: string[] }[] = [];
  for (const raw of latestAnnotations(readJsonl<{ messageId?: unknown }>(file))) {
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
      options.accept.includes(result.annotation.source)
    ) {
      valid.push(result.annotation);
    } else {
      invalid.push({
        messageId: raw.messageId,
        errors:
          result.errors.length > 0
            ? result.errors
            : [`only ${options.accept.join(" or ")} labels are scored here`],
      });
    }
  }

  const modes = Object.keys(options.predictionsBy) as CatalogMode[];
  const score = (keep: (a: Annotation) => boolean): Record<CatalogMode, ScoredSet> => {
    const subset = valid.filter(keep);
    return Object.fromEntries(
      modes.map((mode) => [
        mode,
        {
          intents: scoreIntents(subset, options.predictionsBy[mode]),
          links: scoreLinks(subset, options.predictionsBy[mode]),
        },
      ]),
    ) as Record<CatalogMode, ScoredSet>;
  };
  const inItems = (filter: (i: SampleItem & SplitAssignment) => boolean) => {
    const ids = new Set(options.items.filter(filter).map((i) => i.messageId));
    return (a: Annotation) => ids.has(a.messageId);
  };

  return {
    labels: {
      file: path.basename(file),
      sha256: sha256File(file),
      scored: valid.length,
      rejected: invalid,
    },
    scores: options.bySample
      ? {
          random: score(inItems((i) => i.set === "random")),
          challenge: score(inItems((i) => i.set === "challenge")),
          heldOutTest: score(inItems((i) => i.split === "test" && i.excluded == null)),
        }
      : { all: score(() => true) },
  };
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
  const review = process.argv.includes("--review")
    ? loadReview(sampleDir, items, sampleManifest.seed)
    : undefined;
  const server = await startLabelServer({
    data,
    items,
    seed: sampleManifest.seed,
    store,
    annotator,
    port: positiveInt("--port", 4319),
    review: review && { plan: review.plan, drafts: review.drafts },
  });
  const count = review ? review.plan.review.length : items.length;
  console.error(
    `${count} items for ${annotator}${review ? " to review" : ""}; labels go to ${store.file}\n\n  open ${server.url}\n\nCtrl+C to stop.`,
  );
  await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  await server.close();
}

function draftIds(): [string, string] {
  const ids = required("--drafts").split(",");
  if (
    ids.length !== 2 ||
    ids.some((id) => !/^[a-z0-9_.-]+$/.test(id)) ||
    ids[0] === ids[1]
  ) {
    throw new Error("--drafts takes two different drafter ids: A_ID,B_ID");
  }
  return [ids[0], ids[1]];
}

/**
 * The review plan is written once and reused, so the audit stays the same draw
 * across sessions even if drafts are added later.
 */
function loadReview(sampleDir: string, items: LabelItem[], seed: string) {
  const ids = draftIds();
  const drafts = ids.map((id) => {
    const file = path.join(sampleDir, "drafts", `${id}.jsonl`);
    if (!existsSync(file))
      throw new Error(`No drafts for ${id} in ${path.dirname(file)}`);
    return createLabelStore(file).latest();
  }) as [Map<string, Annotation>, Map<string, Annotation>];
  const planFile = path.join(sampleDir, "review", "plan.json");
  let plan: ReviewPlan | undefined;
  if (existsSync(planFile)) {
    plan = JSON.parse(readFileSync(planFile, "utf8")) as ReviewPlan;
    if (plan.drafters.join() !== ids.join()) {
      throw new Error(
        `${planFile} was planned for ${plan.drafters.join(",")}, not ${ids.join(",")}`,
      );
    }
    if (plan.compareVersion !== COMPARE_VERSION) {
      const kept = planFile.replace(/\.json$/, `-v${plan.compareVersion ?? 1}.json`);
      renameSync(planFile, kept);
      console.error(`compared differently since; kept the old plan as ${kept}`);
      plan = undefined;
    }
  }
  if (!plan) {
    plan = buildReviewPlan({
      items,
      drafts: [
        { id: ids[0], byMessage: drafts[0] },
        { id: ids[1], byMessage: drafts[1] },
      ],
      seed,
      auditSize: positiveInt("--audit-size", 30),
    });
    writeJson(planFile, plan);
    console.error(`wrote ${planFile}: ${JSON.stringify(plan.counts)}`);
  }
  return { plan, drafts, planFile };
}

/**
 * Silver labels: draft A on items both drafts agree on and nobody reviewed,
 * with an error estimate from the agreements a person labelled. With
 * --unreviewed the test split and audit are not waited for: every agreement
 * without a human label is silver, and contested items are left out.
 */
async function silver(): Promise<void> {
  const annotator = required("--annotator");
  const unreviewed = process.argv.includes("--unreviewed");
  const { sampleDir, items, manifest } = loadSample();
  const { plan, drafts, planFile } = loadReview(sampleDir, items, manifest.seed);
  const human = new Map(
    [
      ...createLabelStore(
        path.join(sampleDir, "labels", `${annotator}.jsonl`),
      ).latest(),
    ].filter(([, a]) => a.source === "human"),
  );
  const agreed = agreedIds(plan);
  const silverIds = unreviewed
    ? agreed.filter((id) => !human.has(id))
    : plan.silver.filter((id) => !human.has(id));
  const audit = auditReport(unreviewed ? agreed : auditIds(plan), drafts[0], human);
  const pending = plan.review.filter((e) => !human.has(e.messageId)).length;
  const silverSet = new Set(silverIds);
  const testItems = items.filter((i) => i.split === "test" && i.excluded == null);

  const outDir = path.join(
    sampleDir,
    "silver",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  const sink = createJsonlSink(outDir);
  const out = sink.file("silver.jsonl");
  for (const id of silverIds) out.write(drafts[0].get(id));
  const file = await out.close();
  const report = {
    createdAt: new Date().toISOString(),
    exportManifestSha256: manifest.exportManifestSha256,
    plan: {
      file: path.relative(sampleDir, planFile),
      sha256: sha256File(planFile),
      counts: plan.counts,
    },
    mode: unreviewed ? "unreviewed" : "reviewed",
    source: plan.drafters[0],
    agreedWith: plan.drafters[1],
    file,
    humanLabels: human.size,
    contestedLeftOut: plan.counts.usable - agreed.length,
    heldOutTest: {
      usable: testItems.length,
      silver: testItems.filter((i) => silverSet.has(i.messageId)).length,
      human: testItems.filter((i) => human.has(i.messageId)).length,
    },
    reviewPending: pending,
    audit,
    caveat: unreviewed
      ? "Nobody reviewed these: silver is two models agreeing, test split included, with contested items left out, so scores lean towards easier messages. Report it apart from gold, and never evaluate either drafting model on it."
      : "Silver is two models agreeing, not a person checking. Report it apart from gold; audit.errorRateInterval bounds how often a person would have changed it.",
  };
  writeJson(path.join(outDir, "manifest.json"), report);
  console.log(JSON.stringify(report, null, 2));
  if (!unreviewed && audit.reviewed < audit.audited) {
    console.error(
      `audit incomplete: ${audit.reviewed} of ${audit.audited} reviewed, so the error rate is not final`,
    );
  }
}

const KEY_FILES = {
  openai: "OPENAI_API_KEY_FILE",
  anthropic: "ANTHROPIC_API_KEY_FILE",
  cursor: "CURSOR_API_KEY_FILE",
  openrouter: "OPENROUTER_API_KEY_FILE",
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

const PRICE = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/;

/** "IN/OUT[/CACHED]" in US$ per million tokens, from the provider's price page. */
function parsePrice(raw: string, name: string): Price {
  const match = PRICE.exec(raw);
  if (!match)
    throw new Error(
      `${name} must be IN/OUT[/CACHED] in US$ per million tokens, e.g. 3/15/0.3`,
    );
  return {
    inputPerMTok: Number(match[1]),
    outputPerMTok: Number(match[2]),
    ...(match[3] != null && { cachedInputPerMTok: Number(match[3]) }),
  };
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
    ...viaCursor.map((spec) => cursorClient({ key: cursorKey, ...spec })),
    ...(openaiModel
      ? [
          openaiClient({
            key: loadApiKey(KEY_FILES.openai),
            model: openaiModel,
            price: price("--openai-price"),
          }),
        ]
      : []),
    ...(anthropicModel
      ? [
          anthropicClient({
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

/** Labels from several files, the first file winning: list human labels before silver. */
function loadLabels(files: string[], data: ReturnType<typeof loadExport>) {
  const texts = new Map(data.messages.map((m) => [m.id, m.text]));
  const labels = new Map<string, Annotation>();
  const sources = files.map((raw) => {
    const file = assertOutsideRepo(raw);
    let accepted = 0;
    let rejected = 0;
    for (const record of latestAnnotations(readJsonl<{ messageId?: unknown }>(file))) {
      const text =
        typeof record.messageId === "string" ? texts.get(record.messageId) : undefined;
      const result = text == null ? null : validateAnnotation(record, { text });
      if (!result?.annotation || result.errors.length > 0) {
        rejected++;
        continue;
      }
      if (labels.has(result.annotation.messageId)) continue;
      labels.set(result.annotation.messageId, result.annotation);
      accepted++;
    }
    return { file: path.basename(file), sha256: sha256File(file), accepted, rejected };
  });
  return { labels, sources };
}

/** --rules, or the model client named by --cursor, --openai or --openrouter. */
function modelChoice() {
  if (process.argv.includes("--rules")) return null;
  const spec = argValue("--cursor");
  const openaiModel = argValue("--openai");
  const openrouterModel = argValue("--openrouter");
  const client = spec
    ? cursorClient({ key: loadApiKey(KEY_FILES.cursor), ...cursorSpec(spec) })
    : openaiModel
      ? openaiClient({
          key: loadApiKey(KEY_FILES.openai),
          model: openaiModel,
          price: price("--openai-price"),
        })
      : openrouterModel
        ? openrouterClient({
            key: loadApiKey(KEY_FILES.openrouter),
            model: openrouterModel,
            price: price("--openrouter-price"),
          })
        : null;
  if (!client)
    throw new Error(
      `Pass one of --rules, --cursor, --openai, --openrouter.\n\n${USAGE}`,
    );
  return client;
}

function interpreterChoice() {
  const client = modelChoice();
  if (!client) return { id: "rules", interpreter: rulesInterpreter, client: null };
  return { id: client.id, interpreter: modelInterpreter(client), client };
}

function budgetFor(client: unknown): number {
  const budgetUsd = client ? Number(required("--budget-usd")) : 0;
  if (client && (!Number.isFinite(budgetUsd) || budgetUsd <= 0))
    throw new Error("--budget-usd must be positive");
  return budgetUsd;
}

/**
 * Runs one interpreter over every labelled item and scores it; rerunning
 * resumes where it stopped and rescores everything answered so far.
 */
async function interpret(): Promise<void> {
  const { sampleDir, data, items } = loadSample();
  const { labels, sources } = loadLabels(required("--labels").split(","), data);
  const { id, interpreter, client } = interpreterChoice();
  const budgetUsd = budgetFor(client);

  const fixed =
    INTERPRETER_GUIDE.length + JSON.stringify(INTERPRETATION_JSON_SCHEMA).length;
  const reserveUsd = (request: Parameters<typeof renderRequest>[0]) => {
    if (!client) return 0;
    const input =
      Math.ceil((fixed + renderRequest(request).length) / 3) +
      (client.promptOverheadTokens ?? 0);
    // Room for the corrective retry as well.
    return (
      (2 *
        (input * client.price.inputPerMTok +
          MAX_OUTPUT_TOKENS * client.price.outputPerMTok)) /
      1e6
    );
  };

  const labelled = items.filter((i) => i.excluded == null && labels.has(i.messageId));
  const dir = path.join(sampleDir, "interpretations");
  const file = path.join(dir, `${id}.jsonl`);
  const limit = argValue("--limit");
  const run = await runInterpretations({
    data,
    items: labelled,
    interpreter,
    file,
    budgetUsd,
    reserveUsd,
    concurrency: positiveInt("--concurrency", 4),
    limit: limit == null ? undefined : positiveInt("--limit", 0),
    log: (line) => console.error(line),
  });

  const results = latestResults(readJsonl<InterpretationRecord>(file));
  const scored = (keep: (i: LabelItem) => boolean) =>
    scoreInterpretations(
      labelled
        .filter((i) => keep(i) && results.has(i.messageId))
        .map((i) => labels.get(i.messageId)!),
      results,
    );
  const report = {
    createdAt: new Date().toISOString(),
    repoRevision: repoRevision(),
    run,
    labels: { sources, usable: labelled.length, answered: results.size },
    caveat:
      "Labels are mostly two models agreeing, with contested messages left out, so scores lean towards easier messages. Never score either drafting model on them.",
    scores: {
      all: scored(() => true),
      random: scored((i) => i.set === "random"),
      challenge: scored((i) => i.set === "challenge"),
      heldOutTest: scored((i) => i.split === "test"),
    },
  };
  const out = path.join(
    dir,
    `report-${id}-${report.createdAt.replace(/[:.]/g, "-")}.json`,
  );
  writeJson(out, report);
  console.error(`wrote ${out}`);
  console.log(JSON.stringify(run, null, 2));
  if (run.abortedBy) throw new Error(`Stopped: ${run.abortedBy}`);
}

/**
 * Resolves every labelled item, from the labelled observations (resolution
 * alone) or from an interpreter's (the whole pipeline), and scores it beside
 * the current matcher on the same messages.
 */
async function resolveCommand(): Promise<void> {
  const { sampleDir, data, items } = loadSample();
  const { labels, sources } = loadLabels(required("--labels").split(","), data);
  const source = required("--observations");
  const client = modelChoice();
  const resolver = client ? modelResolver(client) : rulesResolver;
  const budgetUsd = budgetFor(client);

  const interpreted =
    source === "labels"
      ? null
      : latestResults(
          readJsonl<InterpretationRecord>(
            assertOutsideRepo(
              path.join(sampleDir, "interpretations", `${source}.jsonl`),
            ),
          ),
        );
  const fixed = RESOLVER_GUIDE.length + JSON.stringify(RESOLUTION_JSON_SCHEMA).length;
  const reserveUsd = (request: Parameters<typeof renderResolution>[0]) => {
    if (!client) return 0;
    const asked = request.shortlists.flatMap((s, i) => (s.length > 0 ? [i] : []));
    if (asked.length === 0) return 0;
    const input =
      Math.ceil((fixed + renderResolution(request, asked).length) / 3) +
      (client.promptOverheadTokens ?? 0);
    return (
      (2 *
        (input * client.price.inputPerMTok +
          RESOLVER_MAX_OUTPUT_TOKENS * client.price.outputPerMTok)) /
      1e6
    );
  };

  const labelled = items.filter((i) => i.excluded == null && labels.has(i.messageId));
  const id = `${source}--${client ? client.id : "rules"}`;
  const dir = path.join(sampleDir, "resolutions");
  const file = path.join(dir, `${id}.jsonl`);
  const limit = argValue("--limit");
  const run = await runResolutions({
    data,
    items: labelled,
    resolver,
    observationsFor: (item, view) => {
      if (!interpreted) return observationsFromLabel(labels.get(item.messageId)!, view);
      const observations = interpreted.get(item.messageId);
      return observations ? observationsFromInterpretation(observations, view) : null;
    },
    file,
    budgetUsd,
    reserveUsd,
    concurrency: positiveInt("--concurrency", 4),
    limit: limit == null ? undefined : positiveInt("--limit", 0),
    log: (line) => console.error(line),
  });

  const names = new Map(data.parties.map((p) => [p.id, p.name]));
  const partyName = (pid: string) => names.get(pid) ?? pid;
  const results = latestProposals(readJsonl<ResolutionRecord>(file));
  const matcher = new Map<string, Proposal[]>(
    runBaseline(
      data.messages.filter((m) => labels.has(m.id)),
      data.parties,
    ).map((p) => [
      p.messageId,
      p.partyId
        ? [
            {
              observation: 0,
              intent: p.intents[0],
              decision: "link",
              partyId: p.partyId,
              reason: null,
              shortlist: [],
            },
          ]
        : [],
    ]),
  );
  const scored = (keep: (i: LabelItem) => boolean) => {
    const chosen = labelled.filter((i) => keep(i) && results.has(i.messageId));
    const gold = chosen.map((i) => labels.get(i.messageId)!);
    return {
      resolver: scoreResolutions(gold, results, partyName),
      currentMatcher: scoreResolutions(gold, matcher, partyName, { retrieval: false }),
    };
  };
  const report = {
    createdAt: new Date().toISOString(),
    repoRevision: repoRevision(),
    run,
    observations: source,
    labels: { sources, usable: labelled.length, answered: results.size },
    caveat:
      "Labels are mostly two models agreeing, with contested messages left out, so scores lean towards easier messages. The catalog is the one known when each message was sent, with today's names and aliases.",
    scores: {
      all: scored(() => true),
      random: scored((i) => i.set === "random"),
      challenge: scored((i) => i.set === "challenge"),
      heldOutTest: scored((i) => i.split === "test"),
    },
  };
  const out = path.join(
    dir,
    `report-${id}-${report.createdAt.replace(/[:.]/g, "-")}.json`,
  );
  writeJson(out, report);
  console.error(`wrote ${out}`);
  console.log(JSON.stringify(run, null, 2));
  if (run.abortedBy) throw new Error(`Stopped: ${run.abortedBy}`);
}

const COMMANDS: Record<string, () => Promise<void>> = {
  inventory,
  export: exportCommand,
  sample,
  baseline,
  label,
  models,
  draft,
  silver,
  interpret,
  resolve: resolveCommand,
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
