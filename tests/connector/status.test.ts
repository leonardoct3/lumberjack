import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readWaStatus, writeWaStatus } from "@/connector/status";
import { prisma } from "@/db/client";
import { resetDb } from "../helpers/db";

describe("wa status", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("missing row is disconnected with missing-session", async () => {
    const status = await readWaStatus(prisma);
    expect(status.state).toBe("disconnected");
    expect(status.detail).toBe("missing-session");
  });

  it("round-trips state, qr, and liveness timestamps", async () => {
    await writeWaStatus(prisma, {
      state: "qr",
      qr: "payload-1",
      lastMessageAt: "2026-09-09T19:00:00.000Z",
      heartbeatAt: "2026-09-09T19:01:00.000Z",
    });

    const status = await readWaStatus(prisma);
    expect(status.state).toBe("qr");
    expect(status.qr).toBe("payload-1");
    expect(status.lastMessageAt).toBe("2026-09-09T19:00:00.000Z");
    expect(status.heartbeatAt).toBe("2026-09-09T19:01:00.000Z");
    expect(status.updatedAt).toBeTruthy();
  });

  it("clears qr when writing a connected status without one", async () => {
    await writeWaStatus(prisma, { state: "qr", qr: "payload-1" });
    await writeWaStatus(prisma, { state: "connected" });

    const status = await readWaStatus(prisma);
    expect(status.state).toBe("connected");
    expect(status.qr).toBeUndefined();
  });
});
