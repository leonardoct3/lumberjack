import { describe, it, expect } from "vitest";
import { canAppearOnWatchlist, canRankOnHeat, isPastEvent } from "@/domain/gates";

describe("gates", () => {
  it("keeps past parties off watchlist and heat rank", () => {
    expect(canAppearOnWatchlist({ status: "past", hasOpenLot: true })).toBe(false);
    expect(canRankOnHeat("past")).toBe(false);
    expect(canRankOnHeat("upcoming")).toBe(true);
    expect(canAppearOnWatchlist({ status: "upcoming", hasOpenLot: true })).toBe(true);
    expect(canAppearOnWatchlist({ status: "upcoming", hasOpenLot: false })).toBe(false);
  });

  it("treats yesterday in SP as past", () => {
    expect(isPastEvent(new Date("2026-09-02T03:00:00Z"), new Date("2026-09-03T15:00:00Z"))).toBe(true);
  });
});
