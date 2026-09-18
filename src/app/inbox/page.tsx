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

  const mappedCandidates: InboxCandidate[] = candidates.map((candidate) => ({
    id: candidate.id,
    sourceText: candidate.source.text,
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
  }));

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
