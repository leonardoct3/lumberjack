import { createHash } from "node:crypto";
import { normalizeText } from "./normalize";

/**
 * A seller blasting the same offer into eight groups is one intent, not eight.
 * A day later the same text means "ainda tenho", which is a fresh intent.
 */
export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Identity of a message body, ignoring the decoration that changes per group
 * (emoji, punctuation, spacing). `null` when nothing identifying remains, so
 * emoji-only messages never collapse into each other.
 */
export function fingerprintText(text: string): string | null {
  const reduced = normalizeText(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (reduced.length === 0) return null;
  // Hashed because promo blasts run into kilobytes and the column is indexed.
  return createHash("sha256").update(reduced).digest("hex");
}

export function withinDedupeWindow(a: Date, b: Date): boolean {
  return Math.abs(b.getTime() - a.getTime()) <= DEDUPE_WINDOW_MS;
}
