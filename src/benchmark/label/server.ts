import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Annotation } from "../annotation";
import type { LoadedExport } from "../dataset";
import type { ReviewPlan } from "../draft/compare";
import type { LabelStore } from "../labels";
import { buildLabel } from "../labels";
import { buildItemView, labelQueue, type ItemView, type LabelItem } from "./item";

const MAX_BODY_BYTES = 1_000_000;

const asset = (name: string) =>
  readFileSync(new URL(`./assets/${name}`, import.meta.url), "utf8");

const HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export type LabelServerOptions = {
  data: LoadedExport;
  items: LabelItem[];
  seed: string;
  store: LabelStore;
  annotator: string;
  /** 0 picks a free port. */
  port: number;
  token?: string;
  now?: () => Date;
  /** Review mode: only the plan's items, each with both model drafts beside the form. */
  review?: {
    plan: ReviewPlan;
    drafts: [Map<string, Annotation>, Map<string, Annotation>];
  };
};

/** Drafts reach the page as A and B with no model name, so the choice rests on the content. */
function draftView(annotation: Annotation | undefined) {
  if (!annotation) return null;
  const { observations, needsReview, contextUsed, notes } = annotation;
  return { observations, needsReview, contextUsed, notes };
}

type Tally = { labeled: number; total: number };

function progress(queue: LabelItem[], labeled: Set<string>) {
  const bump = (bucket: Record<string, Tally>, key: string, done: boolean) => {
    bucket[key] ??= { labeled: 0, total: 0 };
    bucket[key].total++;
    if (done) bucket[key].labeled++;
  };
  const bySet: Record<string, Tally> = {};
  const bySplit: Record<string, Tally> = {};
  for (const item of queue) {
    const done = labeled.has(item.messageId);
    bump(bySet, item.set, done);
    bump(bySplit, item.excluded ? "excluded" : item.split, done);
  }
  return {
    labeled: queue.filter((i) => labeled.has(i.messageId)).length,
    total: queue.length,
    bySet,
    bySplit,
  };
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = "application/json; charset=utf-8",
) {
  res.writeHead(status, { ...HEADERS, "Content-Type": type });
  res.end(body);
}

const json = (res: ServerResponse, status: number, value: unknown) =>
  send(res, status, JSON.stringify(value));

/** Drains the whole body even when it is too large, so the client still reads the 413. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () =>
      resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString("utf8")),
    );
    req.on("error", reject);
  });
}

/**
 * Serves one labeller on loopback. The token keeps other local processes and
 * pages out; the Host check keeps out a DNS name rebound to 127.0.0.1.
 */
export async function startLabelServer(options: LabelServerOptions) {
  const token = options.token ?? randomBytes(32).toString("hex");
  const expected = Buffer.from(token);
  const now = options.now ?? (() => new Date());
  const reviewing = new Map(
    (options.review?.plan.review ?? []).map((entry) => [entry.messageId, entry]),
  );
  const byId = new Map(options.items.map((i) => [i.messageId, i]));
  const queue = options.review
    ? options.review.plan.review.flatMap((e) => byId.get(e.messageId) ?? [])
    : labelQueue(options.items, options.seed);
  const items = new Map(queue.map((item) => [item.messageId, item]));
  const views = new Map<string, ItemView>();
  const viewOf = (item: LabelItem) => {
    if (!views.has(item.messageId))
      views.set(item.messageId, buildItemView(options.data, item));
    return views.get(item.messageId)!;
  };
  const page = asset("index.html").replaceAll("__TOKEN__", token);
  const script = asset("app.js");
  let port = options.port;

  const authorised = (req: IncomingMessage, url: URL) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
    const header = req.headers["x-label-token"];
    const given = Buffer.from(
      (typeof header === "string" ? header : null) ?? url.searchParams.get("t") ?? "",
    );
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!authorised(req, url)) return json(res, 403, { error: "forbidden" });

    if (req.method === "GET" && url.pathname === "/")
      return send(res, 200, page, "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/app.js") {
      return send(res, 200, script, "text/javascript; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/api/queue") {
      const labeled = new Set(options.store.latest().keys());
      return json(res, 200, {
        annotator: options.annotator,
        review: options.review != null,
        items: queue.map((i) => ({
          messageId: i.messageId,
          set: i.set,
          split: i.split,
          excluded: i.excluded,
          labeled: labeled.has(i.messageId),
          reasons: reviewing.get(i.messageId)?.reasons ?? null,
          required: reviewing.get(i.messageId)?.required ?? null,
        })),
        progress: progress(queue, labeled),
      });
    }

    const match = /^\/api\/(item|label)\/([\w-]+)$/.exec(url.pathname);
    const item = match ? items.get(match[2]) : undefined;
    if (match && !item) return json(res, 404, { error: "not in this sample" });

    if (item && match![1] === "item" && req.method === "GET") {
      const entry = reviewing.get(item.messageId);
      return json(res, 200, {
        view: viewOf(item),
        label: options.store.latest().get(item.messageId) ?? null,
        review:
          options.review && entry
            ? {
                reasons: entry.reasons,
                required: entry.required ?? true,
                differing: entry.differing,
                drafts: options.review.drafts.map((d) =>
                  draftView(d.get(item.messageId)),
                ),
              }
            : null,
      });
    }
    if (item && match![1] === "label" && req.method === "POST") {
      const body = await readBody(req);
      if (body == null) return json(res, 413, { error: "label is too large" });
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "body is not JSON" });
      }
      const view = viewOf(item);
      const { annotation, errors } = buildLabel(
        parsed,
        { messageId: item.messageId, annotator: options.annotator, now: now() },
        { text: view.text, availableContext: view.availableContext },
      );
      if (!annotation) return json(res, 422, { errors });
      options.store.append(annotation);
      return json(res, 200, {
        label: annotation,
        progress: progress(queue, new Set(options.store.latest().keys())),
      });
    }
    return json(res, 404, { error: "not found" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error(
        "label server error",
        error instanceof Error ? error.message : error,
      );
      if (!res.headersSent) json(res, 500, { error: "internal error" });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;

  return {
    port,
    url: `http://127.0.0.1:${port}/?t=${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // A browser tab holds keep-alive sockets open; without this, close never returns.
        server.closeAllConnections();
      }),
  };
}
