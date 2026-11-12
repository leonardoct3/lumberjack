import { z } from "zod";

/** Part of every idempotency key: bumping it queues every message again, on purpose. */
export const PIPELINE_VERSION = "1";

const price = z
  .string()
  .regex(
    /^\d+(\.\d+)?\/\d+(\.\d+)?(\/\d+(\.\d+)?)?$/,
    "must be IN/OUT[/CACHED] in US$ per million tokens",
  )
  .transform((raw) => {
    const [input, output, cached] = raw.split("/").map(Number);
    return { inputPerMTok: input, outputPerMTok: output, cachedInputPerMTok: cached };
  });

/**
 * Shadow output is written beside the board and read by nobody but evaluation.
 * Stages whose code has not landed accept only "off", so a flag set too early
 * fails loudly instead of being ignored.
 */
const schema = z
  .object({
    PIPELINE_INTERPRET: z.enum(["off", "shadow"]).default("off"),
    PIPELINE_RESOLVE: z.enum(["off", "shadow"]).default("off"),
    PIPELINE_PROJECTION: z.literal("off").default("off"),
    PIPELINE_RECOMMENDATIONS: z.literal("off").default("off"),
    PIPELINE_INTERPRETER: z.enum(["rules", "openai", "anthropic"]).default("rules"),
    /** "model" chooses among the shortlist with the interpreter's model. */
    PIPELINE_RESOLVER: z.enum(["rules", "model"]).default("rules"),
    /** Model id and price for a model interpreter; the price is what the budget counts. */
    PIPELINE_MODEL: z.string().min(1).optional(),
    PIPELINE_MODEL_PRICE: price.optional(),
    PIPELINE_MAX_CALLS_PER_PASS: z.coerce.number().int().min(0).default(50),
    /** Paid calls stop for the day once runs since São Paulo midnight cost this much. */
    PIPELINE_DAILY_BUDGET_USD: z.coerce.number().min(0).default(0),
    PIPELINE_LEASE_MS: z.coerce.number().int().min(1_000).default(300_000),
    PIPELINE_CALL_TIMEOUT_MS: z.coerce.number().int().min(100).default(60_000),
  })
  .superRefine((value, ctx) => {
    if (value.PIPELINE_RESOLVE === "shadow" && value.PIPELINE_INTERPRET === "off")
      ctx.addIssue({
        code: "custom",
        path: ["PIPELINE_RESOLVE"],
        message: "resolves observations, so it needs PIPELINE_INTERPRET=shadow",
      });
    if (value.PIPELINE_RESOLVER === "model" && value.PIPELINE_INTERPRETER === "rules")
      ctx.addIssue({
        code: "custom",
        path: ["PIPELINE_RESOLVER"],
        message:
          "model uses the interpreter's model, so PIPELINE_INTERPRETER must be openai or anthropic",
      });
    if (value.PIPELINE_INTERPRETER === "rules") return;
    for (const key of ["PIPELINE_MODEL", "PIPELINE_MODEL_PRICE"] as const) {
      if (value[key] == null) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `required when PIPELINE_INTERPRETER is ${value.PIPELINE_INTERPRETER}`,
        });
      }
    }
  });

export type ModelSettings = {
  provider: "openai" | "anthropic";
  model: string;
  price: { inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number };
};

export type PipelineConfig = {
  interpret: "off" | "shadow";
  resolve: "off" | "shadow";
  projection: "off";
  recommendations: "off";
  interpreter: "rules" | "openai" | "anthropic";
  resolver: "rules" | "model";
  model: ModelSettings | null;
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
  const interpreter = value.PIPELINE_INTERPRETER;
  return {
    interpret: value.PIPELINE_INTERPRET,
    resolve: value.PIPELINE_RESOLVE,
    projection: value.PIPELINE_PROJECTION,
    recommendations: value.PIPELINE_RECOMMENDATIONS,
    interpreter,
    resolver: value.PIPELINE_RESOLVER,
    model:
      interpreter === "rules"
        ? null
        : {
            provider: interpreter,
            model: value.PIPELINE_MODEL!,
            price: value.PIPELINE_MODEL_PRICE!,
          },
    maxCallsPerPass: value.PIPELINE_MAX_CALLS_PER_PASS,
    dailyBudgetUsd: value.PIPELINE_DAILY_BUDGET_USD,
    leaseMs: value.PIPELINE_LEASE_MS,
    callTimeoutMs: value.PIPELINE_CALL_TIMEOUT_MS,
  };
}
