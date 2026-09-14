import { describe, expect, it } from "vitest";
import { countdownLabel, formatEventWhen, formatWhen, toDatetimeLocal } from "@/lib/datetime";

describe("datetime", () => {
  it("formats an ISO instant in America/Sao_Paulo", () => {
    const iso = "2026-10-04T03:00:00.000Z";
    expect(formatWhen(iso)).toMatch(/04\/10\/2026/);
    expect(toDatetimeLocal(iso)).toBe("2026-10-04T00:00");
  });

  it("formats a queue row as weekday, day and time without the year", () => {
    // Saturday 19/09/2026, 20:00 in São Paulo.
    expect(formatEventWhen("2026-09-19T23:00:00.000Z")).toBe("sáb, 19/09 · 20:00");
  });

  it("counts calendar days in São Paulo, not elapsed hours", () => {
    const event = "2026-09-19T23:00:00.000Z";
    // 23:00 in São Paulo the day before is still "amanhã", even though the
    // event is only 21h away and lands on the next UTC day.
    expect(countdownLabel(event, Date.parse("2026-09-19T02:00:00.000Z"))).toBe("amanhã");
    expect(countdownLabel(event, Date.parse("2026-09-19T15:00:00.000Z"))).toBe("hoje");
    expect(countdownLabel(event, Date.parse("2026-09-09T20:00:00.000Z"))).toBe("em 10 dias");
    expect(countdownLabel(event, Date.parse("2026-09-21T15:00:00.000Z"))).toBe("há 2 dias");
    expect(countdownLabel(event, Date.parse("2026-09-20T15:00:00.000Z"))).toBe("ontem");
  });
});
