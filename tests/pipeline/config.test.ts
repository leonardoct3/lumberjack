import { describe, expect, it } from "vitest";
import { loadPipelineConfig } from "@/pipeline/config";
import { interpreterFor, resolverFor } from "@/pipeline/interpreters";

describe("loadPipelineConfig", () => {
  it("keeps the whole pipeline off unless it is asked for", () => {
    expect(loadPipelineConfig({})).toEqual({
      interpret: "off",
      resolve: "off",
      projection: "off",
      recommendations: "off",
      interpreter: "rules",
      resolver: "rules",
      model: null,
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

  it("resolves only what is interpreted, and with a model only when there is one", () => {
    expect(
      loadPipelineConfig({ PIPELINE_INTERPRET: "shadow", PIPELINE_RESOLVE: "shadow" })
        .resolve,
    ).toBe("shadow");
    expect(() => loadPipelineConfig({ PIPELINE_RESOLVE: "shadow" })).toThrow(
      /PIPELINE_RESOLVE: .*PIPELINE_INTERPRET=shadow/,
    );
    expect(() => loadPipelineConfig({ PIPELINE_RESOLVER: "model" })).toThrow(
      /PIPELINE_RESOLVER/,
    );
    const config = loadPipelineConfig({
      PIPELINE_INTERPRETER: "openai",
      PIPELINE_RESOLVER: "model",
      PIPELINE_MODEL: "gpt-5.6-luna",
      PIPELINE_MODEL_PRICE: "0.2/1.2",
    });
    expect(resolverFor(config, { OPENAI_API_KEY: "sk-test" })).toMatchObject({
      name: "model",
      promptVersion: "resolve-1",
      paid: true,
    });
    expect(resolverFor(loadPipelineConfig({})).name).toBe("rules");
  });

  it("refuses to switch on stages that do not exist yet, rather than ignoring the flag", () => {
    for (const name of ["PIPELINE_PROJECTION", "PIPELINE_RECOMMENDATIONS"]) {
      expect(() => loadPipelineConfig({ [name]: "shadow" })).toThrow(new RegExp(name));
    }
  });

  it("needs a model and its price for a model interpreter, and a key to build it", () => {
    expect(() => loadPipelineConfig({ PIPELINE_INTERPRETER: "openai" })).toThrow(
      /PIPELINE_MODEL[\s\S]*PIPELINE_MODEL_PRICE/,
    );
    expect(() =>
      loadPipelineConfig({
        PIPELINE_INTERPRETER: "openai",
        PIPELINE_MODEL: "gpt-5.6-luna",
        PIPELINE_MODEL_PRICE: "cheap",
      }),
    ).toThrow(/PIPELINE_MODEL_PRICE/);
    const config = loadPipelineConfig({
      PIPELINE_INTERPRETER: "openai",
      PIPELINE_MODEL: "gpt-5.6-luna",
      PIPELINE_MODEL_PRICE: "0.2/1.2/0.02",
    });
    expect(config.model).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
      price: { inputPerMTok: 0.2, outputPerMTok: 1.2, cachedInputPerMTok: 0.02 },
    });
    expect(() => interpreterFor(config, {})).toThrow(/OPENAI_API_KEY/);
    expect(interpreterFor(config, { OPENAI_API_KEY: "sk-test" })).toMatchObject({
      name: "model",
      provider: "openai",
      model: "gpt-5.6-luna",
      paid: true,
    });
    expect(interpreterFor(loadPipelineConfig({}), {}).name).toBe("rules");
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
