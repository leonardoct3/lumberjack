import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createJsonlSink, createMemorySink } from "@/benchmark/sink";

describe("createMemorySink", () => {
  it("writes one JSON object per line and summarises rows, bytes and checksum", async () => {
    const sink = createMemorySink();
    const file = sink.file("rows.jsonl");
    file.write({ a: 1 });
    file.write({ b: "ç" });
    const summary = await file.close();

    const content = sink.contents("rows.jsonl");
    expect(content).toBe('{"a":1}\n{"b":"ç"}\n');
    expect(summary).toEqual({
      name: "rows.jsonl",
      rows: 2,
      bytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  });

  it("serialises dates as ISO strings", async () => {
    const sink = createMemorySink();
    const file = sink.file("d.jsonl");
    file.write({ at: new Date("2026-09-15T09:05:36.000Z") });
    await file.close();
    expect(sink.rows("d.jsonl")).toEqual([{ at: "2026-09-15T09:05:36.000Z" }]);
  });
});

describe("createJsonlSink", () => {
  it("writes owner-only files whose checksum matches the summary", async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "lj-sink-")), "export");
    const sink = createJsonlSink(dir);
    const file = sink.file("rows.jsonl");
    file.write({ a: 1 });
    const summary = await file.close();

    const written = readFileSync(path.join(dir, "rows.jsonl"));
    expect(createHash("sha256").update(written).digest("hex")).toBe(summary.sha256);
    expect(statSync(path.join(dir, "rows.jsonl")).mode & 0o077).toBe(0);
  });

  it("refuses to write into an export that already exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lj-sink-"));
    expect(() => createJsonlSink(dir)).toThrow(/already exists/);
  });
});
