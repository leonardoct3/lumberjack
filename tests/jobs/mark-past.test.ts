import { afterAll, describe, expect, it } from "vitest";
import { runWorkerOnce } from "@/jobs/main";
import { prisma } from "@/db/client";
import { resetDb } from "../helpers/db";

describe("runWorkerOnce", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("marks past even when wa is disconnected", async () => {
    await resetDb(prisma);
    await prisma.party.create({
      data: { name: "OLD", aliases: [], eventAt: new Date("2026-01-01T03:00:00Z") },
    });
    await runWorkerOnce(prisma, new Date("2026-09-03T15:00:00Z"));
    expect((await prisma.party.findFirstOrThrow()).status).toBe("past");
  });
});
