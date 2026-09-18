import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import {
  InboxBoard,
  type DismissedOrphan,
  type InboxCandidate,
  type InboxOrphan,
  type UnclassifiedMessage,
} from "@/components/inbox/inbox-board";
import { prisma } from "@/db/client";
import { TICKET_NOUNS } from "@/domain/classify";
import { extractCandidate } from "@/domain/extract";
import { matchParty } from "@/domain/match";
import { formatWhen, toDatetimeLocal } from "@/lib/datetime";

export const metadata: Metadata = { title: "Inbox de sinais" };

/**
 * A silenced sender asks for nothing: their messages stay in the history and
 * out of every queue, or muting would only move the noise one list down.
 */
const NOT_MUTED = { sender: { muted: false } } as const;

/** Copies of a cross-posted text ride along with their canonical message. */
function orphanWhere(dismissed: boolean): Prisma.MessageWhereInput {
  return {
    class: { in: ["pista_oferta", "pista_procura"] },
    signals: { none: {} },
    duplicateOfId: null,
    dismissedAt: dismissed ? { not: null } : null,
    ...NOT_MUTED,
  };
}

/**
 * Ruído that mentions a ticket: the rules had no verb to go by, so the operator
 * decides. Plain chatter stays out, or the drawer would be all "bom dia".
 */
const unclassifiedWhere: Prisma.MessageWhereInput = {
  class: "ruido",
  signals: { none: {} },
  duplicateOfId: null,
  dismissedAt: null,
  ...NOT_MUTED,
  OR: TICKET_NOUNS.map((noun) => ({
    text: { contains: noun, mode: "insensitive" as const },
  })),
};

/** How many groups saw this text. Spreading wide is itself a sign of urgency. */
function groupReach(message: {
  groupId: string;
  duplicates: { groupId: string }[];
}): number {
  return new Set([message.groupId, ...message.duplicates.map((d) => d.groupId)])
    .size;
}

export default async function InboxPage() {
  const [candidates, orphans, dismissed, unclassified, upcoming] = await Promise.all([
    prisma.partyCandidate.findMany({
      where: { status: "pending", source: NOT_MUTED },
      include: {
        source: {
          include: { sender: true, duplicates: { select: { groupId: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.message.findMany({
      where: orphanWhere(false),
      include: { sender: true, duplicates: { select: { groupId: true } } },
      orderBy: { sentAt: "desc" },
    }),
    prisma.message.findMany({
      where: orphanWhere(true),
      include: { sender: true },
      orderBy: { dismissedAt: "desc" },
      take: 30,
    }),
    prisma.message.findMany({
      where: unclassifiedWhere,
      include: { sender: true },
      orderBy: { sentAt: "desc" },
      take: 40,
    }),
    prisma.party.findMany({
      where: { status: "upcoming" },
      orderBy: { eventAt: "asc" },
    }),
  ]);

  const matchInputs = upcoming.map((party) => ({
    id: party.id,
    name: party.name,
    aliases: party.aliases,
    status: party.status,
  }));

  // A season blast leaves one pending row per festa. Each card shows its own
  // lines and says which festa of the message it is, or three cards would
  // repeat the same fifteen lines and read as a bug. The order comes from where
  // the excerpt sits in the message, which is stable however the rows are read.
  const byMessage = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const group = byMessage.get(candidate.sourceMessageId) ?? [];
    group.push(candidate);
    byMessage.set(candidate.sourceMessageId, group);
  }
  const part = new Map<string, { order: number; total: number }>();
  for (const group of byMessage.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(
      (a, b) =>
        a.source.text.indexOf(a.excerpt ?? "") -
        b.source.text.indexOf(b.excerpt ?? ""),
    );
    ordered.forEach((candidate, index) => {
      part.set(candidate.id, { order: index + 1, total: group.length });
    });
  }

  // Newest message first, and inside a blast the festas in the order they were
  // announced — "festa 3 de 3" arriving above "festa 1 de 3" reads as a shuffle.
  const arrival = new Map<string, number>();
  for (const candidate of candidates) {
    if (!arrival.has(candidate.sourceMessageId)) {
      arrival.set(candidate.sourceMessageId, arrival.size);
    }
  }
  const sorted = [...candidates].sort(
    (a, b) =>
      (arrival.get(a.sourceMessageId) ?? 0) - (arrival.get(b.sourceMessageId) ?? 0) ||
      (part.get(a.id)?.order ?? 0) - (part.get(b.id)?.order ?? 0),
  );

  const mappedCandidates: InboxCandidate[] = sorted.map((candidate) => {
    return {
    id: candidate.id,
    sourceText: candidate.excerpt ?? candidate.source.text,
    part: part.get(candidate.id) ?? null,
    groupReach: groupReach(candidate.source),
    senderId: candidate.source.senderId,
    senderName: candidate.source.sender.name ?? candidate.source.sender.waId,
    name: candidate.name ?? "",
    eventAtLocal: candidate.eventAt
      ? toDatetimeLocal(candidate.eventAt.toISOString())
      : "",
    lot: candidate.lotLabel ?? "",
    url: candidate.url ?? "",
    price:
      candidate.officialPrice != null ? String(candidate.officialPrice) : "",
    };
  });

  const mappedOrphans: InboxOrphan[] = orphans.map((message) => {
    // Pista text rarely names a party cleanly, but it usually carries the date.
    const guessedEventAt = extractCandidate(message.text, message.sentAt).eventAt;
    return {
      id: message.id,
      text: message.text,
      sender: message.sender.name ?? message.sender.waId,
      groupReach: groupReach(message),
      sentAtLabel: formatWhen(message.sentAt.toISOString()),
      suggestedEventAtLocal: guessedEventAt
        ? toDatetimeLocal(guessedEventAt.toISOString())
        : "",
      defaultPartyId: matchParty(message.text, matchInputs)?.id ?? "",
    };
  });

  const mappedDismissed: DismissedOrphan[] = dismissed.map((message) => ({
    id: message.id,
    text: message.text,
    sender: message.sender.name ?? message.sender.waId,
    sentAtLabel: formatWhen(message.sentAt.toISOString()),
  }));

  const mappedUnclassified: UnclassifiedMessage[] = unclassified.map((message) => ({
    id: message.id,
    text: message.text,
    senderId: message.senderId,
    sender: message.sender.name ?? message.sender.waId,
    sentAtLabel: formatWhen(message.sentAt.toISOString()),
  }));

  return (
    <main>
      <InboxBoard
        candidates={mappedCandidates}
        orphans={mappedOrphans}
        dismissed={mappedDismissed}
        unclassified={mappedUnclassified}
        upcoming={upcoming.map((party) => ({
          id: party.id,
          name: party.name,
          aliases: party.aliases,
        }))}
      />
    </main>
  );
}
