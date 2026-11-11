import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_VERSION,
  anthropicClient,
  costUsd,
  ModelError,
  listModels,
  openaiClient,
} from "@/llm/client";

const KEY = "sk-test-secret-key";
const price = { inputPerMTok: 2, outputPerMTok: 10 };
const call = {
  system: "guide",
  user: "item",
  schema: { type: "object" },
  maxOutputTokens: 500,
};

type Seen = { url: string; init: RequestInit };

function fakeFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const seen: Seen[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { fn, seen };
}

async function failureOf(promise: Promise<unknown>): Promise<ModelError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ModelError) return error;
    throw error;
  }
  throw new Error("expected a ModelError");
}

const openaiOk = (text: string) => ({
  status: "completed",
  output: [
    { type: "reasoning" },
    { type: "message", content: [{ type: "output_text", text }] },
  ],
  usage: { input_tokens: 1200, output_tokens: 300 },
});

describe("openaiClient", () => {
  it("asks for strict JSON and keeps the response out of OpenAI's store", async () => {
    const { fn, seen } = fakeFetch(200, openaiOk('{"ok":true}'));
    const drafter = openaiClient({ key: KEY, model: "gpt-x", price, fetch: fn });
    const reply = await drafter.complete(call);

    expect(reply).toEqual({
      output: { ok: true },
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
    expect(seen[0].url).toBe("https://api.openai.com/v1/responses");
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${KEY}`,
    );
    const body = JSON.parse(seen[0].init.body as string);
    expect(body).toMatchObject({
      model: "gpt-x",
      store: false,
      max_output_tokens: 500,
      input: [
        { role: "system", content: "guide" },
        { role: "user", content: "item" },
      ],
      text: {
        format: { type: "json_schema", strict: true, schema: { type: "object" } },
      },
    });
    expect(drafter.id).toBe("openai-gpt-x");
  });

  it("tells a refusal and a cut-off apart from a bad answer, keeping the tokens paid", async () => {
    const refusal = fakeFetch(200, {
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    const refused = await failureOf(
      openaiClient({ key: KEY, model: "m", price, fetch: refusal.fn }).complete(call),
    );
    expect(refused.kind).toBe("refusal");
    expect(refused.usage).toEqual({ inputTokens: 10, outputTokens: 2 });

    const cut = fakeFetch(200, {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 10, output_tokens: 500 },
    });
    const incomplete = await failureOf(
      openaiClient({ key: KEY, model: "m", price, fetch: cut.fn }).complete(call),
    );
    expect(incomplete.kind).toBe("incomplete");

    const garbled = fakeFetch(200, openaiOk("{not json"));
    expect(
      (
        await failureOf(
          openaiClient({ key: KEY, model: "m", price, fetch: garbled.fn }).complete(
            call,
          ),
        )
      ).kind,
    ).toBe("invalid_json");
  });

  it("retries rate limits and stops on a bad key without echoing it", async () => {
    const limited = fakeFetch(
      429,
      { error: { message: "slow down" } },
      { "retry-after": "7" },
    );
    const busy = await failureOf(
      openaiClient({ key: KEY, model: "m", price, fetch: limited.fn }).complete(call),
    );
    expect(busy.kind).toBe("transient");
    expect(busy.retryAfterMs).toBe(7000);

    const broke = fakeFetch(429, {
      error: {
        message: "You have no credits remaining.",
        type: "insufficient_quota",
        code: "insufficient_quota",
      },
    });
    expect(
      (
        await failureOf(
          openaiClient({ key: KEY, model: "m", price, fetch: broke.fn }).complete(call),
        )
      ).kind,
    ).toBe("fatal");

    const denied = fakeFetch(401, { error: { message: "Incorrect API key provided" } });
    const fatal = await failureOf(
      openaiClient({ key: KEY, model: "m", price, fetch: denied.fn }).complete(call),
    );
    expect(fatal.kind).toBe("fatal");
    expect(fatal.message).toBe("HTTP 401: Incorrect API key provided");
    expect(fatal.message).not.toContain(KEY);
  });
});

describe("anthropicClient", () => {
  it("sends the schema as output_config with the pinned API version", async () => {
    const { fn, seen } = fakeFetch(200, {
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"ok":1}' }],
      usage: { input_tokens: 900, output_tokens: 100 },
    });
    const reply = await anthropicClient({
      key: KEY,
      model: "claude-x",
      price,
      fetch: fn,
    }).complete(call);

    expect(reply).toEqual({
      output: { ok: 1 },
      usage: { inputTokens: 900, outputTokens: 100 },
    });
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(JSON.parse(seen[0].init.body as string)).toEqual({
      model: "claude-x",
      max_tokens: 500,
      system: "guide",
      messages: [{ role: "user", content: "item" }],
      output_config: { format: { type: "json_schema", schema: { type: "object" } } },
    });
  });

  it("classifies refusals, cut-offs and overload", async () => {
    const kinds = [];
    for (const [status, body] of [
      [
        200,
        {
          stop_reason: "refusal",
          content: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ],
      [
        200,
        {
          stop_reason: "max_tokens",
          content: [],
          usage: { input_tokens: 1, output_tokens: 500 },
        },
      ],
      [529, { error: { message: "Overloaded" } }],
      [400, { error: { message: "bad schema" } }],
    ] as const) {
      const { fn } = fakeFetch(status, body);
      kinds.push(
        (
          await failureOf(
            anthropicClient({ key: KEY, model: "m", price, fetch: fn }).complete(call),
          )
        ).kind,
      );
    }
    expect(kinds).toEqual(["refusal", "incomplete", "transient", "fatal"]);
  });
});

describe("listModels", () => {
  it("returns sorted ids only", async () => {
    const { fn, seen } = fakeFetch(200, {
      data: [{ id: "b-model", owned_by: "x" }, { id: "a-model" }],
    });
    expect(await listModels("anthropic", KEY, fn)).toEqual(["a-model", "b-model"]);
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/models?limit=1000");
  });
});

describe("costUsd", () => {
  it("prices tokens per million", () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 100_000 }, price)).toBe(3);
  });

  it("charges cache reads at their own rate, or as input when none is given", () => {
    const usage = { inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 };
    expect(costUsd(usage, { ...price, cachedInputPerMTok: 0.2 })).toBe(0.2);
    expect(costUsd(usage, price)).toBe(2);
  });
});
