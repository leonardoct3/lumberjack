import { describe, expect, it } from "vitest";
import { readWaStatus } from "@/connector/status";

describe("wa status", () => {
  it("missing file is disconnected", () => {
    expect(readWaStatus("/tmp/lumberjack-no-such-status.json").state).toBe("disconnected");
  });
});
