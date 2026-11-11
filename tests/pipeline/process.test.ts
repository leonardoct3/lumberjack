import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { ingestRawMessage } from "@/ingest/ingest";
import { loadPipelineConfig, type PipelineConfig } from "@/pipeline/config";
import {
  InterpreterError,
  type Interpreter,
  type InterpretationRequest,
  type InterpreterResult,
} from "@/pipeline/interpreter";
import { rulesInterpreter } from "@/pipeline/interpreters/rules";
import { processInterpretation } from "@/pipeline/process";
import { enqueueInterpretation, jobKey } from "@/pipeline/queue";
import { resetDb } from "../helpers/db";

const t0 = new Date("2026-09-16T15:00:00Z");
const HOUR = 60 * 60 * 1000;

let now = t0;
const clock = () => now;

function config(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return { ...loadPipelineConfig({ PIPELINE_INTERPRET: "shadow" }), ...overrides };
}

function valid(request: InterpretationRequest): InterpreterResult {
  return {
    output: {
      observations: [
        {
          intent: "offer",
          eventMention: null,
          ticketCategory: null,
          quantity: 1,
          price: null,
          eventDate: null,
          spans: [{ start: 0, end: 5, text: request.text.slice(0, 5) }],
          relationship: { kind: "none", relatedMessage: null },
          ambiguities: [],
        },
      ],
    },
  };
}

function fake(
  behave: (
    request: InterpretationRequest,
    signal: AbortSignal,
  ) => Promise<InterpreterResult> | InterpreterResult,
  overrides: Partial<Interpreter> = {},
) {
  const interpreter = {
    name: "fake",
    version: "1",
    provider: null,
    model: null,
    promptVersion: null,
    paid: false,
    calls: 0,
    async interpret(request: InterpretationRequest, signal: AbortSignal) {
      interpreter.calls++;
      return behave(request, signal);
    },
    ...overrides,
  };
  return interpreter;
}

async function capture(count: number, options = { interpret: true }) {
  for (let i = 0; i < count; i++) {
    await ingestRawMessage(
      prisma,
      {
        waMessageId: `wa-${i}`,
        groupWaId: "g-1",
        groupName: "g",
        senderWaId: `s-${i}`,
        senderName: null,
        sentAt: new Date(t0.getTime() - HOUR + i),
        text: `vendo ${i} pista festa junina`,
      },
      options,
    );
  }
  await prisma.processingJob.updateMany({ data: { runAfter: t0 } });
}

const pass = (interpreter: Interpreter, overrides: Partial<PipelineConfig> = {}) =>
  processInterpretation(prisma, {
    config: config(overrides),
    interpreter,
    owner: "w1",
    clock,
  });

