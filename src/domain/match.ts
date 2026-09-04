import { normalizeText } from "@/domain/normalize";

export type PartyStatus = "upcoming" | "past" | "cancelled";

export type PartyMatchInput = {
  id: string;
  name: string;
  aliases: string[];
  status: PartyStatus;
};

export function matchParty(
  messageText: string,
  parties: PartyMatchInput[],
): PartyMatchInput | null {
  const normalizedMessage = normalizeText(messageText);

  let best: PartyMatchInput | null = null;
  let bestNeedleLength = 0;

  for (const party of parties) {
    if (party.status === "past" || party.status === "cancelled") {
      continue;
    }

    const needles = [party.name, ...party.aliases].map(normalizeText);

    for (const needle of needles) {
      if (needle.length === 0 || !normalizedMessage.includes(needle)) {
        continue;
      }

      if (needle.length > bestNeedleLength) {
        best = party;
        bestNeedleLength = needle.length;
      }
    }
  }

  return best;
}
