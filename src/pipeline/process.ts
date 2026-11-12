import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
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
import { claimJobs, completeJob, failJob, LeaseLostError, type Failure } from "./queue";

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

export function requestHashes(request: InterpretationRequest) {
  return {
    inputHash: hash({ text: request.text, sentAt: request.sentAt.toISOString() }),
    contextHash: hash({
      senderRole: request.senderRole,
      context: request.context.map((c) => [c.id, c.sameGroup, c.sameSender]),
      catalog: request.catalog.map((p) => [
        p.id,
        p.name,
        p.aliases,
        p.status,
        p.eventAt.toISOString(),
      ]),
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
  interpreter: Interpreter,
  request: InterpretationRequest,
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
      result: await Promise.race([
        interpreter.interpret(request, controller.signal),
        deadline,
      ]),
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

/**
 * One pass over the interpretation queue. Jobs are claimed one at a time so a
 * lease never runs out while earlier calls in the same pass are still going.
 * Every call is recorded as a run, failed or not, because every call can cost.
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
  const clock = options.clock ?? (() => new Date());
  const report: PassReport = {
    skipped: null,
    calls: 0,
    reused: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    leaseLost: 0,
    budgetExhausted: false,
  };
  if (config.interpret === "off") return { ...report, skipped: "off" };

  const catalog: CatalogEntry[] = await db.party.findMany({
    where: { status: "upcoming" },
    select: { id: true, name: true, aliases: true, status: true, eventAt: true },
    orderBy: { id: "asc" },
  });
  const identity = {
    interpreter: interpreter.name,
    interpreterVersion: interpreter.version,
    provider: interpreter.provider,
    model: interpreter.model,
    promptVersion: interpreter.promptVersion,
    schemaVersion: INTERPRETATION_SCHEMA_VERSION,
  };

  while (report.calls < config.maxCallsPerPass) {
    if (interpreter.paid && (await spentToday(db, clock())) >= config.dailyBudgetUsd) {
      report.budgetExhausted = true;
      break;
    }
    const [job] = await claimJobs(db, {
      owner,
      limit: 1,
      leaseMs: config.leaseMs,
      now: clock(),
    });
    if (!job) break;

    const message = await db.message.findUniqueOrThrow({
      where: { id: job.messageId },
      select: {
        id: true,
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
    const hashes = requestHashes(request);

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
        completeJob(db, job, { owner, now: clock() }, async () => cached.id),
      );
      report.reused++;
      continue;
    }

    report.calls++;
    const started = performance.now();
    const outcome = await call(interpreter, request, config.callTimeoutMs);
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
      const { observations, errors } = validateInterpretation(output, request);
      if (observations) {
        const write = async (tx: Prisma.TransactionClient) => {
          const run = await tx.interpretationRun.create({
            data: {
              ...base,
              status: "succeeded",
              result: output as Prisma.InputJsonValue,
              observations: {
                create: observations.map((o, i) => observationRow(o, i, job.messageId)),
              },
            },
          });
          return run.id;
        };
        const accepted = await settle(report, () =>
          completeJob(db, job, { owner, now: clock() }, write),
        );
        // The call was paid for either way; keeping the run lets the job's new owner reuse it.
        if (!accepted) await db.$transaction(write);
        continue;
      }
      failed = {
        ok: false,
        failure: { kind: "schema", message: errors.join("; ") },
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
