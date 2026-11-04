import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";

export type FileSummary = { name: string; rows: number; bytes: number; sha256: string };

export type RecordFile = {
  write(record: unknown): void;
  close(): Promise<FileSummary>;
};

export type DatasetSink = { file(name: string): RecordFile };

function summarising(
  name: string,
  emit: (line: string) => void,
  finish: () => void,
): RecordFile {
  const hash = createHash("sha256");
  let rows = 0;
  let bytes = 0;
  return {
    write(record) {
      const line = `${JSON.stringify(record)}\n`;
      hash.update(line);
      rows += 1;
      bytes += Buffer.byteLength(line);
      emit(line);
    },
    async close() {
      finish();
      return { name, rows, bytes, sha256: hash.digest("hex") };
    },
  };
}

/** Owner-only files in a directory created for this export alone. */
export function createJsonlSink(dir: string): DatasetSink {
  if (existsSync(dir)) {
    throw new Error(`${dir} already exists; every export gets a fresh directory.`);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    file(name) {
      const fd = openSync(path.join(dir, name), "wx", 0o600);
      return summarising(
        name,
        (line) => writeSync(fd, line),
        () => closeSync(fd),
      );
    },
  };
}

export function createMemorySink(): DatasetSink & {
  contents(name: string): string;
  rows(name: string): unknown[];
} {
  const files = new Map<string, string>();
  return {
    file(name) {
      files.set(name, "");
      return summarising(
        name,
        (line) => files.set(name, files.get(name)! + line),
        () => {},
      );
    },
    contents: (name) => files.get(name) ?? "",
    rows: (name) =>
      (files.get(name) ?? "")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line)),
  };
}
