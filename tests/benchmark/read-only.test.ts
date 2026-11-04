import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { describeRole, withReadOnlySnapshot } from "@/benchmark/read-only";
import { resetDb } from "../helpers/db";

describe("withReadOnlySnapshot", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reads inside one repeatable-read, read-only transaction", async () => {
    await prisma.group.create({ data: { waId: "g-1", name: "um" } });

    const seen = await withReadOnlySnapshot(prisma, async (tx, snapshot) => {
      expect(snapshot.isolation).toBe("repeatable read");
      expect(snapshot.readOnly).toBe(true);
      expect(snapshot.startedAt).toBeInstanceOf(Date);
      return tx.group.count();
    });

    expect(seen).toBe(1);
  });

  it("refuses any write, so an export can never touch the data it reads", async () => {
    await expect(
      withReadOnlySnapshot(prisma, (tx) =>
        tx.group.create({ data: { waId: "g-2", name: "dois" } }),
      ),
    ).rejects.toThrow(/read-only transaction/);

    expect(await prisma.group.count()).toBe(0);
  });

  it("does not see rows committed after the snapshot began", async () => {
    const counts = await withReadOnlySnapshot(prisma, async (tx) => {
      const before = await tx.group.count();
      await prisma.group.create({ data: { waId: "g-3", name: "tres" } });
      const after = await tx.group.count();
      return { before, after };
    });

    expect(counts).toEqual({ before: 0, after: 0 });
  });

  it("aborts a statement that runs past its budget", async () => {
    await expect(
      withReadOnlySnapshot(prisma, (tx) => tx.$queryRawUnsafe("SELECT pg_sleep(2)"), {
        statementTimeoutMs: 100,
      }),
    ).rejects.toThrow(/statement timeout/);
  });
});

describe("describeRole", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("says whether the connected role could write, so the manifest can disclose it", async () => {
    const role = await describeRole(prisma);
    expect(role.user).toBe("lumberjack");
    expect(role.superuser).toBe(true);
    expect(role.canWrite).toBe(true);
  });
});
