import { describe, expect, it } from "vitest";
import {
  DEDUPE_WINDOW_MS,
  fingerprintText,
  withinDedupeWindow,
} from "@/domain/dedupe";

describe("fingerprintText", () => {
  it("is stable across case, accents, and whitespace", () => {
    expect(fingerprintText("Vendo Pista JAGUARIÚNA")).toBe(
      fingerprintText("vendo   pista jaguariuna"),
    );
  });

  it("ignores punctuation and emoji the seller sprinkles per group", () => {
    expect(fingerprintText("Vendo 2 pista, transferível!")).toBe(
      fingerprintText("🎟️ Vendo 2 pista — transferível 🔥"),
    );
  });

  it("separates different offers", () => {
    expect(fingerprintText("vendo 2 pista")).not.toBe(
      fingerprintText("vendo 3 pista"),
    );
  });

  it("keeps digits that carry the price", () => {
    expect(fingerprintText("vendo pista R$ 100")).not.toBe(
      fingerprintText("vendo pista R$ 180"),
    );
  });

  it("collapses price formatting so R$100 and R$ 100,00 differ only by digits", () => {
    expect(fingerprintText("vendo pista R$100")).toBe(
      fingerprintText("vendo pista r$ 100"),
    );
  });

  it("returns null when nothing identifying is left", () => {
    expect(fingerprintText("")).toBeNull();
    expect(fingerprintText("   ")).toBeNull();
    expect(fingerprintText("🔥🔥🔥")).toBeNull();
  });

  it("is a fixed-width hash so long promos stay indexable", () => {
    const long = fingerprintText("a".repeat(20_000));
    expect(long).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("withinDedupeWindow", () => {
  const base = new Date("2026-09-16T12:00:00Z");

  it("treats a repost later the same day as the same intent", () => {
    const later = new Date(base.getTime() + 6 * 60 * 60 * 1000);
    expect(withinDedupeWindow(base, later)).toBe(true);
  });

  it("treats a repost after the window as a renewed intent", () => {
    const later = new Date(base.getTime() + DEDUPE_WINDOW_MS + 1);
    expect(withinDedupeWindow(base, later)).toBe(false);
  });

  it("includes the window boundary", () => {
    const later = new Date(base.getTime() + DEDUPE_WINDOW_MS);
    expect(withinDedupeWindow(base, later)).toBe(true);
  });

  it("does not care which message arrived first", () => {
    const earlier = new Date(base.getTime() - 60 * 60 * 1000);
    expect(withinDedupeWindow(base, earlier)).toBe(true);
  });
});