describe("processInterpretation", () => {
  beforeEach(async () => {
    await resetDb(prisma);
    now = t0;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("hands the interpreter the group's last day and the sender's last week, earlier only", async () => {
    const send = (id: string, group: string, sender: string, hoursAgo: number) =>
      ingestRawMessage(
        prisma,
        {
          waMessageId: id,
          groupWaId: group,
          groupName: group,
          senderWaId: sender,
          senderName: null,
          sentAt: new Date(t0.getTime() - hoursAgo * HOUR),
          text: `msg ${id}`,
        },
        { interpret: id === "target" },
      );
    await send("same-group", "g-1", "s-other", 20);
    await send("group-too-old", "g-1", "s-other", 30);
    await send("same-sender", "g-2", "s-1", 100);
    await send("sender-too-old", "g-2", "s-1", 200);
    await send("elsewhere", "g-3", "s-3", 2);
    await send("later", "g-1", "s-1", 0);
    await send("target", "g-1", "s-1", 1);
    await prisma.processingJob.updateMany({ data: { runAfter: t0 } });

    let seen: InterpretationRequest | undefined;
    await pass(
      fake((request) => {
        seen = request;
        return valid(request);
      }),
    );
    expect(seen!.context.map((c) => [c.text, c.sameGroup, c.sameSender])).toEqual([
      ["msg same-group", true, false],
      ["msg same-sender", false, true],
    ]);
  });

  it("does nothing while interpretation is off", async () => {
    await capture(1);
    const interpreter = fake(valid);
    const report = await pass(interpreter, { interpret: "off" });
    expect(report.skipped).toBe("off");
    expect(interpreter.calls).toBe(0);
  });

  it("interprets a captured message with the rules, beside the board and not on it", async () => {
    await prisma.party.create({
      data: {
        name: "Festa Junina",
        aliases: [],
        eventAt: new Date("2026-09-20T03:00:00Z"),
      },
    });
    await capture(1);
    const signalsBefore = await prisma.signal.findMany({ orderBy: { id: "asc" } });

    const report = await pass(rulesInterpreter);
    expect(report).toMatchObject({ calls: 1, succeeded: 1 });

    const job = await prisma.processingJob.findFirstOrThrow({
      include: { resultRun: true },
    });
    expect(job.status).toBe("succeeded");
    expect(job.resultRun).toMatchObject({
      status: "succeeded",
      interpreter: "rules",
      costUsd: null,
    });
    const observations = await prisma.observation.findMany();
    expect(observations).toEqual([
      expect.objectContaining({
        intent: "offer",
        eventMention: "Festa Junina",
        position: 0,
      }),
    ]);
    expect(await prisma.signal.findMany({ orderBy: { id: "asc" } })).toEqual(
      signalsBefore,
    );
  });

  it("rides out a provider outage and picks up where it left off", async () => {
    await capture(1);
    let down = 2;
    const interpreter = fake((request) => {
      if (down-- > 0) throw new InterpreterError("transient", "503 from provider");
      return valid(request);
    });

    for (let i = 0; i < 3; i++) {
      await pass(interpreter);
      now = new Date(now.getTime() + 2 * HOUR);
    }

    expect(await prisma.processingJob.findFirstOrThrow()).toMatchObject({
      status: "succeeded",
      attempts: 3,
    });
    const runs = await prisma.interpretationRun.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(runs.map((run) => [run.status, run.failureKind])).toEqual([
      ["failed", "transient"],
      ["failed", "transient"],
      ["succeeded", null],
    ]);
  });

  it("dead-letters a job once the outage outlasts its attempts", async () => {
    await capture(1);
    const interpreter = fake(() => {
      throw new InterpreterError("transient", "503 from provider");
    });
    for (let i = 0; i < 6; i++) {
      await pass(interpreter);
      now = new Date(now.getTime() + 2 * HOUR);
    }
    expect(interpreter.calls).toBe(5);
    expect(await prisma.processingJob.findFirstOrThrow()).toMatchObject({
      status: "dead",
      lastErrorKind: "transient",
    });
  });

  it("gives up on a call that hangs, and tries it again later", async () => {
    await capture(1);
    const interpreter = fake(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const report = await pass(interpreter, { callTimeoutMs: 100 });

    expect(report.retried).toBe(1);
    expect(await prisma.interpretationRun.findFirstOrThrow()).toMatchObject({
      status: "failed",
      failureKind: "timeout",
    });
  });

  it("keeps output that fails the evidence checks out of the observations", async () => {
    await capture(1);
    const interpreter = fake((request) => {
      const result = valid(request) as {
        output: { observations: { spans: unknown[] }[] };
      };
      result.output.observations[0].spans = [];
      return result;
    });
    await pass(interpreter);

    const run = await prisma.interpretationRun.findFirstOrThrow();
    expect(run).toMatchObject({ status: "failed", failureKind: "schema" });
    expect(run.error).toMatch(/supporting span/);
    expect(run.result).not.toBeNull();
    expect(await prisma.observation.count()).toBe(0);
    expect((await prisma.processingJob.findFirstOrThrow()).status).toBe("pending");
  });

  it("replays history the capture never queued, once", async () => {
    await capture(3, { interpret: false });
    const window = { from: new Date(t0.getTime() - 2 * HOUR), to: t0 };
    expect(await enqueueInterpretation(prisma, window)).toEqual({
      candidates: 3,
      queued: 3,
    });
    await prisma.processingJob.updateMany({ data: { runAfter: t0 } });

    const interpreter = fake(valid);
    expect(await pass(interpreter)).toMatchObject({ calls: 3, succeeded: 3 });

    expect(await enqueueInterpretation(prisma, window)).toEqual({
      candidates: 3,
      queued: 0,
    });
    expect(await pass(interpreter)).toMatchObject({ calls: 0 });
    expect(await prisma.interpretationRun.count()).toBe(3);
  });

  it("reuses an identical earlier run instead of paying for it twice", async () => {
    await capture(1);
    const interpreter = fake(valid);
    await pass(interpreter);
    const first = await prisma.processingJob.findFirstOrThrow();

    // A pipeline version bump queues the message again under a new key.
    await prisma.processingJob.create({
      data: {
        stage: "interpret",
        messageId: first.messageId,
        idempotencyKey: jobKey("interpret", "wa-0", "2"),
        pipelineVersion: "2",
        runAfter: t0,
      },
    });
    const report = await pass(interpreter);

    expect(report).toMatchObject({ calls: 0, reused: 1, succeeded: 1 });
    expect(interpreter.calls).toBe(1);
    const jobs = await prisma.processingJob.findMany();
    expect(new Set(jobs.map((job) => job.resultRunId))).toEqual(
      new Set([first.resultRunId]),
    );
  });

  it("calls again when the interpreter version changes", async () => {
    await capture(1);
    await pass(fake(valid));
    const first = await prisma.processingJob.findFirstOrThrow();
    await prisma.processingJob.create({
      data: {
        stage: "interpret",
        messageId: first.messageId,
        idempotencyKey: jobKey("interpret", "wa-0", "2"),
        pipelineVersion: "2",
        runAfter: t0,
      },
    });
    const upgraded = fake(valid, { version: "2" });
    await pass(upgraded);
    expect(upgraded.calls).toBe(1);
  });

  it("spends nothing on a paid interpreter without a budget", async () => {
    await capture(2);
    const interpreter = fake(valid, { paid: true });
    const report = await pass(interpreter, { dailyBudgetUsd: 0 });

    expect(report).toMatchObject({ calls: 0, budgetExhausted: true });
    expect(await prisma.processingJob.findMany()).toEqual([
      expect.objectContaining({ status: "pending", attempts: 0 }),
      expect.objectContaining({ status: "pending", attempts: 0 }),
    ]);
  });

  it("stops paying once today's runs cost the budget, failed ones included", async () => {
    await capture(4);
    let first = true;
    const interpreter = fake(
      (request) => {
        const usage = { inputTokens: 100, outputTokens: 50, costUsd: 0.01 };
        if (first) {
          first = false;
          throw new InterpreterError("transient", "503", usage);
        }
        return { ...valid(request), usage };
      },
      { paid: true },
    );
    const report = await pass(interpreter, { dailyBudgetUsd: 0.025 });

    expect(report).toMatchObject({ calls: 3, budgetExhausted: true });
    const runs = await prisma.interpretationRun.findMany();
    expect(runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0)).toBeCloseTo(0.03);
  });

  it("caps the calls one pass may make", async () => {
    await capture(3);
    const report = await pass(fake(valid), { maxCallsPerPass: 2 });
    expect(report.calls).toBe(2);
    expect(await prisma.processingJob.count({ where: { status: "pending" } })).toBe(1);
  });
});
