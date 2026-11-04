import { describe, expect, it } from "vitest";
import {
  createPseudonymizer,
  PSEUDONYM_KEY_MIN_LENGTH,
} from "@/benchmark/pseudonymize";

const KEY = "k".repeat(PSEUDONYM_KEY_MIN_LENGTH);
const OTHER_KEY = "z".repeat(PSEUDONYM_KEY_MIN_LENGTH);

describe("createPseudonymizer", () => {
  it("gives the same id the same pseudonym, so cross-posts still line up", () => {
    const a = createPseudonymizer(KEY);
    const b = createPseudonymizer(KEY);
    expect(a.id("sender", "5511999990000@s.whatsapp.net")).toBe(
      b.id("sender", "5511999990000@s.whatsapp.net"),
    );
  });

  it("prefixes the kind and never carries the original value", () => {
    const pseudonym = createPseudonymizer(KEY).id(
      "sender",
      "5511999990000@s.whatsapp.net",
    );
    expect(pseudonym).toMatch(/^snd_[0-9a-f]{16}$/);
    expect(pseudonym).not.toContain("5511999990000");
  });

  it("separates kinds, so a group and a sender with one id stay apart", () => {
    const p = createPseudonymizer(KEY);
    expect(p.id("group", "x").slice(4)).not.toBe(p.id("sender", "x").slice(4));
  });

  it("changes every pseudonym when the key changes", () => {
    expect(createPseudonymizer(KEY).id("group", "g-1")).not.toBe(
      createPseudonymizer(OTHER_KEY).id("group", "g-1"),
    );
  });

  it("keeps null as null instead of inventing an identity", () => {
    expect(createPseudonymizer(KEY).optionalId("message", null)).toBeNull();
  });

  it("refuses a key too short to resist guessing", () => {
    expect(() => createPseudonymizer("short")).toThrow(/at least/);
  });

  it("fingerprints the key without exposing it, so runs can prove they share one", () => {
    const fingerprint = createPseudonymizer(KEY).keyFingerprint;
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint).not.toBe(createPseudonymizer(OTHER_KEY).keyFingerprint);
    expect(fingerprint).not.toContain("kkkk");
  });
});
