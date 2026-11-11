import type { FailureKind } from "@prisma/client";
import { costUsd, ModelError, type ModelClient, type Usage } from "@/llm/client";
import { INTENTS } from "../evidence";
import {
  InterpreterError,
  type Interpreter,
  type InterpretationRequest,
  type Usage as RunUsage,
} from "../interpreter";
import { validateInterpretation } from "../observation";
import { INTERPRETER_GUIDE, PROMPT_VERSION, renderRequest, renderRetry } from "./guide";

type JsonSchema = Record<string, unknown>;
const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: "null" }],
});
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: "string" };
const integer = { type: "integer" };
const oneOf = (values: readonly string[]) => ({ type: "string", enum: [...values] });

/**
 * Strict-mode compatible: every property required, no numeric bounds. The
 * model quotes its evidence and the offsets are found here, since models
 * miscount characters.
 */
export const INTERPRETATION_JSON_SCHEMA: JsonSchema = object({
  observations: {
    type: "array",
    items: object({
      intent: oneOf(INTENTS),
      eventMention: nullable(string),
      ticketCategory: nullable(string),
      quantity: nullable(integer),
      price: nullable(
        object({
          amount: { type: "number" },
          currency: oneOf(["BRL", "other"]),
          meaning: oneOf(["asking", "offered", "official", "paid", "unknown"]),
        }),
      ),
      eventDate: nullable(
        object({
          year: nullable(integer),
          month: nullable(integer),
          day: nullable(integer),
          basis: oneOf(["explicit", "inferred"]),
        }),
      ),
      quotes: { type: "array", items: string },
      relationship: object({
        kind: oneOf([
          "none",
          "duplicate",
          "renewed_intent",
          "price_update",
          "withdrawal",
          "unknown",
        ]),
        relatedMessage: nullable(string),
      }),
      ambiguities: { type: "array", items: string },
    }),
  },
});

/** Quotes become spans; anything that is not an exact substring is reported for the retry. */
export function quotesToSpans(
  output: unknown,
  text: string,
): { output: unknown; errors: string[] } {
  const observations = (output as { observations?: unknown })?.observations;
  if (!Array.isArray(observations)) return { output, errors: [] };
  const errors: string[] = [];
  const converted = observations.map((raw, i) => {
    if (raw == null || typeof raw !== "object" || !("quotes" in raw)) return raw;
    const { quotes, ...rest } = raw as { quotes: unknown };
    const spans = (Array.isArray(quotes) ? quotes : []).flatMap((quote, j) => {
      const start =
        typeof quote === "string" && quote.length > 0 ? text.indexOf(quote) : -1;
      if (start < 0) {
        errors.push(
          `observations[${i}].quotes[${j}] is not an exact substring of the message`,
        );
        return [];
      }
      return [{ start, end: start + (quote as string).length, text: quote as string }];
    });
    return { ...rest, spans };
  });
  return { output: { observations: converted }, errors };
}

const KIND: Record<ModelError["kind"], FailureKind> = {
  transient: "transient",
  refusal: "refusal",
  incomplete: "schema",
  invalid_json: "schema",
  // A bad key or request: retrying the job cannot fix it.
  fatal: "internal",
};

const add = (a: Usage, b: Usage | undefined): Usage => ({
  inputTokens: a.inputTokens + (b?.inputTokens ?? 0),
  outputTokens: a.outputTokens + (b?.outputTokens ?? 0),
  cachedInputTokens: (a.cachedInputTokens ?? 0) + (b?.cachedInputTokens ?? 0),
});

/**
 * A language model behind any `ModelClient`. An answer that fails validation
 * gets one corrective retry; if that fails too, it is returned as is and the
 * pipeline records it as a schema failure.
 */
export const MAX_OUTPUT_TOKENS = 4_000;

export function modelInterpreter(
  client: ModelClient,
  options: { maxOutputTokens?: number } = {},
): Interpreter {
  const maxOutputTokens = options.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
  const params = (client.params ?? []).map((p) => `${p.id}=${p.value}`).join(",");
  return {
    name: "model",
    version: "1",
    provider: `${client.provider}${client.route === "api" ? "" : `@${client.route}`}`,
    model: params ? `${client.model}:${params}` : client.model,
    promptVersion: PROMPT_VERSION,
    paid: true,
    async interpret(request: InterpretationRequest, signal: AbortSignal) {
      let usage: Usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      const runUsage = (): RunUsage => ({
        inputTokens: usage.inputTokens + (usage.cachedInputTokens ?? 0),
        outputTokens: usage.outputTokens,
        costUsd: costUsd(usage, client.price),
      });
      const ask = async (user: string) => {
        try {
          const reply = await client.complete({
            system: INTERPRETER_GUIDE,
            user,
            schema: INTERPRETATION_JSON_SCHEMA,
            schemaName: "interpretation",
            maxOutputTokens,
            signal,
          });
          usage = add(usage, reply.usage);
          const converted = quotesToSpans(reply.output, request.text);
          const checked = validateInterpretation(converted.output, request);
          return {
            output: converted.output,
            errors: [...converted.errors, ...checked.errors],
          };
        } catch (error) {
          if (!(error instanceof ModelError)) throw error;
          usage = add(usage, error.usage);
          throw new InterpreterError(KIND[error.kind], error.message, runUsage());
        }
      };

      let answer = await ask(renderRequest(request));
      if (answer.errors.length > 0)
        answer = await ask(renderRetry(request, answer.errors));
      return { output: answer.output, usage: runUsage() };
    },
  };
}
