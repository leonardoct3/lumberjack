import { createHmac } from "node:crypto";
import { TZ } from "@/domain/timezone";
import { catalogAsOf } from "../baseline";
import type { LoadedExport } from "../dataset";
import type { SampleItem, SplitAssignment } from "../sample";

export type LabelItem = SampleItem & SplitAssignment;

export type ContextMessage = {
  id: string;
  sentAt: string;
  sentAtLocal: string;
  text: string;
  sameGroup: boolean;
  sameSender: boolean;
};

export type CatalogParty = {
  id: string;
  name: string;
  aliases: string[];
  eventAt: string;
  lots: { label: string; officialPrice: number | null; platform: string }[];
};

/** What the labeller sees. Built so that nothing the rules decided can leak into it. */
export type ItemView = {
  messageId: string;
  text: string;
  sentAt: string;
  sentAtLocal: string;
  senderRole: string;
  senderMuted: boolean;
  familySize: number;
  set: LabelItem["set"];
  split: LabelItem["split"];
  excluded: LabelItem["excluded"];
  context: ContextMessage[];
  catalog: CatalogParty[];
  availableContext: string[];
};

const HOUR_MS = 3_600_000;
const GROUP_WINDOW_MS = 24 * HOUR_MS;
const SENDER_WINDOW_MS = 7 * 24 * HOUR_MS;
const WINDOW_CAP = 30;

const local = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function buildItemView(data: LoadedExport, item: LabelItem): ItemView {
  const target = data.messages.find((m) => m.id === item.messageId);
  if (!target) throw new Error(`${item.messageId} is not in this export`);
  const sentAt = Date.parse(target.sentAt);

  // Strictly earlier: a message sent the same instant was not there to read.
  const earlier = data.messages
    .filter((m) => m.id !== target.id && Date.parse(m.sentAt) < sentAt)
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  const window = (keep: (m: (typeof earlier)[number]) => boolean, ms: number) =>
    earlier
      .filter((m) => keep(m) && sentAt - Date.parse(m.sentAt) <= ms)
      .slice(0, WINDOW_CAP);
  const group = window((m) => m.group === target.group, GROUP_WINDOW_MS);
  const sender = window((m) => m.sender === target.sender, SENDER_WINDOW_MS);

  const offered = new Set([...group, ...sender].map((m) => m.id));
  const context = earlier
    .filter((m) => offered.has(m.id))
    .map((m) => ({
      id: m.id,
      sentAt: m.sentAt,
      sentAtLocal: local.format(new Date(m.sentAt)),
      text: m.text,
      sameGroup: m.group === target.group,
      sameSender: m.sender === target.sender,
    }));

  const catalog = catalogAsOf(data.parties, new Date(sentAt), "as_of_message").map(
    (party) => ({
      id: party.id,
      name: party.name,
      aliases: party.aliases,
      eventAt: party.eventAt,
      lots: data.lots
        .filter((lot) => lot.partyId === party.id && Date.parse(lot.openedAt) <= sentAt)
        .map((lot) => ({
          label: lot.label,
          officialPrice: lot.officialPrice,
          platform: lot.platform,
        })),
    }),
  );

  return {
    messageId: target.id,
    text: target.text,
    sentAt: target.sentAt,
    sentAtLocal: local.format(new Date(sentAt)),
    senderRole: target.senderRoleNow,
    senderMuted: target.senderMutedNow,
    familySize: item.members.length,
    set: item.set,
    split: item.split,
    excluded: item.excluded,
    context,
    catalog,
    availableContext: [...context.map((c) => c.id), ...catalog.map((p) => p.id)],
  };
}

/** Shuffled so a long session does not drift through the weeks in order; excluded items wait at the end. */
export function labelQueue(items: LabelItem[], seed: string): LabelItem[] {
  const rank = (id: string) => createHmac("sha256", seed).update(id).digest("hex");
  return [...items].sort(
    (a, b) =>
      Number(a.excluded != null) - Number(b.excluded != null) ||
      rank(a.messageId).localeCompare(rank(b.messageId)),
  );
}
