import { describe, expect, it } from "vitest";
import { loadPipelineConfig } from "@/pipeline/config";

describe("loadPipelineConfig", () => {
  it("keeps the whole pipeline off unless it is asked for", () => {
    expect(loadPipelineConfig({})).toEqual({
      interpret: "off",
      resolve: "off",
      projection: "off",
      recommendations: "off",
      interpreter: "rules",
      maxCallsPerPass: 50,
      dailyBudgetUsd: 0,
      leaseMs: 300_000,
      callTimeoutMs: 60_000,
    });
  });

  it("turns interpretation on in shadow mode only", () => {
    expect(loadPipelineConfig({ PIPELINE_INTERPRET: "shadow" }).interpret).toBe(
      "shadow",
    );
    expect(() => loadPipelineConfig({ PIPELINE_INTERPRET: "live" })).toThrow(
      /PIPELINE_INTERPRET/,
    );
  });

  it("refuses to switch on stages that do not exist yet, rather than ignoring the flag", () => {
    for (const name of [
      "PIPELINE_RESOLVE",
      "PIPELINE_PROJECTION",
      "PIPELINE_RECOMMENDATIONS",
    ]) {
      expect(() => loadPipelineConfig({ [name]: "shadow" })).toThrow(new RegExp(name));
    }
  });

  it("reads limits as numbers and rejects nonsense", () => {
    const config = loadPipelineConfig({
      PIPELINE_MAX_CALLS_PER_PASS: "10",
      PIPELINE_DAILY_BUDGET_USD: "2.5",
    });
    expect(config).toMatchObject({ maxCallsPerPass: 10, dailyBudgetUsd: 2.5 });
    expect(() => loadPipelineConfig({ PIPELINE_MAX_CALLS_PER_PASS: "-1" })).toThrow(
      /PIPELINE_MAX_CALLS_PER_PASS/,
    );
    expect(() => loadPipelineConfig({ PIPELINE_LEASE_MS: "soon" })).toThrow(
      /PIPELINE_LEASE_MS/,
    );
  });
});
