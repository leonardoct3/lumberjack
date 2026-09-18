import { describe, it, expect } from "vitest";
import { CONFIDENCE_LABEL, TREND_LABEL, readHeat } from "@/lib/heat-copy";
import type { Confidence, Trend } from "@/domain/heat";

describe("readHeat", () => {
  it("says who wants in, who is letting go, and how long there is", () => {
    expect(readHeat({ buyers: 9, sellers: 2, days: 12 })).toBe(
      "9 procurando, 2 vendendo, faltam 12 dias",
    );
  });

  it("does not write 1 dias", () => {
    expect(readHeat({ buyers: 1, sellers: 0, days: 1 })).toBe(
      "1 procurando, 0 vendendo, falta 1 dia",
    );
  });

  it("calls today today and yesterday gone", () => {
    expect(readHeat({ buyers: 3, sellers: 1, days: 0 })).toContain("é hoje");
    expect(readHeat({ buyers: 3, sellers: 1, days: -2 })).toContain("já passou");
  });

  it("drops the clock when the date is unknown", () => {
    expect(readHeat({ buyers: 4, sellers: 1, days: null })).toBe(
      "4 procurando, 1 vendendo",
    );
  });
});

describe("heat labels", () => {
  it("covers every confidence and trend", () => {
    const confidences: Confidence[] = ["none", "low", "medium", "high"];
    const trends: Trend[] = ["up", "flat", "down"];
    for (const key of confidences) expect(CONFIDENCE_LABEL[key]).toBeTruthy();
    for (const key of trends) expect(TREND_LABEL[key]).toBeTruthy();
  });
});
