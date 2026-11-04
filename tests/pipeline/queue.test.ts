import type { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { ingestRawMessage } from "@/ingest/ingest";
import {
  backoffMs,
  claimJobs,
  completeJob,
  failJob,
  LeaseLostError,
} from "@/pipeline/queue";
import { resetDb } from "../helpers/db";

const t0 = new Date("2026-09-16T15:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const LEASE = 60_000;

async function queue(count: number) {
  for (let i = 0; i < count; i++) {
    await ingestRawMessage(
      prisma,
      {
        waMessageId: `wa-${i}`,
        groupWaId: "g-1",
        groupName: "g",
        senderWaId: `s-${i}`,
        senderName: null,
        sentAt: at(i),
        text: `vendo ${i} pista`,
      },
      { interpret: true },
    );
  }
  // Capture stamps runAfter with the wall clock; pin it so the tests own time.
  await prisma.processingJob.updateMany({ data: { runAfter: t0 } });
}

function persistRun(messageId: string) {
  return async (tx: Prisma.TransactionClient) => {
    const run = await tx.interpretationRun.create({
      data: {
        messageId,
        stage: "interpret",
        pipelineVersion: "1",
        interpreter: "test",
        interpreterVersion: "1",
        schemaVersion: 1,
        inputHash: "i",
        contextHash: "c",
        status: "succeeded",
        latencyMs: 1,
      },
    });
    return run.id;
  };
}

describe("claimJobs", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("leases due jobs and counts the attempt", async () => {
    await queue(2);
    await prisma.processingJob.updateMany({
      where: { idempotencyKey: { contains: "wa-1" } },
      data: { runAfter: at(10_000) },
    });

    const claimed = await claimJobs(prisma, {
      owner: "w1",
      limit: 10,
      leaseMs: LEASE,
      now: t0,
    });
    expect(claimed).toHaveLength(1);
    const job = await prisma.processingJob.findUniqueOrThrow({
      where: { id: claimed[0].id },
    });
    expect(job).toMatchObject({ status: "running", leaseOwner: "w1", attempts: 1 });
    expect(job.leaseExpiresAt).toEqual(at(LEASE));
  });

  it("never hands the same job to two workers at once", async () => {
    await queue(20);
    const [a, b] = await Promise.all([
      claimJobs(prisma, { owner: "a", limit: 20, leaseMs: LEASE, now: t0 }),
      claimJobs(prisma, { owner: "b", limit: 20, leaseMs: LEASE, now: t0 }),
    ]);
    const ids = [...a, ...b].map((job) => job.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it("takes back a job whose worker died, and the dead worker cannot commit", async () => {
    await queue(1);
    const [stale] = await claimJobs(prisma, {
      owner: "dead",
      limit: 1,
      leaseMs: LEASE,
      now: t0,
    });
    const [fresh] = await claimJobs(prisma, {
      owner: "alive",
      limit: 1,
      leaseMs: LEASE,
      now: at(LEASE + 1),
    });
    expect(fresh.id).toBe(stale.id);
    expect(fresh.attempts).toBe(2);

    await expect(
      completeJob(
        prisma,
        stale,
        { owner: "dead", now: at(LEASE + 2) },
        persistRun(stale.messageId),
      ),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(await prisma.interpretationRun.count()).toBe(0);
  });

  it("sends a job that ran out of attempts while leased to the dead letters", async () => {
    await queue(1);
    await prisma.processingJob.updateMany({ data: { maxAttempts: 1 } });
    await claimJobs(prisma, { owner: "w1", limit: 1, leaseMs: LEASE, now: t0 });

    const again = await claimJobs(prisma, {
      owner: "w2",
      limit: 1,
      leaseMs: LEASE,
      now: at(LEASE + 1),
    });
    expect(again).toEqual([]);
    expect(await prisma.processingJob.findFirstOrThrow()).toMatchObject({
      status: "dead",
      lastErrorKind: "timeout",
    });
  });
});

describe("completeJob", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("stores the result and closes the job in one transaction", async () => {
    await queue(1);
    const [job] = await claimJobs(prisma, {
      owner: "w1",
      limit: 1,
      leaseMs: LEASE,
      now: t0,
    });
    const runId = await completeJob(
      prisma,
      job,
      { owner: "w1", now: at(5) },
      persistRun(job.messageId),
    );

    expect(
      await prisma.processingJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: "succeeded",
      resultRunId: runId,
      leaseOwner: null,
      completedAt: at(5),
    });
  });

  it("leaves no trace when storing the result fails", async () => {
    await queue(1);
    const [job] = await claimJobs(prisma, {
      owner: "w1",
      limit: 1,
      leaseMs: LEASE,
      now: t0,
    });
    await expect(
      completeJob(prisma, job, { owner: "w1", now: at(5) }, async (tx) => {
        await persistRun(job.messageId)(tx);
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");

    expect(await prisma.interpretationRun.count()).toBe(0);
    expect(
      (await prisma.processingJob.findUniqueOrThrow({ where: { id: job.id } })).status,
    ).toBe("running");
  });
});

describe("failJob", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("retries a transient failure later, backing off with each attempt", async () => {
    await queue(1);
    const [job] = await claimJobs(prisma, {
      owner: "w1",
      limit: 1,
      leaseMs: LEASE,
      now: t0,
    });
    const outcome = await failJob(
      prisma,
      job,
      { owner: "w1", now: t0 },
      { kind: "transient", message: "503" },
    );

    expect(outcome).toBe("retry");
    expect(
      await prisma.processingJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: "pending",
      leaseOwner: null,
      runAfter: at(backoffMs(1)),
      lastErrorKind: "transient",
      lastError: "503",
    });
    expect(backoffMs(2)).toBe(2 * backoffMs(1));
    expect(backoffMs(20)).toBe(60 * 60 * 1000);
  });

  it("gives up after the last attempt", async () => {
    await queue(1);
    await prisma.processingJob.updateMany({ data: { maxAttempts: 1 } });
    const [job] = await claimJobs(prisma, {
      owner: "w1",
      limit: 1,
      leaseMs: LEASE,
      now: t0,
    });
    expect(
      await failJob(
        prisma,
        job,
        { owner: "w1", now: t0 },
        { kind: "timeout", message: "slow" },
      ),
    ).toBe("dead");
  });

  it("does not retry a refusal, which would only be refused again", async () => {
    await queue(1);
    const [job] = await claimJobs(prisma, {
      owner: "w1",
      limit: 1,
      leaseMs: LEASE,
      now: t0,
    });
    expect(
      await failJob(
        prisma,
        job,
        { owner: "w1", now: t0 },
        { kind: "refusal", message: "no" },
      ),
    ).toBe("dead");
  });

  it("allows malformed output one more try, not the full budget", async () => {
    await queue(1);
    let [job] = await claimJobs(prisma, {
      owner: "w1",
      limit: 1,
      leaseMs: LEASE,
      now: t0,
    });
    expect(
      await failJob(
        prisma,
        job,
        { owner: "w1", now: t0 },
        { kind: "schema", message: "bad" },
      ),
    ).toBe("retry");
    [job] = await claimJobs(prisma, {
      owner: "w1",
      limit: 1,
      leaseMs: LEASE,
      now: at(backoffMs(1)),
    });
    expect(
      await failJob(
        prisma,
        job,
        { owner: "w1", now: t0 },
        { kind: "schema", message: "bad" },
      ),
    ).toBe("dead");
  });

  it("reports a lost lease instead of overwriting another worker's job", async () => {
    await queue(1);
    const [job] = await claimJobs(prisma, {
      owner: "w1",
      limit: 1,
      leaseMs: LEASE,
      now: t0,
    });
    expect(
      await failJob(
        prisma,
        job,
        { owner: "intruder", now: t0 },
        { kind: "transient", message: "x" },
      ),
    ).toBe("lease_lost");
  });
});
