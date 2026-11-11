export type Provider = "openai" | "anthropic";

export type Price = { inputPerMTok: number; outputPerMTok: number };

export type DraftCall = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  signal?: AbortSignal;
};

export type Usage = { inputTokens: number; outputTokens: number };

export type DraftReply = { output: unknown; usage: Usage };

/**
 * transient: worth retrying. refusal and incomplete: the model answered but
 * not with a label. fatal: retrying cannot help (bad key, bad request).
 */
export type DraftErrorKind =
  "transient" | "refusal" | "incomplete" | "invalid_json" | "fatal";

export class DraftError extends Error {
  constructor(
    readonly kind: DraftErrorKind,
    message: string,
    readonly usage?: Usage,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type Drafter = {
  /** Also the annotator and the draft file name. */
  id: string;
  provider: Provider;
  model: string;
  price: Price;
  draft(call: DraftCall): Promise<DraftReply>;
};

type Fetch = typeof fetch;

export const ANTHROPIC_VERSION = "2026-10-21";

const ENDPOINTS = {
  openai: {
    draft: "https://api.openai.com/v1/responses",
    models: "https://api.openai.com/v1/models",
  },
  anthropic: {
    draft: "https://api.anthropic.com/v1/messages",
    models: "https://api.anthropic.com/v1/models?limit=1000",
  },
};

function headers(provider: Provider, key: string): Record<string, string> {
  return provider === "openai"
    ? { authorization: `Bearer ${key}`, "content-type": "application/json" }
    : {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      };
}

export function drafterId(provider: Provider, model: string): string {
  return `${provider}-${model}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 64);
}

/** Error bodies name the problem, never the key, so their message is safe to surface. */
async function failure(response: Response): Promise<DraftError> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string")
      detail = `: ${body.error.message.slice(0, 300)}`;
  } catch {
    // An unreadable body still has a status worth reporting.
  }
  const message = `HTTP ${response.status}${detail}`;
  const retryAfter = Number(response.headers.get("retry-after"));
  const retryAfterMs =
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
  const transient =
    response.status === 408 ||
    response.status === 409 ||
    response.status === 429 ||
    response.status >= 500;
  return new DraftError(
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
    response = await fetchFn(ENDPOINTS[provider].draft, {
      method: "POST",
      headers: headers(provider, key),
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new DraftError("transient", "timed out");
    throw new DraftError("transient", `network error: ${(error as Error).message}`);
  }
  if (!response.ok) throw await failure(response);
  return (await response.json()) as Record<string, unknown>;
}

function parseJson(text: string, usage: Usage): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new DraftError("invalid_json", "the answer was not valid JSON", usage);
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

export function openaiDrafter(options: {
  key: string;
  model: string;
  price: Price;
  fetch?: Fetch;
}): Drafter {
  const fetchFn = options.fetch ?? fetch;
  return {
    id: drafterId("openai", options.model),
    provider: "openai",
    model: options.model,
    price: options.price,
    async draft(call) {
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
              name: "label_draft",
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
        throw new DraftError(
          "incomplete",
          `incomplete: ${body.incomplete_details?.reason ?? "unknown"}`,
          usage,
        );
      }
      const parts = (body.output ?? [])
        .filter((o) => o.type === "message")
        .flatMap((o) => o.content ?? []);
      if (parts.some((p) => p.type === "refusal"))
        throw new DraftError("refusal", "the model refused", usage);
      const text = parts.find((p) => p.type === "output_text")?.text;
      if (text == null) throw new DraftError("invalid_json", "no output text", usage);
      return { output: parseJson(text, usage), usage };
    },
  };
}

type AnthropicResponse = {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function anthropicDrafter(options: {
  key: string;
  model: string;
  price: Price;
  fetch?: Fetch;
}): Drafter {
  const fetchFn = options.fetch ?? fetch;
  return {
    id: drafterId("anthropic", options.model),
    provider: "anthropic",
    model: options.model,
    price: options.price,
    async draft(call) {
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
        throw new DraftError("refusal", "the model refused", usage);
      if (body.stop_reason === "max_tokens")
        throw new DraftError("incomplete", "incomplete: max_tokens", usage);
      const text = (body.content ?? []).find((c) => c.type === "text")?.text;
      if (text == null) throw new DraftError("invalid_json", "no output text", usage);
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
    throw new DraftError("transient", `network error: ${(error as Error).message}`);
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
      usage.outputTokens * price.outputPerMTok) /
    1_000_000
  );
}
