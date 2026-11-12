import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { ingestRawMessage } from "@/ingest/ingest";
import { loadPipelineConfig, type PipelineConfig } from "@/pipeline/config";
import type { InterpretationRequest, InterpreterResult } from "@/pipeline/interpreter";
import { processInterpretation, processResolution } from "@/pipeline/process";
import { enqueueResolution } from "@/pipeline/queue";
import type { ResolutionRequest, Resolver } from "@/pipeline/resolution";
import { rulesResolver } from "@/pipeline/resolvers/rules";
import { resetDb } from "../helpers/db";

const t0 = new Date("2026-09-16T15:00:00Z");
const clock = () => t0;

function config(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    ...loadPipelineConfig({ PIPELINE_INTERPRET: "shadow", PIPELINE_RESOLVE: "shadow" }),
    ...overrides,
  };
}

/** Says the message is an offer for whatever event its first word names. */
const interpreter = {
  name: "fake",
  version: "1",
  provider: null,
  model: null,
  promptVersion: null,
  paid: false,
  async interpret(request: InterpretationRequest): Promise<InterpreterResult> {
    const unrelated = request.text.startsWith("bom dia");
    const mention = request.text.split(" ")[1];
    return {
      output: {
        observations: [
          {
            intent: unrelated ? "unrelated" : "offer",
            eventMention: unrelated ? null : mention,
            ticketCategory: null,
            quantity: null,
            price: null,
            eventDate: null,
            spans: unrelated
              ? []
              : [{ start: 0, end: 5, text: request.text.slice(0, 5) }],
            relationship: { kind: "none", relatedMessage: null },
            ambiguities: [],
          },
        ],
      },
    };
  },
};

function counting(resolver: Resolver) {
  const wrapped = {
    ...resolver,
    calls: 0,
    seen: [] as ResolutionRequest[],
    async resolve(request: ResolutionRequest, signal: AbortSignal) {
      wrapped.calls++;
      wrapped.seen.push(request);
      return resolver.resolve(request, signal);
    },
  };
  return wrapped;
}

async function capture(id: string, text: string) {
  await ingestRawMessage(
    prisma,
    {
      waMessageId: id,
      groupWaId: "g-1",
      groupName: "g",
      senderWaId: `s-${id}`,
      senderName: null,
      sentAt: new Date(t0.getTime() - 60_000),
      text,
    },
    { interpret: true },
  );
  await prisma.processingJob.updateMany({ data: { runAfter: t0 } });
}

const interpret = (overrides: Partial<PipelineConfig> = {}) =>
  processInterpretation(prisma, {
    config: config(overrides),
    interpreter,
    owner: "w1",
    clock,
  });
const resolve = (resolver: Resolver, overrides: Partial<PipelineConfig> = {}) =>
  processResolution(prisma, {
    config: config(overrides),
    resolver,
    owner: "w1",
    clock,
  });

describe("processResolution", () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.party.create({
      data: {
        id: "p-tarde",
        name: "Tardezinha",
        aliases: [],
        eventAt: new Date("2026-09-27T23:00:00-03:00"),
      },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("queues resolution with the interpretation, only for messages that name something", async () => {
    await capture("wa-1", "vendo tardezinha pista");
    await capture("wa-2", "bom dia grupo");
    await interpret();
    const jobs = await prisma.processingJob.findMany({
      where: { stage: "resolve" },
      select: { idempotencyKey: true },
    });
    expect(jobs).toEqual([{ idempotencyKey: "resolve:wa-1:p1" }]);
  });

  it("queues nothing while resolution is off, and catches up later without duplicates", async () => {
    await capture("wa-1", "vendo tardezinha pista");
    await interpret({ resolve: "off" });
    expect(await prisma.processingJob.count({ where: { stage: "resolve" } })).toBe(0);
    expect(await enqueueResolution(prisma)).toEqual({ candidates: 1, queued: 1 });
    expect(await enqueueResolution(prisma)).toEqual({ candidates: 1, queued: 0 });
  });

  it("writes a proposal with its shortlist and leaves the board alone", async () => {
    await capture("wa-1", "vendo tardezinha pista");
    await interpret();
    const board = () =>
      Promise.all([
        prisma.message.findMany({ select: { id: true, partyId: true, class: true } }),
        prisma.signal.findMany(),
      ]);
    const before = await board();
    const report = await resolve(rulesResolver);
    expect(report).toMatchObject({ calls: 1, succeeded: 1, dead: 0 });
    expect(await board()).toEqual(before);

    const [proposal] = await prisma.resolutionProposal.findMany({
      include: { observation: { select: { eventMention: true } } },
    });
    expect(proposal).toMatchObject({
      decision: "link",
      partyId: "p-tarde",
      observation: { eventMention: "tardezinha" },
      candidates: [{ partyId: "p-tarde", reasons: ["mention:exact"] }],
    });
    const run = await prisma.interpretationRun.findUniqueOrThrow({
      where: { id: proposal.runId },
    });
    expect(run).toMatchObject({
      stage: "resolve",
      interpreter: "rules",
      schemaVersion: 1,
    });
  });

  it("does nothing while resolution is off", async () => {
    await capture("wa-1", "vendo tardezinha pista");
    await interpret();
    const resolver = counting(rulesResolver);
    expect(await resolve(resolver, { resolve: "off" })).toMatchObject({
      skipped: "off",
    });
    expect(resolver.calls).toBe(0);
  });

  it("reuses an identical earlier resolution instead of resolving again", async () => {
    await capture("wa-1", "vendo tardezinha pista");
    await interpret();
    const resolver = counting(rulesResolver);
    await resolve(resolver);
    await prisma.processingJob.updateMany({
      where: { stage: "resolve" },
      data: { status: "pending", completedAt: null, attempts: 0 },
    });
    const again = await resolve(resolver);
    expect(again).toMatchObject({ calls: 0, reused: 1, succeeded: 1 });
    expect(resolver.calls).toBe(1);
  });

  it("refuses an answer that links outside the shortlist, and retries it", async () => {
    await capture("wa-1", "vendo tardezinha pista");
    await interpret();
    const report = await resolve({
      ...rulesResolver,
      async resolve() {
        return {
          output: {
            resolutions: [
              { observation: 0, decision: "link", partyId: "elsewhere", reason: null },
            ],
          },
        };
      },
    });
    expect(report).toMatchObject({ calls: 1, succeeded: 0, retried: 1 });
    expect(await prisma.resolutionProposal.count()).toBe(0);
    const failed = await prisma.interpretationRun.findFirstOrThrow({
      where: { stage: "resolve" },
    });
    expect(failed).toMatchObject({ status: "failed", failureKind: "schema" });
    expect(failed.error).toContain("not shortlisted");
  });

  it("sends a resolve job without an accepted interpretation to the dead letters", async () => {
    await capture("wa-1", "vendo tardezinha pista");
    await interpret({ resolve: "off" });
    await enqueueResolution(prisma);
    await prisma.processingJob.updateMany({ data: { runAfter: t0 } });
    await prisma.processingJob.updateMany({
      where: { stage: "interpret" },
      data: { status: "dead" },
    });
    const resolver = counting(rulesResolver);
    expect(await resolve(resolver)).toMatchObject({ dead: 1, calls: 0 });
    expect(resolver.calls).toBe(0);
    expect(
      await prisma.processingJob.findFirstOrThrow({ where: { stage: "resolve" } }),
    ).toMatchObject({ status: "dead", lastErrorKind: "internal" });
  });
});
