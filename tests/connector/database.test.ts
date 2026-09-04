import { describe, expect, it } from "vitest";
import { tryConnectDatabase } from "@/connector/database";

describe("tryConnectDatabase", () => {
  it("returns ok when connect succeeds", async () => {
    await expect(tryConnectDatabase(async () => {})).resolves.toEqual({ ok: true });
  });

  it("returns disconnected detail when connect fails", async () => {
    await expect(
      tryConnectDatabase(async () => {
        throw new Error("connection refused");
      }),
    ).resolves.toEqual({ ok: false, detail: "connection refused" });
  });

  it("uses fallback detail for non-Error failures", async () => {
    await expect(
      tryConnectDatabase(async () => {
        throw "down";
      }),
    ).resolves.toEqual({ ok: false, detail: "database-unavailable" });
  });
});
