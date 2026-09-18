import { describe, it, expect } from "vitest";
import {
  computePressure,
  demandConfidence,
  pressureTrend,
  snapshotNearest,
} from "@/domain/heat";

describe("computePressure", () => {
  it("is buyers per seller", () => {
    expect(
      computePressure({ uniqueDemandSenders: 9, uniqueOfferSenders: 2 }),
    ).toBe(3);
  });

  it("stays finite when nobody is selling", () => {
    expect(
      computePressure({ uniqueDemandSenders: 4, uniqueOfferSenders: 0 }),
    ).toBe(4);
  });

  it("ranks a real buyer above a party flooded with sellers", () => {
    const buyer = computePressure({
      uniqueDemandSenders: 1,
      uniqueOfferSenders: 0,
    });
    const sellers = computePressure({
      uniqueDemandSenders: 0,
      uniqueOfferSenders: 10,
    });
    expect(buyer).toBeGreaterThan(sellers);
    expect(sellers).toBe(0);
  });

  it("does not reward one person repeating", () => {
    // Both are five messages; only the second one is a market.
    const oneLoudPerson = computePressure({
      uniqueDemandSenders: 1,
      uniqueOfferSenders: 1,
    });
    const fivePeople = computePressure({
      uniqueDemandSenders: 5,
      uniqueOfferSenders: 1,
    });
    expect(oneLoudPerson).toBe(0.5);
    expect(fivePeople).toBe(2.5);
  });

  it("keeps one decimal", () => {
    expect(
      computePressure({ uniqueDemandSenders: 1, uniqueOfferSenders: 2 }),
    ).toBe(0.3);
  });
});

describe("demandConfidence", () => {
  it.each([
    [0, "none"],
    [1, "low"],
    [2, "low"],
    [3, "medium"],
    [5, "medium"],
    [6, "high"],
    [40, "high"],
  ] as const)("reads %i people as %s", (people, expected) => {
    expect(demandConfidence(people)).toBe(expected);
  });
});

describe("pressureTrend", () => {
  it("has no trend without a past snapshot", () => {
    expect(pressureTrend(3, null)).toBeNull();
  });

  it("calls half a buyer per seller a move", () => {
    expect(pressureTrend(3, 2.5)).toBe("up");
    expect(pressureTrend(2, 2.5)).toBe("down");
  });

  it("ignores hourly wobble", () => {
    expect(pressureTrend(3, 2.8)).toBe("flat");
    expect(pressureTrend(2.8, 3)).toBe("flat");
  });
});

describe("snapshotNearest", () => {
  const snap = (iso: string) => ({ computedAt: new Date(iso) });

  it("takes the closest snapshot on either side of the target", () => {
    const snapshots = [
      snap("2026-09-18T12:00:00Z"),
      snap("2026-09-15T09:00:00Z"),
      snap("2026-09-15T14:00:00Z"),
    ];
    expect(
      snapshotNearest(snapshots, new Date("2026-09-15T13:00:00Z")),
    ).toEqual(snap("2026-09-15T14:00:00Z"));
  });

  it("is null without snapshots", () => {
    expect(snapshotNearest([], new Date())).toBeNull();
  });
});
