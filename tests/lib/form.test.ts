import { describe, expect, it } from "vitest";
import {
  formDateTime,
  formEnum,
  formIds,
  optionalFiniteNumber,
  optionalUrl,
} from "@/lib/form";

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, raw] of Object.entries(entries)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) data.append(key, value);
  }
  return data;
}

describe("form validation", () => {
  it("converts a local event datetime to São Paulo time", () => {
    expect(
      formDateTime(form({ eventAt: "2026-09-20T22:30" }), "eventAt").toISOString(),
    ).toBe("2026-09-21T01:30:00.000Z");
  });

  it("rejects invalid dates, IDs, enum values, and non-finite numbers", () => {
    expect(() => formDateTime(form({ eventAt: "not-a-date" }), "eventAt")).toThrow();
    expect(() => formIds(form({ messageIds: [] }), "messageIds")).toThrow();
    expect(() =>
      formEnum(form({ direction: "sideways" }), "direction", ["up", "down"] as const),
    ).toThrow();
    expect(() => optionalFiniteNumber(form({ price: "NaN" }), "price")).toThrow();
    expect(() =>
      optionalFiniteNumber(form({ price: "-1" }), "price", { min: 0 }),
    ).toThrow();
    expect(() => optionalUrl(form({ url: "not-a-url" }), "url")).toThrow();
  });
});
