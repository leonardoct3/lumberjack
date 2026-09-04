import { describe, it, expect } from "vitest";
import { computeHeatScore } from "@/domain/heat";

describe("computeHeatScore", () => {
  it("is the locked linear combination", () => {
    expect(
      computeHeatScore({
        demand1d: 1,
        demand3d: 2,
        demand7d: 3,
        uniqueDemandSenders7d: 4,
        offer1d: 5,
        offer3d: 6,
      }),
    ).toBe(4 * 1 + 2 * 2 + 1 * 3 + 2 * 4 + 1 * 5 + 1 * 6);
  });

  it("does not take daysToEvent", () => {
    expect(computeHeatScore.length).toBe(1);
  });
});
