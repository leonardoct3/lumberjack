import type { LoadedExport } from "@/benchmark/dataset";
import type { Draft } from "@/benchmark/draft/schema";
import type { ExportedMessage } from "@/benchmark/export";
import type { LabelItem } from "@/benchmark/label/item";

const HOUR = 3_600_000;
const t0 = Date.parse("2026-09-18T15:00:00Z");
export const at = (hours: number) => new Date(t0 + hours * HOUR).toISOString();

export function message(
  id: string,
  hours: number,
  text: string,
  over: Partial<ExportedMessage> = {},
): ExportedMessage {
  return {
    id,
    group: "grp_a",
    sender: "snd_x",
    sentAt: at(hours),
    createdAt: at(hours),
    text,
    storedClass: "pista_oferta",
    partyId: "party-1",
    duplicateOf: null,
    dismissed: false,
    inInterval: true,
    senderRoleNow: "pista",
    senderMutedNow: false,
    ...over,
  };
}

export function exportWith(messages: ExportedMessage[]): LoadedExport {
  return {
    dir: "/tmp/x",
    manifest: {} as LoadedExport["manifest"],
    messages,
    parties: [
      {
        id: "party-1",
        name: "Syon",
        aliases: [],
        eventAt: at(72),
        statusNow: "upcoming",
        createdAt: at(-48),
      },
    ],
    lots: [],
    candidates: [],
  };
}

export function item(messageId: string, over: Partial<LabelItem> = {}): LabelItem {
  return {
    familyId: `fam-${messageId}`,
    messageId,
    members: [messageId],
    set: "random",
    selectedBy: null,
    tags: [],
    inclusionProbability: 0.5,
    split: "development",
    excluded: null,
    ...over,
  };
}

export function offerDraft(
  quote: string,
  over: Partial<Draft["observations"][number]> = {},
): Draft {
  return {
    observations: [
      {
        intent: "offer",
        event: { mention: "syon", partyId: "party-1", resolution: "resolved" },
        ticketCategory: "fem",
        quantity: null,
        price: { amount: 330, currency: "BRL", meaning: "asking" },
        eventDate: null,
        quotes: [quote],
        relationship: { kind: "none", relatedMessage: null },
        ambiguities: [],
        ...over,
      },
    ],
    needsReview: false,
    contextUsed: [],
    notes: null,
  };
}
