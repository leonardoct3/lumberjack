import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWaStatus } from "@/connector/status";

describe("wa status", () => {
  it("missing file is disconnected", () => {
    expect(readWaStatus("/tmp/lumberjack-no-such-status.json").state).toBe("disconnected");
  });

  it("invalid JSON is disconnected", () => {
    const path = "/tmp/lumberjack-invalid-status.json";
    writeFileSync(path, "{");
    const status = readWaStatus(path);
    expect(status.state).toBe("disconnected");
    expect(status.detail).toBe("invalid-session");
  });
});
