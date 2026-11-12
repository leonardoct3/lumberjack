import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, ProcessingStage } from "@prisma/client";
import { startOfDaySp } from "@/domain/timezone";
import type { PipelineConfig } from "./config";
import { loadContext } from "./context";
import {
  InterpreterError,
  type CatalogEntry,
  type Interpreter,
  type InterpretationRequest,
  type InterpreterResult,
  type Usage,
} from "./interpreter";
import {
  INTERPRETATION_SCHEMA_VERSION,
  validateInterpretation,
  type InterpretedObservation,
} from "./observation";
import {
  claimJobs,
  completeJob,
  failJob,
  LeaseLostError,
  newJob,
  type ClaimedJob,
  type Failure,
} from "./queue";
import {
  prepareResolution,
  RESOLUTION_SCHEMA_VERSION,
  validateResolution,
  type ResolutionObservation,
  type ResolutionRequest,
  type Resolver,
} from "./resolution";

export type PassReport = {
  skipped: "off" | null;
  calls: number;
  reused: number;
  succeeded: number;
  retried: number;
  dead: number;
  leaseLost: number;
  budgetExhausted: boolean;
};

const ERROR_LIMIT = 1_000;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const catalogIdentity = (catalog: CatalogEntry[]) =>
  catalog.map((p) => [p.id, p.name, p.aliases, p.status, p.eventAt.toISOString()]);

export function requestHashes(request: InterpretationRequest) {
  return {
    inputHash: hash({ text: request.text, sentAt: request.sentAt.toISOString() }),
    contextHash: hash({
      senderRole: request.senderRole,
      context: request.context.map((c) => [c.id, c.sameGroup, c.sameSender]),
      catalog: catalogIdentity(request.catalog),
    }),
  };
}

/** Observation ids tie a cached resolution to the exact interpretation it read. */
export function resolutionHashes(request: ResolutionRequest, observationIds: string[]) {
  return {
    inputHash: hash({
      text: request.text,
      sentAt: request.sentAt.toISOString(),
      observations: observationIds,
    }),
    contextHash: hash({
      related: request.observations.map((o) => o.relatedText),
      catalog: catalogIdentity(request.catalog),
    }),
  };
}

async function spentToday(db: PrismaClient, now: Date): Promise<number> {
  const { _sum } = await db.interpretationRun.aggregate({
    where: { createdAt: { gte: startOfDaySp(now) } },
    _sum: { costUsd: true },
  });
  return _sum.costUsd ?? 0;
}

type Outcome =
  | { ok: true; result: InterpreterResult }
  | { ok: false; failure: Failure; usage?: Usage; output?: unknown };

async function call(
  invoke: (signal: AbortSignal) => Promise<InterpreterResult>,
  timeoutMs: number,
): Promise<Outcome> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new InterpreterError("timeout", `no answer within ${timeoutMs} ms`));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return {
      ok: true,
      result: await Promise.race([invoke(controller.signal), deadline]),
    };
  } catch (error) {
    // Aborting makes most clients reject with their own error; the deadline is still the cause.
    if (timedOut)
      return {
        ok: false,
        failure: { kind: "timeout", message: `no answer within ${timeoutMs} ms` },
      };
    if (error instanceof InterpreterError) {
      return {
        ok: false,
        failure: { kind: error.kind, message: error.message },
        usage: error.usage,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, failure: { kind: "internal", message } };
  } finally {
    clearTimeout(timer);
  }
}

function observationRow(
  observation: InterpretedObservation,
  position: number,
  messageId: string,
) {
  return {
    messageId,
    position,
    intent: observation.intent,
    eventMention: observation.eventMention,
    ticketCategory: observation.ticketCategory,
    quantity: observation.quantity,
    priceAmount: observation.price?.amount ?? null,
    priceCurrency: observation.price?.currency ?? null,
    priceMeaning: observation.price?.meaning ?? null,
    eventYear: observation.eventDate?.year ?? null,
    eventMonth: observation.eventDate?.month ?? null,
    eventDay: observation.eventDate?.day ?? null,
    dateBasis: observation.eventDate?.basis ?? null,
    spans: observation.spans,
    relationshipKind: observation.relationship.kind,
    relatedMessageId: observation.relationship.relatedMessage,
    ambiguities: observation.ambiguities,
  };
}

type Tx = Prisma.TransactionClient;
type RunRows = Pick<
  Prisma.InterpretationRunUncheckedCreateInput,
  "observations" | "resolutions"
>;

/** What one job needs once its inputs are loaded. */
type Prepared = {
  hashes: { inputHash: string; contextHash: string };
  invoke: (signal: AbortSignal) => Promise<InterpreterResult>;
  /** The rows a valid output becomes, or the checks it failed. */
  accept: (output: unknown) => { rows: RunRows } | { errors: string[] };
  /** Commits with the job, whether the run is new or reused. */
  onComplete?: (tx: Tx, runId: string) => Promise<void>;
};

