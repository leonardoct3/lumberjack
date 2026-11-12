import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertOutsideRepo, loadApiKey, loadPseudonymKey } from "@/benchmark/storage";

const repo = path.resolve(__dirname, "../..");

describe("assertOutsideRepo", () => {
  it("accepts a directory outside the repository", () => {
    expect(assertOutsideRepo("/tmp/lumberjack-export", repo)).toBe(
      "/tmp/lumberjack-export",
    );
  });

  it("refuses anything inside it, so real messages never end up committed", () => {
    expect(() => assertOutsideRepo(path.join(repo, "data/export"), repo)).toThrow(
      /outside the repository/,
    );
    expect(() => assertOutsideRepo(repo, repo)).toThrow(/outside the repository/);
  });

  it("is not fooled by a relative path that climbs back in", () => {
    expect(() =>
      assertOutsideRepo(`${repo}/../${path.basename(repo)}/x`, repo),
    ).toThrow();
  });
});

describe("loadApiKey", () => {
  it("reads a provider key from a file outside the repository", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lj-key-"));
    const file = path.join(dir, "openai.key");
    writeFileSync(file, "sk-abc\n");
    expect(loadApiKey("OPENAI_API_KEY_FILE", { OPENAI_API_KEY_FILE: file }, repo)).toBe(
      "sk-abc",
    );
  });

  it("refuses a key inside the repository, an empty file, or none at all", () => {
    expect(() =>
      loadApiKey(
        "ANTHROPIC_API_KEY_FILE",
        { ANTHROPIC_API_KEY_FILE: path.join(repo, "a.key") },
        repo,
      ),
    ).toThrow(/outside the repository/);
    const empty = path.join(mkdtempSync(path.join(tmpdir(), "lj-key-")), "empty.key");
    writeFileSync(empty, "\n");
    expect(() =>
      loadApiKey("OPENAI_API_KEY_FILE", { OPENAI_API_KEY_FILE: empty }, repo),
    ).toThrow(/empty/);
    expect(() => loadApiKey("OPENAI_API_KEY_FILE", {}, repo)).toThrow(
      /OPENAI_API_KEY_FILE/,
    );
  });
});

describe("loadPseudonymKey", () => {
  it("reads the key from a file outside the repository", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lj-key-"));
    const file = path.join(dir, "pseudonym.key");
    writeFileSync(file, `${"a".repeat(64)}\n`);
    expect(loadPseudonymKey({ BENCH_PSEUDONYM_KEY_FILE: file }, repo)).toBe(
      "a".repeat(64),
    );
  });

  it("refuses a key file kept inside the repository", () => {
    expect(() =>
      loadPseudonymKey({ BENCH_PSEUDONYM_KEY_FILE: path.join(repo, "key.txt") }, repo),
    ).toThrow(/outside the repository/);
  });

  it("says how to provide one when none is set", () => {
    expect(() => loadPseudonymKey({}, repo)).toThrow(/BENCH_PSEUDONYM_KEY_FILE/);
  });
});
