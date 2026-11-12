import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonl } from "@/benchmark/dataset";
import {
  type ModelCall,
  ModelError,
  type ModelClient,
  type ModelReply,
} from "@/llm/client";
import { RETENTION, runDrafts, type DraftRunOptions } from "@/benchmark/draft/run";
import { exportWith, item, message, offerDraft } from "./draft-fixture";

const data = exportWith([
  message("m1", 0, "vendo syon fem 330"),
  message("m2", 1, "vendo syon fem 300"),
  message("m3", 2, "vendo syon fem 280"),
  message("gone", 3, "vendo syon fem 250"),
]);
const items = [
  item("m1"),
  item("m2"),
  item("m3"),
  item("gone", { excluded: "template_leak" }),
];

function fakeDrafter(
  id: string,
  answer: (call: ModelCall, n: number) => ModelReply | Promise<ModelReply>,
): ModelClient & { calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  return {
    id,
    provider: id.startsWith("openai") ? "openai" : "anthropic",
    route: "api",
    model: id,
    price: { inputPerMTok: 1, outputPerMTok: 1 },
    calls,
    async complete(call) {
      calls.push(call);
      return answer(call, calls.length);
    },
  };
}

const usage = { inputTokens: 1000, outputTokens: 1000 };
const good = (): ModelReply => ({ output: offerDraft("vendo syon fem"), usage });

function options(
  dir: string,
  drafters: ModelClient[],
  over: Partial<DraftRunOptions> = {},
): DraftRunOptions {
  return {
    data,
    items,
    seed: "seed",
    drafters,
    dir,
    budgetUsd: 50,
    maxOutputTokens: 1000,
    meta: { exportManifestSha256: "abc" },
    sleep: async () => {},
    ...over,
  };
}

const tempDir = () => mkdtempSync(path.join(tmpdir(), "lj-drafts-"));

describe("runDrafts", () => {
  it("drafts every usable item with both providers and records how", async () => {
    const dir = tempDir();
    const a = fakeDrafter("openai-a", good);
    const b = fakeDrafter("anthropic-b", good);
    const report = await runDrafts(options(dir, [a, b]));

    for (const drafter of [a, b]) {
      const drafts = readJsonl<{
        messageId: string;
        source: string;
        annotator: string;
      }>(path.join(dir, `${drafter.id}.jsonl`));
      expect(drafts.map((d) => d.messageId).sort()).toEqual(["m1", "m2", "m3"]);
      expect(new Set(drafts.map((d) => d.source))).toEqual(new Set(["model_draft"]));
      expect(new Set(drafts.map((d) => d.annotator))).toEqual(new Set([drafter.id]));
    }
    expect(report).toMatchObject({
      stoppedForBudget: false,
      abortedBy: null,
      spentUsd: 0.012,
    });
    expect(report.drafters.map((d) => [d.id, d.drafted, d.calls, d.retention])).toEqual(
      [
        ["openai-a", 3, 3, RETENTION.api],
        ["anthropic-b", 3, 3, RETENTION.api],
      ],
    );
    const manifest = readdirSync(dir).find((f) => f.startsWith("run-"))!;
    expect(JSON.parse(readFileSync(path.join(dir, manifest), "utf8"))).toEqual(report);
  });

  it("resumes without paying again for what is already drafted", async () => {
    const dir = tempDir();
    await runDrafts(options(dir, [fakeDrafter("openai-a", good)], { limit: 2 }));
    const again = fakeDrafter("openai-a", good);
    const report = await runDrafts(options(dir, [again]));
    expect(again.calls).toHaveLength(1);
    expect(report.drafters[0]).toMatchObject({ alreadyDrafted: 2, drafted: 1 });
    expect(report.priorSpentUsd).toBe(0.004);
  });

  it("gives the model one chance to fix a failed check, then records the failure", async () => {
    const dir = tempDir();
    const fixes = fakeDrafter("openai-a", (_, n) =>
      n === 1 ? { output: offerDraft("Syon feminino"), usage } : good(),
    );
    const report = await runDrafts(options(dir, [fixes], { limit: 1 }));
    expect(report.drafters[0]).toMatchObject({
      drafted: 1,
      correctedOnRetry: 1,
      calls: 2,
    });
    expect(fixes.calls[1].user).toContain("failed these checks");

    const never = fakeDrafter("anthropic-b", () => ({
      output: offerDraft("nope"),
      usage,
    }));
    const failed = await runDrafts(options(tempDir(), [never], { limit: 1 }));
    expect(failed.drafters[0]).toMatchObject({
      drafted: 0,
      failed: { invalid: 1 },
      calls: 2,
    });
  });

  it("stops before a call could take spending past the budget", async () => {
    const dir = tempDir();
    // Each call reserves at most (input estimate + 1000 output tokens) at US$ 1 per million.
    const a = fakeDrafter("openai-a", good);
    const report = await runDrafts(
      options(dir, [a], { budgetUsd: 0.005, concurrency: 1 }),
    );
    expect(report.stoppedForBudget).toBe(true);
    expect(report.spentUsd).toBeLessThanOrEqual(0.005);
    expect(a.calls.length).toBeGreaterThan(0);
    expect(a.calls.length).toBeLessThan(3);

    writeFileSync(path.join(dir, "run-old.json"), JSON.stringify({ spentUsd: 1 }));
    const broke = fakeDrafter("openai-a", good);
    expect(
      (await runDrafts(options(dir, [broke], { budgetUsd: 0.5 }))).stoppedForBudget,
    ).toBe(true);
    expect(broke.calls).toHaveLength(0);
  });

  it("retries transient errors and aborts on a fatal one", async () => {
    const flaky = fakeDrafter("openai-a", (_, n) => {
      if (n === 1) throw new ModelError("transient", "HTTP 429");
      return good();
    });
    const report = await runDrafts(options(tempDir(), [flaky], { limit: 1 }));
    expect(report.drafters[0]).toMatchObject({ drafted: 1, calls: 2 });

    const dir = tempDir();
    const denied = fakeDrafter("anthropic-b", () => {
      throw new ModelError("fatal", "HTTP 401: invalid x-api-key");
    });
    const aborted = await runDrafts(options(dir, [denied], { concurrency: 1 }));
    expect(aborted.abortedBy).toBe("anthropic-b: HTTP 401: invalid x-api-key");
    expect(denied.calls).toHaveLength(1);
    expect(existsSync(path.join(dir, "anthropic-b.failures.jsonl"))).toBe(true);
  });
});
