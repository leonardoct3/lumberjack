import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { ingestRawMessage } from "@/ingest/ingest";
import { PIPELINE_VERSION } from "@/pipeline/config";
import { enqueueInterpretation, jobKey } from "@/pipeline/queue";
import { resetDb } from "../helpers/db";

const now = new Date("2026-09-16T15:00:00Z");

function input(overrides: Partial<Parameters<typeof ingestRawMessage>[1]> = {}) {
  return {
    waMessageId: "wa-1",
    groupWaId: "g-1",
    groupName: "ingressos",
    senderWaId: "s-1",
    senderName: "Ana",
    sentAt: now,
    text: "vendo 2 pista onix",
    ...overrides,
  };
}

describe("enqueue at capture", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("queues nothing while interpretation is off", async () => {
    await ingestRawMessage(prisma, input());
    expect(await prisma.processingJob.count()).toBe(0);
  });

  it("stores the message and its job together when interpretation is on", async () => {
    const { messageId } = await ingestRawMessage(prisma, input(), { interpret: true });
    const jobs = await prisma.processingJob.findMany();
    expect(jobs).toEqual([
      expect.objectContaining({
        messageId,
        stage: "interpret",
        status: "pending",
        attempts: 0,
        pipelineVersion: PIPELINE_VERSION,
        idempotencyKey: jobKey("interpret", "wa-1"),
      }),
    ]);
  });

  it("queues a redelivered message once", async () => {
    await ingestRawMessage(prisma, input(), { interpret: true });
    await ingestRawMessage(prisma, input(), { interpret: true });
    expect(await prisma.processingJob.count()).toBe(1);
  });

  it("skips cross-post copies and muted senders, as signals do", async () => {
    await ingestRawMessage(prisma, input(), { interpret: true });
    await ingestRawMessage(prisma, input({ waMessageId: "wa-2", groupWaId: "g-2" }), {
      interpret: true,
    });
    await prisma.sender.create({ data: { waId: "s-muted", muted: true } });
    await ingestRawMessage(
      prisma,
      input({ waMessageId: "wa-3", senderWaId: "s-muted" }),
      {
        interpret: true,
      },
    );
    const jobs = await prisma.processingJob.findMany({ include: { message: true } });
    expect(jobs.map((job) => job.message.waMessageId)).toEqual(["wa-1"]);
  });
});

describe("enqueueInterpretation", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("backfills stored messages once, however often it runs", async () => {
    await ingestRawMessage(prisma, input());
    await ingestRawMessage(
      prisma,
      input({ waMessageId: "wa-2", text: "compro 1 pista" }),
    );
    await ingestRawMessage(prisma, input({ waMessageId: "wa-3", groupWaId: "g-2" }));

    const first = await enqueueInterpretation(prisma, {
      from: new Date(0),
      to: new Date("2027-01-01"),
    });
    const second = await enqueueInterpretation(prisma, {
      from: new Date(0),
      to: new Date("2027-01-01"),
    });

    expect(first).toEqual({ candidates: 2, queued: 2 });
    expect(second).toEqual({ candidates: 2, queued: 0 });
    expect(await prisma.processingJob.count()).toBe(2);
  });

  it("only backfills the requested window", async () => {
    await ingestRawMessage(prisma, input({ sentAt: new Date("2026-09-10T12:00:00Z") }));
    const result = await enqueueInterpretation(prisma, {
      from: new Date("2026-09-15T00:00:00Z"),
      to: new Date("2026-09-20T00:00:00Z"),
    });
    expect(result).toEqual({ candidates: 0, queued: 0 });
  });
});
