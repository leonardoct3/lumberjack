import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { ingestRawMessage } from "@/ingest/ingest";
import { pipelineStatus } from "@/pipeline/status";
import { resetDb } from "../helpers/db";

const now = new Date("2026-09-16T15:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MINUTE = 60_000;
const IDLE = {
  pending: 0,
  running: 0,
  succeeded: 0,
  dead: 0,
  due: 0,
  expiredLeases: 0,
  oldestWaitingSince: null,
};

async function capture(i: number) {
  await ingestRawMessage(
    prisma,
    {
      waMessageId: `wa-${i}`,
      groupWaId: "g-1",
      groupName: "g",
      senderWaId: `s-${i}`,
      senderName: null,
      sentAt: ago(i * MINUTE),
      text: `vendo ${i} pista`,
    },
    { interpret: true },
  );
  return prisma.processingJob.findFirstOrThrow({
    where: { idempotencyKey: { contains: `wa-${i}:` } },
  });
}

describe("pipelineStatus", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reports an empty pipeline without inventing a backlog", async () => {
    expect(await pipelineStatus(prisma, now)).toEqual({
      capture: { lastStoredAt: null, sessionState: null, heartbeatAt: null },
      jobs: { interpret: IDLE, resolve: IDLE },
      deadByKind: { interpret: {}, resolve: {} },
      proposals: { link: 0, new_event: 0, abstain: 0, not_mentioned: 0 },
      today: { succeeded: 0, failed: 0, costUsd: 0 },
    });
  });

  it("shows the backlog, what is stuck and why jobs died", async () => {
    const waiting = await capture(1);
    await prisma.processingJob.update({
      where: { id: waiting.id },
      data: { createdAt: ago(30 * MINUTE), runAfter: ago(MINUTE) },
    });
    const later = await capture(2);
    await prisma.processingJob.update({
      where: { id: later.id },
      data: { runAfter: new Date(now.getTime() + MINUTE) },
    });
    const stuck = await capture(3);
    await prisma.processingJob.update({
      where: { id: stuck.id },
      data: {
        status: "running",
        leaseOwner: "gone",
        leaseExpiresAt: ago(MINUTE),
        createdAt: ago(45 * MINUTE),
      },
    });
    const dead = await capture(4);
    await prisma.processingJob.update({
      where: { id: dead.id },
      data: { status: "dead", lastErrorKind: "refusal" },
    });
    await prisma.interpretationRun.create({
      data: {
        messageId: dead.messageId,
        stage: "interpret",
        pipelineVersion: "1",
        interpreter: "test",
        interpreterVersion: "1",
        schemaVersion: 1,
        inputHash: "i",
        contextHash: "c",
        status: "failed",
        failureKind: "refusal",
        costUsd: 0.02,
        latencyMs: 10,
        createdAt: ago(MINUTE),
      },
    });
    await prisma.waSession.create({
      data: { state: "connected", heartbeatAt: ago(2 * MINUTE) },
    });

    const status = await pipelineStatus(prisma, now);
    expect(status.capture.sessionState).toBe("connected");
    expect(status.capture.lastStoredAt).not.toBeNull();
    expect(status.jobs.resolve).toEqual(IDLE);
    expect(status.jobs.interpret).toEqual({
      pending: 2,
      running: 1,
      succeeded: 0,
      dead: 1,
      due: 1,
      expiredLeases: 1,
      oldestWaitingSince: ago(45 * MINUTE),
    });
    expect(status.deadByKind).toEqual({ interpret: { refusal: 1 }, resolve: {} });
    expect(status.today).toEqual({ succeeded: 0, failed: 1, costUsd: 0.02 });
  });
});
