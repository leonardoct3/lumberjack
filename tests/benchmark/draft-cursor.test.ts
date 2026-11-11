import { AuthenticationError, NetworkError, RateLimitError } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import {
  cursorClient,
  type CursorRunRequest,
  type CursorRunResult,
  extractJson,
  makerOf,
  translateSdkError,
} from "@/benchmark/draft/cursor";
import { ModelError } from "@/llm/client";

const price = { inputPerMTok: 5, outputPerMTok: 25 };
const call = {
  system: "guide",
  user: "item",
  schema: { type: "object" },
  maxOutputTokens: 500,
};
const usage = { inputTokens: 100, outputTokens: 20 };

function fakeRunner(result: CursorRunResult) {
  const seen: CursorRunRequest[] = [];
  return {
    seen,
    runner: async (request: CursorRunRequest) => {
      seen.push(request);
      return result;
    },
  };
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

describe("cursorClient", () => {
  it("names the model's maker and the route, and puts the schema in the system prompt", async () => {
    const { runner, seen } = fakeRunner({
      status: "finished",
      text: '{"ok":true}',
      usage,
    });
    const drafter = cursorClient({
      key: "crsr_secret",
      model: "claude-opus-5-5",
      params: [{ id: "thinking", value: "high" }],
      price,
      runner,
    });

    expect(await drafter.complete(call)).toEqual({ output: { ok: true }, usage });
    expect(drafter).toMatchObject({
      id: "cursor-claude-opus-5-5-thinking-high",
      provider: "anthropic",
      route: "cursor",
    });
    expect(seen[0]).toMatchObject({
      apiKey: "crsr_secret",
      model: { id: "claude-opus-5-5", params: [{ id: "thinking", value: "high" }] },
    });
    expect(seen[0].prompt.startsWith("guide")).toBe(true);
    expect(seen[0].prompt).toContain('{"type":"object"}');
    expect(seen[0].prompt.endsWith("item")).toBe(true);
  });

  it("stops when the account rejects the request instead of retrying it", async () => {
    const rejected = fakeRunner({
      status: "error",
      error: {
        message:
          "[invalid_argument] Custom system prompt is not enabled for this account.",
      },
    });
    const error = await failureOf(
      cursorClient({
        key: "k",
        model: "gpt-6.1-sol",
        price,
        runner: rejected.runner,
      }).complete(call),
    );
    expect(error.kind).toBe("fatal");
  });

  it("treats a cancelled or failed run as worth retrying and keeps the tokens it cost", async () => {
    const cancelled = fakeRunner({ status: "cancelled", usage });
    const timedOut = await failureOf(
      cursorClient({
        key: "k",
        model: "gpt-6.1-sol",
        price,
        runner: cancelled.runner,
      }).complete(call),
    );
    expect([timedOut.kind, timedOut.usage]).toEqual(["transient", usage]);

    const failed = fakeRunner({ status: "error", error: { message: "stalled" } });
    const error = await failureOf(
      cursorClient({
        key: "k",
        model: "gpt-6.1-sol",
        price,
        runner: failed.runner,
      }).complete(call),
    );
    expect([error.kind, error.message]).toEqual(["transient", "run error: stalled"]);
  });
});

describe("makerOf", () => {
  it("names whose model answers, and refuses one it cannot tell", () => {
    expect(makerOf("claude-sonnet-5-5")).toBe("anthropic");
    expect(makerOf("gpt-6.1-sol")).toBe("openai");
    expect(makerOf("gemini-3.5-flash")).toBe("google");
    expect(makerOf("composer-2.5")).toBe("cursor");
    expect(() => makerOf("auto-smart")).toThrow(/not from a maker/);
  });
});

describe("extractJson", () => {
  it("reads JSON wrapped in prose or a code fence", () => {
    expect(extractJson('Here it is:\n```json\n{"a":[1]}\n```', usage)).toEqual({
      a: [1],
    });
    expect(() => extractJson("I cannot help with that.", usage)).toThrow(ModelError);
  });
});

describe("translateSdkError", () => {
  it("stops on bad credentials or a spent usage cap and retries the network", () => {
    const kind = (error: unknown) => (translateSdkError(error) as ModelError).kind;
    expect(kind(new AuthenticationError("Invalid API key"))).toBe("fatal");
    expect(
      kind(new RateLimitError("Usage limit exceeded", { isRetryable: false })),
    ).toBe("fatal");
    expect(kind(new RateLimitError("Rate limit exceeded", { isRetryable: true }))).toBe(
      "transient",
    );
    expect(kind(new NetworkError("Service unavailable", { isRetryable: true }))).toBe(
      "transient",
    );
    const other = new Error("bug");
    expect(translateSdkError(other)).toBe(other);
  });
});
