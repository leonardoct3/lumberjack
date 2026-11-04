import { z } from "zod";

/** Part of every idempotency key: bumping it queues every message again, on purpose. */
export const PIPELINE_VERSION = "1";

/**
 * Shadow output is written beside the board and read by nobody but evaluation.
 * Stages whose code has not landed accept only "off", so a flag set too early
 * fails loudly instead of being ignored.
 */
const schema = z.object({
  PIPELINE_INTERPRET: z.enum(["off", "shadow"]).default("off"),
  PIPELINE_RESOLVE: z.literal("off").default("off"),
  PIPELINE_PROJECTION: z.literal("off").default("off"),
  PIPELINE_RECOMMENDATIONS: z.literal("off").default("off"),
  PIPELINE_INTERPRETER: z.enum(["rules"]).default("rules"),
  PIPELINE_MAX_CALLS_PER_PASS: z.coerce.number().int().min(0).default(50),
  /** Paid calls stop for the day once runs since São Paulo midnight cost this much. */
  PIPELINE_DAILY_BUDGET_USD: z.coerce.number().min(0).default(0),
  PIPELINE_LEASE_MS: z.coerce.number().int().min(1_000).default(300_000),
  PIPELINE_CALL_TIMEOUT_MS: z.coerce.number().int().min(100).default(60_000),
});

export type PipelineConfig = {
  interpret: "off" | "shadow";
  resolve: "off";
  projection: "off";
  recommendations: "off";
  interpreter: "rules";
  maxCallsPerPass: number;
  dailyBudgetUsd: number;
  leaseMs: number;
  callTimeoutMs: number;
};

export function loadPipelineConfig(
  env: Record<string, string | undefined> = process.env,
): PipelineConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid pipeline configuration:\n  ${problems.join("\n  ")}`);
  }
  const value = parsed.data;
  return {
    interpret: value.PIPELINE_INTERPRET,
    resolve: value.PIPELINE_RESOLVE,
    projection: value.PIPELINE_PROJECTION,
    recommendations: value.PIPELINE_RECOMMENDATIONS,
    interpreter: value.PIPELINE_INTERPRETER,
    maxCallsPerPass: value.PIPELINE_MAX_CALLS_PER_PASS,
    dailyBudgetUsd: value.PIPELINE_DAILY_BUDGET_USD,
    leaseMs: value.PIPELINE_LEASE_MS,
    callTimeoutMs: value.PIPELINE_CALL_TIMEOUT_MS,
  };
}
