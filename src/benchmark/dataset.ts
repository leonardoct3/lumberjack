import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExportedParty } from "./baseline";
import type { ExportedMessage, ExportManifest } from "./export";
import type { FileSummary } from "./sink";

export type ExportedCandidate = {
  id: string;
  sourceMessage: string;
  status: string;
  name: string | null;
};

export type LoadedExport = {
  dir: string;
  manifest: ExportManifest;
  messages: ExportedMessage[];
  parties: ExportedParty[];
  candidates: ExportedCandidate[];
};

export function readJsonl<T = unknown>(file: string): T[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) => {
      if (line.trim().length === 0) return [];
      try {
        return [JSON.parse(line) as T];
      } catch {
        throw new Error(`${path.basename(file)}:${i + 1} is not valid JSON`);
      }
    });
}

/**
 * Every run reads what the manifest promised and nothing else, so a sample or a
 * score can always be traced back to one exact export.
 */
export function loadExport(dir: string): LoadedExport {
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "manifest.json"), "utf8"),
  ) as ExportManifest;
  const summaries = new Map<string, FileSummary>(
    manifest.files.map((f) => [f.name, f]),
  );

  const load = <T>(name: string): T[] => {
    const summary = summaries.get(name);
    const file = path.join(dir, name);
    if (!summary || !existsSync(file))
      throw new Error(`${name} is missing from ${dir}`);
    const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (sha256 !== summary.sha256)
      throw new Error(`${name} does not match its manifest checksum`);
    return readJsonl<T>(file);
  };

  return {
    dir,
    manifest,
    messages: load<ExportedMessage>("messages.jsonl"),
    parties: load<ExportedParty>("parties.jsonl"),
    candidates: load<ExportedCandidate>("candidates.jsonl"),
  };
}
