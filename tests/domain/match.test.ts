import { describe, it, expect } from "vitest";
import { matchParty } from "@/domain/match";

const onix = { id: "1", name: "ONIX", aliases: ["onix"], status: "upcoming" as const };
const past = { id: "2", name: "ONIX", aliases: ["onix"], status: "past" as const };

describe("matchParty", () => {
  it("matches upcoming name in text", () => {
    expect(matchParty("procuro pista onix", [onix])?.id).toBe("1");
  });

  it("does not attach buy/heat signals to past parties", () => {
    expect(matchParty("procuro onix", [past])).toBeNull();
  });
});
