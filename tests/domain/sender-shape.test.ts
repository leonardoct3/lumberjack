import { describe, it, expect } from "vitest";
import { senderShape } from "@/domain/sender-shape";

describe("senderShape", () => {
  it("calls someone with no ticket message quiet", () => {
    expect(senderShape({ ads: 0, pista: 0 })).toBe("quiet");
  });

  it("reads a promoter off their blasts", () => {
    expect(senderShape({ ads: 12, pista: 0 })).toBe("announces");
    // One stray pista line does not turn a promoter into a reseller.
    expect(senderShape({ ads: 19, pista: 1 })).toBe("announces");
  });

  it("reads a reseller off their offers and asks", () => {
    expect(senderShape({ ads: 0, pista: 7 })).toBe("trades");
  });

  it("says both when both sides are really there", () => {
    expect(senderShape({ ads: 4, pista: 6 })).toBe("both");
    expect(senderShape({ ads: 3, pista: 1 })).toBe("both");
  });
});
