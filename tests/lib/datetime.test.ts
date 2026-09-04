import { describe, expect, it } from "vitest";
import { formatWhen, toDatetimeLocal } from "@/lib/datetime";

describe("datetime", () => {
  it("formats an ISO instant in America/Sao_Paulo", () => {
    const iso = "2026-10-04T03:00:00.000Z";
    expect(formatWhen(iso)).toMatch(/04\/10\/2026/);
    expect(toDatetimeLocal(iso)).toBe("2026-10-04T00:00");
  });
});
