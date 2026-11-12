/** APIs this module calls directly; OpenRouter resells other makers' models. */
export type Provider = "openai" | "anthropic" | "openrouter";
/** Whose model answers, whichever route the call takes. */
export type Maker =
  "openai" | "anthropic" | "google" | "xai" | "cursor" | "deepseek" | "other";

export type Price = {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Cache reads; without it they are charged as fresh input, which only overstates spend. */
  cachedInputPerMTok?: number;
};

export type ModelCall = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  /** Named in OpenAI's request; letters, digits, _ and - only. */
  schemaName?: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  /** Served from the prompt cache, on top of `inputTokens`. */
  cachedInputTokens?: number;
};

export type ModelReply = { output: unknown; usage: Usage };

/**
 * transient: worth retrying. refusal and incomplete: the model answered but
 * not with an answer. fatal: retrying cannot help (bad key, bad request).
 */
export type ModelErrorKind =
  "transient" | "refusal" | "incomplete" | "invalid_json" | "fatal";

export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
    readonly usage?: Usage,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type ModelClient = {
  /** Also the annotator and file name of what it writes. */
  id: string;
  /** Whose model answers, which is what makes two answers independent. */
  provider: Maker;
  /** How the call gets there: the maker's own API, OpenRouter, or Cursor's agent runtime. */
  route: "api" | "openrouter" | "cursor";
  model: string;
  params?: { id: string; value: string }[];
  price: Price;
  /** Input the route adds on its own, so the budget reservation stays an upper bound. */
  promptOverheadTokens?: number;
  complete(call: ModelCall): Promise<ModelReply>;
};

type Fetch = typeof fetch;

export const ANTHROPIC_VERSION = "2026-10-21";

const ENDPOINTS = {
  openai: {
    complete: "https://api.openai.com/v1/responses",
    models: "https://api.openai.com/v1/models",
  },
  anthropic: {
    complete: "https://api.anthropic.com/v1/messages",
    models: "https://api.anthropic.com/v1/models?limit=1000",
  },
  openrouter: {
    complete: "https://openrouter.ai/api/v1/chat/completions",
    models: "https://openrouter.ai/api/v1/models",
  },
};

function headers(provider: Provider, key: string): Record<string, string> {
  return provider !== "anthropic"
    ? { authorization: `Bearer ${key}`, "content-type": "application/json" }
    : {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      };
}

