import { describe, it, expect } from "vitest";
import { normalizeText } from "@/domain/normalize";

describe("normalizeText", () => {
  it("lowercases, strips accents, collapses space", () => {
    expect(normalizeText("  Pista ÔNIX  ")).toBe("pista onix");
  });
});