type Stage = {
  stage: ProcessingStage;
  identity: {
    interpreter: string;
    interpreterVersion: string;
    provider: string | null;
    model: string | null;
    promptVersion: string | null;
    schemaVersion: number;
  };
  paid: boolean;
  prepare: (job: ClaimedJob) => Promise<Prepared | { failure: Failure }>;
};

function emptyReport(): PassReport {
  return {
    skipped: null,
    calls: 0,
    reused: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    leaseLost: 0,
    budgetExhausted: false,
  };
}

/**
 * One pass over a stage's queue. Jobs are claimed one at a time so a lease
 * never runs out while earlier calls in the same pass are still going.
 * Every call is recorded as a run, failed or not, because every call can cost.
 */
async function processStage(
  db: PrismaClient,
  options: { config: PipelineConfig; owner: string; clock: () => Date; stage: Stage },
): Promise<PassReport> {
  const { config, owner, clock, stage } = options;
  const { identity } = stage;
  const report = emptyReport();

  while (report.calls < config.maxCallsPerPass) {
    if (stage.paid && (await spentToday(db, clock())) >= config.dailyBudgetUsd) {
      report.budgetExhausted = true;
      break;
    }
    const [job] = await claimJobs(db, {
      owner,
      limit: 1,
      leaseMs: config.leaseMs,
      now: clock(),
      stage: stage.stage,
    });
    if (!job) break;

    const prepared = await stage.prepare(job);
    if ("failure" in prepared) {
      const result = await failJob(db, job, { owner, now: clock() }, prepared.failure);
      if (result === "retry") report.retried++;
      else if (result === "dead") report.dead++;
      else report.leaseLost++;
      continue;
    }
    const { hashes } = prepared;

    const cached = await db.interpretationRun.findFirst({
      where: {
        messageId: job.messageId,
        stage: job.stage,
        status: "succeeded",
        ...hashes,
        ...identity,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (cached) {
      await settle(report, () =>
        completeJob(db, job, { owner, now: clock() }, async (tx) => {
          await prepared.onComplete?.(tx, cached.id);
          return cached.id;
        }),
      );
      report.reused++;
      continue;
    }

    report.calls++;
    const started = performance.now();
    const outcome = await call(prepared.invoke, config.callTimeoutMs);
    const latencyMs = Math.round(performance.now() - started);
    const usage = outcome.ok ? outcome.result.usage : outcome.usage;
    const base = {
      jobId: job.id,
      messageId: job.messageId,
      stage: job.stage,
      pipelineVersion: job.pipelineVersion,
      ...identity,
      ...hashes,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd: usage?.costUsd ?? null,
      latencyMs,
      createdAt: clock(),
    };

    let failed: Extract<Outcome, { ok: false }>;
    if (!outcome.ok) {
      failed = outcome;
    } else {
      const output = outcome.result.output;
      const accepted = prepared.accept(output);
      if ("rows" in accepted) {
        const write = async (tx: Tx) => {
          const run = await tx.interpretationRun.create({
            data: {
              ...base,
              status: "succeeded",
              result: output as Prisma.InputJsonValue,
              ...accepted.rows,
            },
          });
          return run.id;
        };
        const kept = await settle(report, () =>
          completeJob(db, job, { owner, now: clock() }, async (tx) => {
            const runId = await write(tx);
            await prepared.onComplete?.(tx, runId);
            return runId;
          }),
        );
        // The call was paid for either way; keeping the run lets the job's new owner reuse it.
        if (!kept) await db.$transaction(write);
        continue;
      }
      failed = {
        ok: false,
        failure: { kind: "schema", message: accepted.errors.join("; ") },
        output,
      };
    }

    await db.interpretationRun.create({
      data: {
        ...base,
        status: "failed",
        failureKind: failed.failure.kind,
        error: failed.failure.message.slice(0, ERROR_LIMIT),
        ...(failed.output === undefined
          ? {}
          : { result: failed.output as Prisma.InputJsonValue }),
      },
    });
    const result = await failJob(db, job, { owner, now: clock() }, failed.failure);
    if (result === "retry") report.retried++;
    else if (result === "dead") report.dead++;
    else report.leaseLost++;
  }

  return report;
}

async function upcomingCatalog(db: PrismaClient): Promise<CatalogEntry[]> {
  return db.party.findMany({
    where: { status: "upcoming" },
    select: { id: true, name: true, aliases: true, status: true, eventAt: true },
    orderBy: { id: "asc" },
  });
}

/**
 * Interpretation pass. With resolution in shadow, a message that names
 * anything gets its resolve job in the same transaction as the result.
 */
export async function processInterpretation(
  db: PrismaClient,
  options: {
    config: PipelineConfig;
    interpreter: Interpreter;
    owner: string;
    clock?: () => Date;
  },
): Promise<PassReport> {
  const { config, interpreter, owner } = options;
  if (config.interpret === "off") return { ...emptyReport(), skipped: "off" };
  const catalog = await upcomingCatalog(db);
  const clock = options.clock ?? (() => new Date());

  return processStage(db, {
    config,
    owner,
    clock,
    stage: {
      stage: "interpret",
      paid: interpreter.paid,
      identity: {
        interpreter: interpreter.name,
        interpreterVersion: interpreter.version,
        provider: interpreter.provider,
        model: interpreter.model,
        promptVersion: interpreter.promptVersion,
        schemaVersion: INTERPRETATION_SCHEMA_VERSION,
      },
      async prepare(job) {
        const message = await db.message.findUniqueOrThrow({
          where: { id: job.messageId },
          select: {
            id: true,
            waMessageId: true,
            groupId: true,
            senderId: true,
            text: true,
            sentAt: true,
            sender: { select: { role: true } },
          },
        });
        const request: InterpretationRequest = {
          text: message.text,
          sentAt: message.sentAt,
          senderRole: message.sender.role,
          context: await loadContext(db, message),
          catalog,
        };
        return {
          hashes: requestHashes(request),
          invoke: (signal) => interpreter.interpret(request, signal),
          accept(output) {
            const { observations, errors } = validateInterpretation(output, request);
            if (!observations) return { errors };
            return {
              rows: {
                observations: {
                  create: observations.map((o, i) =>
                    observationRow(o, i, job.messageId),
                  ),
                },
              },
            };
          },
          async onComplete(tx, runId) {
            if (config.resolve === "off") return;
            const named = await tx.observation.count({
              where: { runId, intent: { not: "unrelated" } },
            });
            if (named === 0) return;
            await tx.processingJob.createMany({
              data: [
                {
                  ...newJob("resolve", message.waMessageId),
                  messageId: job.messageId,
                  runAfter: clock(),
                },
              ],
              skipDuplicates: true,
            });
          },
        };
      },
    },
  });
}

/** Resolution pass: retrieval in code, then the resolver chooses from the shortlist or abstains. */
export async function processResolution(
  db: PrismaClient,
  options: {
    config: PipelineConfig;
    resolver: Resolver;
    owner: string;
    clock?: () => Date;
  },
): Promise<PassReport> {
  const { config, resolver, owner } = options;
  if (config.resolve === "off") return { ...emptyReport(), skipped: "off" };
  const catalog = await upcomingCatalog(db);

  return processStage(db, {
    config,
    owner,
    clock: options.clock ?? (() => new Date()),
    stage: {
      stage: "resolve",
      paid: resolver.paid,
      identity: {
        interpreter: resolver.name,
        interpreterVersion: resolver.version,
        provider: resolver.provider,
        model: resolver.model,
        promptVersion: resolver.promptVersion,
        schemaVersion: RESOLUTION_SCHEMA_VERSION,
      },
      async prepare(job) {
        const interpretation = await db.processingJob.findFirst({
          where: {
            messageId: job.messageId,
            stage: "interpret",
            status: "succeeded",
            pipelineVersion: job.pipelineVersion,
          },
          select: {
            message: { select: { text: true, sentAt: true } },
            resultRun: {
              select: { observations: { orderBy: { position: "asc" } } },
            },
          },
        });
        if (!interpretation?.resultRun)
          return {
            failure: {
              kind: "internal",
              message: "no accepted interpretation for this message",
            },
          };
        const { message } = interpretation;
        const rows = interpretation.resultRun.observations;
        const relatedIds = [
          ...new Set(
            rows.flatMap((o) => (o.relatedMessageId ? [o.relatedMessageId] : [])),
          ),
        ];
        const related = new Map(
          (
            await db.message.findMany({
              where: { id: { in: relatedIds } },
              select: { id: true, text: true },
            })
          ).map((m) => [m.id, m.text]),
        );
        const observations: ResolutionObservation[] = rows.map((o) => ({
          position: o.position,
          intent: o.intent,
          eventMention: o.eventMention,
          ticketCategory: o.ticketCategory,
          eventDate:
            o.dateBasis == null
              ? null
              : {
                  year: o.eventYear,
                  month: o.eventMonth,
                  day: o.eventDay,
                  basis: o.dateBasis,
                },
          relatedText: o.relatedMessageId
            ? (related.get(o.relatedMessageId) ?? null)
            : null,
        }));
        const request = prepareResolution({
          text: message.text,
          sentAt: message.sentAt,
          observations,
          catalog,
        });
        return {
          hashes: resolutionHashes(
            request,
            rows.map((o) => o.id),
          ),
          invoke: (signal) => resolver.resolve(request, signal),
          accept(output) {
            const { resolutions, errors } = validateResolution(output, request);
            if (!resolutions) return { errors };
            return {
              rows: {
                resolutions: {
                  create: resolutions.map((r) => ({
                    observationId: rows[r.observation].id,
                    messageId: job.messageId,
                    decision: r.decision,
                    partyId: r.partyId,
                    reason: r.reason,
                    candidates: request.shortlists[r.observation].map((c) => ({
                      partyId: c.partyId,
                      score: c.score,
                      reasons: c.reasons,
                    })),
                  })),
                },
              },
            };
          },
        };
      },
    },
  });
}

async function settle(
  report: PassReport,
  complete: () => Promise<string>,
): Promise<boolean> {
  try {
    await complete();
    report.succeeded++;
    return true;
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
    report.leaseLost++;
    return false;
  }
}
