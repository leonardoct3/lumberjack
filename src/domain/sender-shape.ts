export type SenderShape = "announces" | "trades" | "both" | "quiet";

export type SenderMix = {
  /** Messages that read as an announced festa. */
  ads: number;
  /** Messages that read as someone offering or asking for a ticket. */
  pista: number;
};

/** Below this the two sides are both present enough to say so. */
const DOMINANT = 0.8;

/**
 * What a sender does, read off their own messages. It replaces the role the
 * operator used to declare by hand — a control where two of its three values
 * took the same code path, so the work bought nothing. Ruído is not counted:
 * everyone says bom dia, and it never told two senders apart.
 */
export function senderShape(mix: SenderMix): SenderShape {
  const total = mix.ads + mix.pista;
  if (total === 0) return "quiet";
  if (mix.ads / total >= DOMINANT) return "announces";
  if (mix.pista / total >= DOMINANT) return "trades";
  return "both";
}
