import { createHmac } from "node:crypto";

/** Long enough that nobody can brute-force a phone number back out of its pseudonym. */
export const PSEUDONYM_KEY_MIN_LENGTH = 32;

export type PseudonymKind = "group" | "sender" | "message";

const PREFIX: Record<PseudonymKind, string> = {
  group: "grp",
  sender: "snd",
  message: "msg",
};

export type Pseudonymizer = {
  id(kind: PseudonymKind, value: string): string;
  optionalId(kind: PseudonymKind, value: string | null): string | null;
  /** Proves two exports used the same key without putting the key in either. */
  keyFingerprint: string;
};

/**
 * Stable keyed pseudonyms: the same WhatsApp id always maps to the same token,
 * so cross-posting and repeat participation survive, but without the key the
 * token says nothing. A bare hash would not do, because phone numbers are few
 * enough to enumerate.
 */
export function createPseudonymizer(key: string): Pseudonymizer {
  if (key.length < PSEUDONYM_KEY_MIN_LENGTH) {
    throw new Error(
      `The pseudonym key must be at least ${PSEUDONYM_KEY_MIN_LENGTH} characters.`,
    );
  }

  const digest = (value: string) =>
    createHmac("sha256", key).update(value).digest("hex").slice(0, 16);

  const id = (kind: PseudonymKind, value: string) =>
    `${PREFIX[kind]}_${digest(`${kind}\u0000${value}`)}`;

  return {
    id,
    optionalId: (kind, value) => (value == null ? null : id(kind, value)),
    keyFingerprint: digest("lumberjack-benchmark-key-fingerprint"),
  };
}
