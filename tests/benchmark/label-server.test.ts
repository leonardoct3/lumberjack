import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoadedExport } from "@/benchmark/dataset";
import type { LabelItem } from "@/benchmark/label/item";
import { startLabelServer } from "@/benchmark/label/server";
import { createLabelStore, type LabelStore } from "@/benchmark/labels";

const TOKEN = "a".repeat(64);
const text = "vendo 2 pista onix";

const data: LoadedExport = {
  dir: "/tmp/x",
  manifest: {} as LoadedExport["manifest"],
  messages: [
    {
      id: "msg_1",
      group: "grp_a",
      sender: "snd_x",
      sentAt: "2026-09-18T15:00:00.000Z",
      createdAt: "2026-09-18T15:00:00.000Z",
      text,
      storedClass: "pista_oferta",
      partyId: null,
      duplicateOf: null,
      dismissed: false,
      inInterval: true,
      senderRoleNow: "pista",
      senderMutedNow: false,
    },
  ],
  parties: [],
  lots: [],
  candidates: [],
};

const items: LabelItem[] = [
  {
    familyId: "f1",
    messageId: "msg_1",
    members: ["msg_1"],
    set: "random",
    selectedBy: null,
    tags: [],
    inclusionProbability: 0.5,
    split: "test",
    excluded: null,
  },
];

const offer = {
  needsReview: false,
  contextUsed: [],
  notes: null,
  observations: [
    {
      intent: "offer",
      event: { mention: "onix", partyId: null, resolution: "new_event" },
      ticketCategory: "pista",
      quantity: 2,
      price: null,
      eventDate: null,
      spans: [{ start: 0, end: text.length, text }],
      relationship: { kind: "none", relatedMessage: null },
      ambiguities: [],
    },
  ],
};

let dir: string;
let store: LabelStore;
let server: Awaited<ReturnType<typeof startLabelServer>>;

/** Raw requests, because fetch will not let a test forge the Host header. */
function call(
  pathname: string,
  options: {
    method?: string;
    body?: string;
    host?: string;
    token?: string | null;
  } = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  const token = options.token === undefined ? TOKEN : options.token;
  const sep = pathname.includes("?") ? "&" : "?";
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: server.port,
        method: options.method ?? "GET",
        path: token ? `${pathname}${sep}t=${token}` : pathname,
        headers: {
          host: options.host ?? `127.0.0.1:${server.port}`,
          "content-type": "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "label-server-"));
  store = createLabelStore(path.join(dir, "labels", "lc.jsonl"));
  server = await startLabelServer({
    data,
    items,
    seed: "s",
    store,
    annotator: "lc",
    port: 0,
    token: TOKEN,
    now: () => new Date("2026-11-04T15:00:00Z"),
  });
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("label server", () => {
  it("listens on loopback only and hands out a tokenised URL", () => {
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/?t=${TOKEN}`);
  });

  it("refuses requests without the session token", async () => {
    expect((await call("/api/queue", { token: null })).status).toBe(403);
    expect((await call("/api/queue", { token: "b".repeat(64) })).status).toBe(403);
  });

  it("refuses a foreign Host, so a rebound DNS name cannot read it", async () => {
    expect((await call("/api/queue", { host: "evil.example:80" })).status).toBe(403);
  });

  it("serves the page with headers that keep it self-contained", async () => {
    const page = await call("/");
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.body).toContain(`/app.js?t=${TOKEN}`);
    expect((await call("/app.js")).status).toBe(200);
    expect((await call("/elsewhere")).status).toBe(404);
  });

  it("reports the queue and progress", async () => {
    const queue = JSON.parse((await call("/api/queue")).body);
    expect(queue.items).toEqual([
      {
        messageId: "msg_1",
        set: "random",
        split: "test",
        excluded: null,
        labeled: false,
      },
    ]);
    expect(queue.progress).toMatchObject({ labeled: 0, total: 1 });
  });

  it("serves an item without what the rules decided", async () => {
    const res = await call("/api/item/msg_1");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      view: { messageId: "msg_1", text },
      label: null,
    });
    expect(res.body).not.toContain("pista_oferta");
    expect((await call("/api/item/msg_404")).status).toBe(404);
  });

  it("stores a valid label and serves it back as the item's current label", async () => {
    const res = await call("/api/label/msg_1", {
      method: "POST",
      body: JSON.stringify(offer),
    });
    expect(res.status).toBe(200);
    expect(store.latest().get("msg_1")).toMatchObject({
      annotator: "lc",
      source: "human",
    });
    expect(
      JSON.parse((await call("/api/item/msg_1")).body).label.observations,
    ).toHaveLength(1);
    expect(JSON.parse((await call("/api/queue")).body).progress.labeled).toBe(1);
  });

  it("writes nothing when the label fails validation", async () => {
    const bad = { ...offer, observations: [{ ...offer.observations[0], spans: [] }] };
    const res = await call("/api/label/msg_1", {
      method: "POST",
      body: JSON.stringify(bad),
    });
    expect(res.status).toBe(422);
    expect(JSON.parse(res.body).errors).toEqual([
      "observations[0] needs at least one supporting span",
    ]);
    expect(store.all()).toEqual([]);
  });

  it("rejects bodies that are not JSON or are too large", async () => {
    expect(
      (await call("/api/label/msg_1", { method: "POST", body: "{nope" })).status,
    ).toBe(400);
    const huge = JSON.stringify({ notes: "x".repeat(1_100_000) });
    expect(
      (await call("/api/label/msg_1", { method: "POST", body: huge })).status,
    ).toBe(413);
  });
});
