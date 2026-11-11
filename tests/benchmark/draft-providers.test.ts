import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_VERSION,
  anthropicDrafter,
  costUsd,
  DraftError,
  listModels,
  openaiDrafter,
} from "@/benchmark/draft/providers";

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

async function failureOf(promise: Promise<unknown>): Promise<DraftError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DraftError) return error;
    throw error;
  }
  throw new Error("expected a DraftError");
}

const openaiOk = (text: string) => ({
  status: "completed",
  output: [
    { type: "reasoning" },
    { type: "message", content: [{ type: "output_text", text }] },
  ],
  usage: { input_tokens: 1200, output_tokens: 300 },
});

describe("openaiDrafter", () => {
  it("asks for strict JSON and keeps the response out of OpenAI's store", async () => {
    const { fn, seen } = fakeFetch(200, openaiOk('{"ok":true}'));
    const drafter = openaiDrafter({ key: KEY, model: "gpt-x", price, fetch: fn });
    const reply = await drafter.draft(call);

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
      openaiDrafter({ key: KEY, model: "m", price, fetch: refusal.fn }).draft(call),
    );
    expect(refused.kind).toBe("refusal");
    expect(refused.usage).toEqual({ inputTokens: 10, outputTokens: 2 });

    const cut = fakeFetch(200, {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 10, output_tokens: 500 },
    });
    const incomplete = await failureOf(
      openaiDrafter({ key: KEY, model: "m", price, fetch: cut.fn }).draft(call),
    );
    expect(incomplete.kind).toBe("incomplete");

    const garbled = fakeFetch(200, openaiOk("{not json"));
    expect(
      (
        await failureOf(
          openaiDrafter({ key: KEY, model: "m", price, fetch: garbled.fn }).draft(call),
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
      openaiDrafter({ key: KEY, model: "m", price, fetch: limited.fn }).draft(call),
    );
    expect(busy.kind).toBe("transient");
    expect(busy.retryAfterMs).toBe(7000);

    const denied = fakeFetch(401, { error: { message: "Incorrect API key provided" } });
    const fatal = await failureOf(
      openaiDrafter({ key: KEY, model: "m", price, fetch: denied.fn }).draft(call),
    );
    expect(fatal.kind).toBe("fatal");
    expect(fatal.message).toBe("HTTP 401: Incorrect API key provided");
    expect(fatal.message).not.toContain(KEY);
  });
});

describe("anthropicDrafter", () => {
  it("sends the schema as output_config with the pinned API version", async () => {
    const { fn, seen } = fakeFetch(200, {
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"ok":1}' }],
      usage: { input_tokens: 900, output_tokens: 100 },
    });
    const reply = await anthropicDrafter({
      key: KEY,
      model: "claude-x",
      price,
      fetch: fn,
    }).draft(call);

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
            anthropicDrafter({ key: KEY, model: "m", price, fetch: fn }).draft(call),
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
});