export function clientId(prefix: string, model: string): string {
  return `${prefix}-${model}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 64);
}

/** Error bodies name the problem, never the key, so their message is safe to surface. */
async function failure(response: Response): Promise<ModelError> {
  let detail = "";
  let code: unknown;
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown; code?: unknown; type?: unknown };
    };
    if (typeof body.error?.message === "string")
      detail = `: ${body.error.message.slice(0, 300)}`;
    code = body.error?.code ?? body.error?.type;
  } catch {
    // An unreadable body still has a status worth reporting.
  }
  const message = `HTTP ${response.status}${detail}`;
  const retryAfter = Number(response.headers.get("retry-after"));
  const retryAfterMs =
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
  // OpenAI reports an empty balance as a 429, which waiting never fixes.
  const outOfCredit = code === "insufficient_quota";
  const transient =
    !outOfCredit &&
    (response.status === 408 ||
      response.status === 409 ||
      response.status === 429 ||
      response.status >= 500);
  return new ModelError(
    transient ? "transient" : "fatal",
    message,
    undefined,
    retryAfterMs,
  );
}

async function post(
  fetchFn: Fetch,
  provider: Provider,
  key: string,
  body: unknown,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetchFn(ENDPOINTS[provider].complete, {
      method: "POST",
      headers: headers(provider, key),
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new ModelError("transient", "timed out");
    throw new ModelError("transient", `network error: ${(error as Error).message}`);
  }
  if (!response.ok) throw await failure(response);
  return (await response.json()) as Record<string, unknown>;
}

function parseJson(text: string, usage: Usage): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelError("invalid_json", "the answer was not valid JSON", usage);
  }
}

type OpenAIResponse = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: {
    type: string;
    content?: { type: string; text?: string; refusal?: string }[];
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function openaiClient(options: {
  key: string;
  model: string;
  price: Price;
  fetch?: Fetch;
}): ModelClient {
  const fetchFn = options.fetch ?? fetch;
  return {
    id: clientId("openai", options.model),
    provider: "openai",
    route: "api",
    model: options.model,
    price: options.price,
    async complete(call) {
      const body = (await post(
        fetchFn,
        "openai",
        options.key,
        {
          model: options.model,
          input: [
            { role: "system", content: call.system },
            { role: "user", content: call.user },
          ],
          text: {
            format: {
              type: "json_schema",
              name: call.schemaName ?? "answer",
              schema: call.schema,
              strict: true,
            },
          },
          max_output_tokens: call.maxOutputTokens,
          // Responses are kept for 30 days unless told otherwise.
          store: false,
        },
        call.signal,
      )) as OpenAIResponse;
      const usage = {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
      if (body.status === "incomplete") {
        throw new ModelError(
          "incomplete",
          `incomplete: ${body.incomplete_details?.reason ?? "unknown"}`,
          usage,
        );
      }
      const parts = (body.output ?? [])
        .filter((o) => o.type === "message")
        .flatMap((o) => o.content ?? []);
      if (parts.some((p) => p.type === "refusal"))
        throw new ModelError("refusal", "the model refused", usage);
      const text = parts.find((p) => p.type === "output_text")?.text;
      if (text == null) throw new ModelError("invalid_json", "no output text", usage);
      return { output: parseJson(text, usage), usage };
    },
  };
}

type AnthropicResponse = {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function anthropicClient(options: {
  key: string;
  model: string;
  price: Price;
  fetch?: Fetch;
}): ModelClient {
  const fetchFn = options.fetch ?? fetch;
  return {
    id: clientId("anthropic", options.model),
    provider: "anthropic",
    route: "api",
    model: options.model,
    price: options.price,
    async complete(call) {
      const body = (await post(
        fetchFn,
        "anthropic",
        options.key,
        {
          model: options.model,
          max_tokens: call.maxOutputTokens,
          system: call.system,
          messages: [{ role: "user", content: call.user }],
          output_config: { format: { type: "json_schema", schema: call.schema } },
        },
        call.signal,
      )) as AnthropicResponse;
      const usage = {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
      if (body.stop_reason === "refusal")
        throw new ModelError("refusal", "the model refused", usage);
      if (body.stop_reason === "max_tokens")
        throw new ModelError("incomplete", "incomplete: max_tokens", usage);
      const text = (body.content ?? []).find((c) => c.type === "text")?.text;
      if (text == null) throw new ModelError("invalid_json", "no output text", usage);
      return { output: parseJson(text, usage), usage };
    },
  };
}

type ChatResponse = {
  error?: { message?: string };
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

const MAKERS: Record<string, Maker> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "x-ai": "xai",
  deepseek: "deepseek",
};

/** OpenRouter model ids are `maker/model`. */
export function openrouterMaker(model: string): Maker {
  return MAKERS[model.split("/")[0]] ?? "other";
}

export function openrouterClient(options: {
  key: string;
  model: string;
  price: Price;
  fetch?: Fetch;
}): ModelClient {
  const fetchFn = options.fetch ?? fetch;
  return {
    id: clientId("openrouter", options.model),
    provider: openrouterMaker(options.model),
    route: "openrouter",
    model: options.model,
    price: options.price,
    async complete(call) {
      const body = (await post(
        fetchFn,
        "openrouter",
        options.key,
        {
          model: options.model,
          messages: [
            { role: "system", content: call.system },
            { role: "user", content: call.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: call.schemaName ?? "answer",
              strict: true,
              schema: call.schema,
            },
          },
          max_tokens: call.maxOutputTokens,
          // Only providers that honour the schema, and none that keep prompts for training.
          provider: { require_parameters: true, data_collection: "deny" },
        },
        call.signal,
      )) as ChatResponse;
      const cached = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const usage = {
        inputTokens: (body.usage?.prompt_tokens ?? 0) - cached,
        outputTokens: body.usage?.completion_tokens ?? 0,
        cachedInputTokens: cached,
      };
      // A provider failing after the request was accepted still answers 200.
      if (body.error)
        throw new ModelError(
          "transient",
          `provider error: ${String(body.error.message ?? "unknown").slice(0, 300)}`,
          usage,
        );
      const choice = body.choices?.[0];
      if (choice?.message?.refusal || choice?.finish_reason === "content_filter")
        throw new ModelError("refusal", "the model refused", usage);
      if (choice?.finish_reason === "length")
        throw new ModelError("incomplete", "incomplete: max_tokens", usage);
      const text = choice?.message?.content;
      if (text == null) throw new ModelError("invalid_json", "no output text", usage);
      return { output: parseJson(text, usage), usage };
    },
  };
}

/** Ids only: the listing is how the strongest available model gets picked, by a person. */
export async function listModels(
  provider: Provider,
  key: string,
  fetchFn: Fetch = fetch,
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchFn(ENDPOINTS[provider].models, {
      headers: headers(provider, key),
    });
  } catch (error) {
    throw new ModelError("transient", `network error: ${(error as Error).message}`);
  }
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { data?: { id?: unknown }[] };
  return (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string")
    .sort();
}

export function costUsd(usage: Usage, price: Price): number {
  return (
    (usage.inputTokens * price.inputPerMTok +
      (usage.cachedInputTokens ?? 0) *
        (price.cachedInputPerMTok ?? price.inputPerMTok) +
      usage.outputTokens * price.outputPerMTok) /
    1_000_000
  );
}
