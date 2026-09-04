import { describe, it, expect } from "vitest";
import { TZ, isListenDay, daysUntil } from "@/domain/timezone";

describe("timezone", () => {
  it("uses America/Sao_Paulo", () => {
    expect(TZ).toBe("America/Sao_Paulo");
  });

  it("listens Tuesday through Saturday only", () => {
    // 2026-09-07 15:00Z = Monday 12:00 in SP (UTC-3)
    expect(isListenDay(new Date("2026-09-07T15:00:00Z"))).toBe(false);
    // 2026-09-08 15:00Z = Tuesday
    expect(isListenDay(new Date("2026-09-08T15:00:00Z"))).toBe(true);
    // 2026-09-12 15:00Z = Saturday
    expect(isListenDay(new Date("2026-09-12T15:00:00Z"))).toBe(true);
    // 2026-09-13 15:00Z = Sunday
    expect(isListenDay(new Date("2026-09-13T15:00:00Z"))).toBe(false);
  });

  it("counts calendar days in SP", () => {
    const now = new Date("2026-09-03T15:00:00Z");
    const event = new Date("2026-09-05T03:00:00Z"); // 2026-09-05 00:00 SP
    expect(daysUntil(event, now)).toBe(2);
  });
});
