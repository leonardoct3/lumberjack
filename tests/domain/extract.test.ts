import { describe, it, expect } from "vitest";
import { extractCandidate } from "@/domain/extract";

const now = new Date("2026-09-03T15:00:00Z");

describe("extractCandidate", () => {
  it("pulls url, platform, lot, price, date, name", () => {
    const r = extractCandidate(
      "ONIX\n1º lote R$ 80 05/09 https://www.sympla.com.br/onix",
      now,
    );
    expect(r.platform).toBe("sympla");
    expect(r.url).toContain("sympla.com.br/onix");
    expect(r.officialPrice).toBe(80);
    expect(r.lotLabel?.toLowerCase()).toContain("lote");
    expect(r.eventAt?.toISOString().startsWith("2026-09-05")).toBe(true);
    expect(r.name?.toLowerCase()).toContain("onix");
  });

  it("returns nulls when nothing is present", () => {
    const r = extractCandidate("bom dia", now);
    expect(r).toEqual({
      name: "bom dia",
      url: null,
      lotLabel: null,
      officialPrice: null,
      eventAt: null,
      platform: "unknown",
    });
  });
});
