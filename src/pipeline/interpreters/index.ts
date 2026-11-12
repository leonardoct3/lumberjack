import { anthropicClient, openaiClient } from "@/llm/client";
import type { PipelineConfig } from "../config";
import type { Interpreter } from "../interpreter";
import { modelInterpreter } from "./model";
import { rulesInterpreter } from "./rules";

const KEYS = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" } as const;

/** Keys come from the environment only, and only when a model interpreter is chosen. */
export function interpreterFor(
  config: PipelineConfig,
  env: Record<string, string | undefined> = process.env,
): Interpreter {
  if (!config.model) return rulesInterpreter;
  const { provider, model, price } = config.model;
  const key = env[KEYS[provider]]?.trim();
  if (!key)
    throw new Error(`${KEYS[provider]} is required for the ${provider} interpreter`);
  const client =
    provider === "openai"
      ? openaiClient({ key, model, price })
      : anthropicClient({ key, model, price });
  return modelInterpreter(client);
}
