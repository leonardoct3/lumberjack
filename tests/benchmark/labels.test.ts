import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLabel, createLabelStore, latestAnnotations } from "@/benchmark/labels";

const text = "vendo 2 pista onix";
const at = {
  messageId: "msg_1",
  annotator: "lc",
  now: new Date("2026-11-04T15:00:00Z"),
};
const context = { text, availableContext: ["msg_0", "party-1"] };

function body(overrides: Record<string, unknown> = {}) {
  return {
    needsReview: false,
    contextUsed: [],
    notes: null,
    observations: [
      {
        intent: "offer",
        event: { mention: "onix", partyId: null, resolution: "not_mentioned" },
        ticketCategory: "pista",
        quantity: 2,
        price: null,
        eventDate: null,
        spans: [{ start: 0, end: 18, text }],
        relationship: { kind: "none", relatedMessage: null },
        ambiguities: [],
      },
    ],
    ...overrides,
  };
}

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("latestAnnotations", () => {
  it("keeps the last label per message, in the order messages were first labelled", () => {
    const records = [
      { messageId: "a", v: 1 },
      { messageId: "b", v: 1 },
      { messageId: "a", v: 2 },
    ];
    expect(latestAnnotations(records)).toEqual([
      { messageId: "a", v: 2 },
      { messageId: "b", v: 1 },
    ]);
  });
});

describe("buildLabel", () => {
  it("stamps who, when and what on the server side, whatever the client sent", () => {
    const { annotation, errors } = buildLabel(
      body({
        source: "model_draft",
        annotator: "someone",
        messageId: "msg_9",
        schemaVersion: 7,
      }),
      at,
      context,
    );
    expect(errors).toEqual([]);
    expect(annotation).toMatchObject({
      schemaVersion: 1,
      messageId: "msg_1",
      annotator: "lc",
      annotatedAt: "2026-11-04T15:00:00.000Z",
      source: "human",
    });
  });

  it("refuses a label whose evidence the message does not support", () => {
    const bad = body();
    (bad.observations[0] as { spans: unknown[] }).spans = [];
    expect(buildLabel(bad, at, context)).toEqual({
      annotation: null,
      errors: ["observations[0] needs at least one supporting span"],
    });
  });

  it("refuses context the labeller was never shown", () => {
    expect(
      buildLabel(body({ contextUsed: ["msg_later"] }), at, context).errors,
    ).toEqual(["contextUsed msg_later was not offered as context"]);
  });
});

describe("createLabelStore", () => {
  it("appends privately and reads back the latest label per message", () => {
    dir = mkdtempSync(path.join(tmpdir(), "labels-"));
    const file = path.join(dir, "labels", "lc.jsonl");
    const store = createLabelStore(file);
    const first = buildLabel(body(), at, context).annotation!;
    const edited = buildLabel(body({ notes: "second look" }), at, context).annotation!;
    store.append(first);
    store.append(edited);

    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    const reopened = createLabelStore(file);
    expect(reopened.all()).toHaveLength(2);
    expect(reopened.latest().get("msg_1")?.notes).toBe("second look");
  });
});
