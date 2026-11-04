import { afterAll, describe, expect, it } from "vitest";
import { runWorkerOnce } from "@/jobs/main";
import { prisma } from "@/db/client";
import { ingestRawMessage } from "@/ingest/ingest";
import { loadPipelineConfig } from "@/pipeline/config";
import { resetDb } from "../helpers/db";

const now = new Date("2026-09-03T15:00:00Z");

async function queuedMessage() {
  await ingestRawMessage(
    prisma,
    {
      waMessageId: "wa-1",
      groupWaId: "g-1",
      groupName: "g",
      senderWaId: "s-1",
      senderName: null,
      sentAt: now,
      text: "vendo 1 pista",
    },
    { interpret: true },
  );
}

describe("runWorkerOnce", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("marks past even when wa is disconnected", async () => {
    await resetDb(prisma);
    await prisma.party.create({
      data: { name: "OLD", aliases: [], eventAt: new Date("2026-01-01T03:00:00Z") },
    });
    await runWorkerOnce(prisma, now);
    expect((await prisma.party.findFirstOrThrow()).status).toBe("past");
  });

  it("leaves the queue alone while interpretation is off", async () => {
    await resetDb(prisma);
    await queuedMessage();
    expect(await runWorkerOnce(prisma, now)).toBeNull();
    expect((await prisma.processingJob.findFirstOrThrow()).status).toBe("pending");
  });

  it("works the queue in shadow mode", async () => {
    await resetDb(prisma);
    await queuedMessage();
    const report = await runWorkerOnce(prisma, now, () => loadPipelineConfig({ PIPELINE_INTERPRET: "shadow" }));
    expect(report).toMatchObject({ calls: 1, succeeded: 1 });
  });

  it("refreshes the board before a bad flag can stop it", async () => {
    await resetDb(prisma);
    await prisma.party.create({
      data: { name: "OLD", aliases: [], eventAt: new Date("2026-01-01T03:00:00Z") },
    });
    await expect(
      runWorkerOnce(prisma, now, () => loadPipelineConfig({ PIPELINE_INTERPRET: "live" })),
    ).rejects.toThrow(/PIPELINE_INTERPRET/);
    expect((await prisma.party.findFirstOrThrow()).status).toBe("past");
  });
});
