import {
  anthropicClient,
  openaiClient,
  openrouterClient,
  type ModelClient,
} from "@/llm/client";
import type { PipelineConfig } from "../config";
import type { Interpreter } from "../interpreter";
import type { Resolver } from "../resolution";
import { modelResolver } from "../resolvers/model";
import { rulesResolver } from "../resolvers/rules";
import { modelInterpreter } from "./model";
import { rulesInterpreter } from "./rules";

const KEYS = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;
const CLIENTS = {
  openai: openaiClient,
  anthropic: anthropicClient,
  openrouter: openrouterClient,
} as const;

/** Keys come from the environment only, and only when a model is chosen. */
function clientFor(
  config: PipelineConfig,
  env: Record<string, string | undefined>,
): ModelClient | null {
  if (!config.model) return null;
  const { provider, model, price } = config.model;
  const key = env[KEYS[provider]]?.trim();
  if (!key)
    throw new Error(`${KEYS[provider]} is required for the ${provider} interpreter`);
  return CLIENTS[provider]({ key, model, price });
}

export function interpreterFor(
  config: PipelineConfig,
  env: Record<string, string | undefined> = process.env,
): Interpreter {
  const client = clientFor(config, env);
  return client ? modelInterpreter(client) : rulesInterpreter;
}

export function resolverFor(
  config: PipelineConfig,
  env: Record<string, string | undefined> = process.env,
): Resolver {
  if (config.resolver === "rules") return rulesResolver;
  return modelResolver(clientFor(config, env)!);
}
