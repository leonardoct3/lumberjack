import { describe, expect, it } from "vitest";
import { isNavActive } from "@/lib/nav";

describe("isNavActive", () => {
  it("marks the exact route", () => {
    expect(isNavActive("/watchlist", "/watchlist")).toBe(true);
  });

  it("does not mark heat when on watchlist", () => {
    expect(isNavActive("/watchlist", "/heat")).toBe(false);
  });

  it("does not mark any tab on party detail", () => {
    expect(isNavActive("/parties/abc", "/watchlist")).toBe(false);
    expect(isNavActive("/parties/abc", "/heat")).toBe(false);
  });
});
