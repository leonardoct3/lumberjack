import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadExport, readJsonl } from "@/benchmark/dataset";
import { createJsonlSink } from "@/benchmark/sink";

async function writeExport() {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "lj-ds-")), "export");
  const sink = createJsonlSink(dir);
  const files = [];
  for (const name of ["messages", "parties", "lots", "candidates"]) {
    const file = sink.file(`${name}.jsonl`);
    file.write({ id: `${name}-1` });
    files.push(await file.close());
  }
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ exportVersion: 1, files }),
  );
  return dir;
}

describe("loadExport", () => {
  it("loads every file once its checksum matches the manifest", async () => {
    const data = loadExport(await writeExport());
    expect(data.messages).toEqual([{ id: "messages-1" }]);
    expect(data.parties).toEqual([{ id: "parties-1" }]);
    expect(data.lots).toEqual([{ id: "lots-1" }]);
    expect(data.candidates).toEqual([{ id: "candidates-1" }]);
    expect(data.manifest.exportVersion).toBe(1);
  });

  it("refuses an export that changed after it was written", async () => {
    const dir = await writeExport();
    appendFileSync(path.join(dir, "messages.jsonl"), '{"id":"injected"}\n');
    expect(() => loadExport(dir)).toThrow(
      /messages.jsonl does not match its manifest checksum/,
    );
  });
});

describe("readJsonl", () => {
  it("skips blank lines and names the line that fails to parse", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "lj-ds-")), "a.jsonl");
    writeFileSync(file, '{"a":1}\n\n{oops\n');
    expect(() => readJsonl(file)).toThrow(/a.jsonl:3/);
  });
});
