import {
  Prisma,
  type FailureKind,
  type PrismaClient,
  type ProcessingStage,
} from "@prisma/client";
import { PIPELINE_VERSION } from "./config";

/** Keyed on the WhatsApp id, which exists before the row does and never changes. */
export function jobKey(
  stage: ProcessingStage,
  waMessageId: string,
  pipelineVersion: string = PIPELINE_VERSION,
): string {
  return `${stage}:${waMessageId}:p${pipelineVersion}`;
}

export function newJob(stage: ProcessingStage, waMessageId: string) {
  return {
    stage,
    idempotencyKey: jobKey(stage, waMessageId),
    pipelineVersion: PIPELINE_VERSION,
  };
}

/**
 * Queues stored messages that capture never queued: history from before the
 * pipeline, or a new pipeline version. Copies and muted senders are skipped,
 * as at capture, and an existing key is left alone.
 */
export async function enqueueInterpretation(
  db: PrismaClient,
  window: { from: Date; to: Date },
): Promise<{ candidates: number; queued: number }> {
  const messages = await db.message.findMany({
    where: {
      sentAt: { gte: window.from, lt: window.to },
      duplicateOfId: null,
      sender: { muted: false },
    },
    select: { id: true, waMessageId: true },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
  });
  const { count } = await db.processingJob.createMany({
    data: messages.map((m) => ({
      ...newJob("interpret", m.waMessageId),
      messageId: m.id,
    })),
    skipDuplicates: true,
  });
  return { candidates: messages.length, queued: count };
}

/**
 * Queues resolution for messages interpreted before it was switched on.
 * Only accepted interpretations that name something; running it twice queues nothing new.
 */
export async function enqueueResolution(
  db: PrismaClient,
): Promise<{ candidates: number; queued: number }> {
  const interpreted = await db.processingJob.findMany({
    where: {
      stage: "interpret",
      status: "succeeded",
      pipelineVersion: PIPELINE_VERSION,
      resultRun: { observations: { some: { intent: { not: "unrelated" } } } },
    },
    select: { messageId: true, message: { select: { waMessageId: true } } },
    orderBy: { id: "asc" },
  });
  const { count } = await db.processingJob.createMany({
    data: interpreted.map((j) => ({
      ...newJob("resolve", j.message.waMessageId),
      messageId: j.messageId,
    })),
    skipDuplicates: true,
  });
  return { candidates: interpreted.length, queued: count };
}

export type ClaimedJob = {
  id: string;
  messageId: string;
  stage: ProcessingStage;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  pipelineVersion: string;
};

export type Lease = { owner: string; now: Date };

export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lease on job ${jobId} was lost; another worker owns it now.`);
  }
}

/** Columns are UTC timestamps without a zone; never let the session zone shift a bound date. */
const utc = (date: Date) =>
  Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * Leases due jobs, including ones whose worker died mid-lease. The attempt is
 * counted at claim time, so a job that keeps crashing its worker still runs out.
 */
export async function claimJobs(
  db: PrismaClient,
  options: {
    owner: string;
    limit: number;
    leaseMs: number;
    now: Date;
    stage?: ProcessingStage;
  },
): Promise<ClaimedJob[]> {
  const stage = options.stage ?? "interpret";
  const now = utc(options.now);
  const leaseUntil = utc(new Date(options.now.getTime() + options.leaseMs));

  await db.$executeRaw`
    UPDATE "ProcessingJob"
    SET status = 'dead', "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
        "lastErrorKind" = 'timeout', "lastError" = 'lease expired on the final attempt',
        "completedAt" = ${now}, "updatedAt" = ${now}
    WHERE stage = ${stage}::"ProcessingStage" AND status = 'running'
      AND "leaseExpiresAt" < ${now} AND attempts >= "maxAttempts"`;

  const claimed = await db.$queryRaw<ClaimedJob[]>`
    UPDATE "ProcessingJob"
    SET status = 'running', "leaseOwner" = ${options.owner}, "leaseExpiresAt" = ${leaseUntil},
        attempts = attempts + 1, "updatedAt" = ${now}
    WHERE id IN (
      SELECT id FROM "ProcessingJob"
      WHERE stage = ${stage}::"ProcessingStage" AND attempts < "maxAttempts"
        AND ((status = 'pending' AND "runAfter" <= ${now})
          OR (status = 'running' AND "leaseExpiresAt" < ${now}))
      ORDER BY "runAfter", id
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "messageId", stage::text AS stage, attempts, "maxAttempts",
              "idempotencyKey", "pipelineVersion"`;
  return claimed.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The result and the job's completion commit together, and only while this
 * worker still holds the lease; otherwise nothing it wrote survives.
 */
export async function completeJob(
  db: PrismaClient,
  job: ClaimedJob,
  lease: Lease,
  persist: (tx: Prisma.TransactionClient) => Promise<string>,
): Promise<string> {
  return db.$transaction(async (tx) => {
    const runId = await persist(tx);
    const { count } = await tx.processingJob.updateMany({
      where: { id: job.id, leaseOwner: lease.owner, status: "running" },
      data: {
        status: "succeeded",
        resultRunId: runId,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorKind: null,
        lastError: null,
        completedAt: lease.now,
      },
    });
    if (count === 0) throw new LeaseLostError(job.id);
    return runId;
  });
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;
/** Malformed output gets one more try: models are not deterministic, but a broken prompt stays broken. */
const SCHEMA_ATTEMPTS = 2;

export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
}

export type Failure = { kind: FailureKind; message: string };

function retryable(kind: FailureKind, attempts: number, maxAttempts: number): boolean {
  if (attempts >= maxAttempts) return false;
  // A provider out of quota or credit recovers on its own, like an outage.
  if (kind === "transient" || kind === "timeout" || kind === "budget") return true;
  if (kind === "schema") return attempts < SCHEMA_ATTEMPTS;
  // A refusal repeats itself and an internal error is a bug to look at, not to retry.
  return false;
}

export async function failJob(
  db: PrismaClient,
  job: ClaimedJob,
  lease: Lease,
  failure: Failure,
): Promise<"retry" | "dead" | "lease_lost"> {
  const retry = retryable(failure.kind, job.attempts, job.maxAttempts);
  const { count } = await db.processingJob.updateMany({
    where: { id: job.id, leaseOwner: lease.owner, status: "running" },
    data: {
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorKind: failure.kind,
      lastError: failure.message.slice(0, 1_000),
      ...(retry
        ? {
            status: "pending",
            runAfter: new Date(lease.now.getTime() + backoffMs(job.attempts)),
          }
        : { status: "dead", completedAt: lease.now }),
    },
  });
  if (count === 0) return "lease_lost";
  return retry ? "retry" : "dead";
}
