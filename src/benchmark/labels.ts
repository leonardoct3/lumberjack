import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  ANNOTATION_SCHEMA_VERSION,
  type Annotation,
  validateAnnotation,
} from "./annotation";
import { readJsonl } from "./dataset";

/**
 * Labels are appended, never rewritten, so an edit is a newer line. Whoever
 * reads them, scoring included, must take only the last one per message.
 */
export function latestAnnotations<T extends { messageId?: unknown }>(
  records: T[],
): T[] {
  const latest = new Map<unknown, T>();
  for (const record of records) latest.set(record.messageId, record);
  return [...latest.values()];
}

/**
 * Who labelled, when and from what source is the server's to say. The client
 * only sends what the labeller decided.
 */
export function buildLabel(
  body: unknown,
  at: { messageId: string; annotator: string; now: Date },
  context: { text: string; availableContext: string[] },
): { annotation: Annotation | null; errors: string[] } {
  const sent = (body !== null && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const record = {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    messageId: at.messageId,
    annotator: at.annotator,
    annotatedAt: at.now.toISOString(),
    source: "human",
    observations: sent.observations,
    needsReview: sent.needsReview,
    contextUsed: sent.contextUsed,
    notes: sent.notes,
  };
  const { annotation, errors } = validateAnnotation(record, context);
  return errors.length > 0 ? { annotation: null, errors } : { annotation, errors };
}

export type LabelStore = {
  file: string;
  append(annotation: Annotation): void;
  all(): Annotation[];
  latest(): Map<string, Annotation>;
};

export function createLabelStore(file: string): LabelStore {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const all = () => (existsSync(file) ? readJsonl<Annotation>(file) : []);
  return {
    file,
    append(annotation) {
      appendFileSync(file, `${JSON.stringify(annotation)}\n`, { mode: 0o600 });
    },
    all,
    latest: () => new Map(latestAnnotations(all()).map((a) => [a.messageId, a])),
  };
}
