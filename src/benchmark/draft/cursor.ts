import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Agent,
  AuthenticationError,
  ConfigurationError,
  Cursor,
  CursorSdkError,
  JsonlLocalAgentStore,
  type ModelParameterValue,
  RateLimitError,
} from "@cursor/sdk";
import {
  DraftError,
  drafterId,
  type Drafter,
  type Price,
  type Provider,
  type Usage,
} from "./providers";

export type CursorRunRequest = {
  apiKey: string;
  model: { id: string; params?: ModelParameterValue[] };
  systemPrompt: string;
  prompt: string;
  signal?: AbortSignal;
};

export type CursorRunResult = {
  status: "finished" | "error" | "cancelled" | "running";
  text?: string;
  error?: string;
  usage?: Usage;
};

export type CursorRunner = (request: CursorRunRequest) => Promise<CursorRunResult>;

/** Drafts go through Cursor's agent runtime, so the drafter must say whose model answered. */
export function makerOf(model: string): Provider {
  if (/^claude/i.test(model)) return "anthropic";
  if (/^(gpt|o\d|chatgpt)/i.test(model)) return "openai";
  throw new Error(`${model} is neither an OpenAI nor an Anthropic model`);
}

export function translateSdkError(error: unknown): unknown {
  if (!(error instanceof CursorSdkError)) return error;
  const message = `${error.name}: ${error.message}`.slice(0, 300);
  if (error instanceof AuthenticationError || error instanceof ConfigurationError) {
    return new DraftError("fatal", message);
  }
  // A monthly usage cap is a rate limit that waiting does not lift.
  if (error instanceof RateLimitError && !error.isRetryable)
    return new DraftError("fatal", message);
  return new DraftError("transient", message);
}

/**
 * One throwaway local agent per call: no tools, no ambient settings, an empty
 * working directory, and a conversation store deleted with it, so message
 * text never outlives the call on disk.
 */
export const sdkRunner: CursorRunner = async (request) => {
  const root = mkdtempSync(path.join(tmpdir(), "lj-draft-"));
  const work = path.join(root, "work");
  mkdirSync(work, { mode: 0o700 });
  try {
    const agent = await Agent.create({
      apiKey: request.apiKey,
      model: request.model,
      tools: [],
      systemPrompt: request.systemPrompt,
      local: { cwd: work, store: new JsonlLocalAgentStore(path.join(root, "store")) },
    });
    try {
      const run = await agent.send(request.prompt);
      const cancel = () => void run.cancel().catch(() => {});
      request.signal?.addEventListener("abort", cancel, { once: true });
      try {
        const result = await run.wait();
        const usage = result.usage && {
          // Cache reads and writes are input too; pricing them as input keeps the budget conservative.
          inputTokens:
            result.usage.inputTokens +
            result.usage.cacheReadTokens +
            result.usage.cacheWriteTokens,
          outputTokens: result.usage.outputTokens,
        };
        return {
          status: result.status,
          text: result.result,
          error: result.error?.message,
          usage,
        };
      } finally {
        request.signal?.removeEventListener("abort", cancel);
      }
    } finally {
      await agent[Symbol.asyncDispose]();
    }
  } catch (error) {
    throw translateSdkError(error);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

/** Agents answer in prose around the JSON at times; the validator decides whether what is inside is any good. */
export function extractJson(text: string, usage: Usage): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Falls through to the same error as no JSON at all.
    }
  }
  throw new DraftError("invalid_json", "the answer held no JSON object", usage);
}

export function cursorDrafter(options: {
  key: string;
  model: string;
  params?: ModelParameterValue[];
  price: Price;
  runner?: CursorRunner;
}): Drafter {
  const runner = options.runner ?? sdkRunner;
  const suffix = (options.params ?? []).map((p) => `${p.id}-${p.value}`).join("-");
  return {
    id: drafterId("cursor", suffix ? `${options.model}-${suffix}` : options.model),
    provider: makerOf(options.model),
    route: "cursor",
    model: options.model,
    params: options.params,
    price: options.price,
    async draft(call) {
      const result = await runner({
        apiKey: options.key,
        model: { id: options.model, params: options.params },
        systemPrompt: `${call.system}\n\n# Output\nAnswer with one JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(call.schema)}`,
        prompt: call.user,
        signal: call.signal,
      });
      const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
      if (result.status === "cancelled")
        throw new DraftError("transient", "timed out", usage);
      if (result.status !== "finished") {
        throw new DraftError(
          "transient",
          `run ${result.status}: ${result.error ?? "no detail"}`,
          usage,
        );
      }
      if (result.text == null)
        throw new DraftError("invalid_json", "no output text", usage);
      return { output: extractJson(result.text, usage), usage };
    },
  };
}

export type CursorModel = {
  id: string;
  parameters: { id: string; values: string[] }[];
};

export async function listCursorModels(key: string): Promise<CursorModel[]> {
  try {
    const models = await Cursor.models.list({ apiKey: key });
    return models
      .map((m) => ({
        id: m.id,
        parameters: (m.parameters ?? []).map((p) => ({
          id: p.id,
          values: p.values.map((v) => v.value),
        })),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    throw translateSdkError(error);
  }
}
