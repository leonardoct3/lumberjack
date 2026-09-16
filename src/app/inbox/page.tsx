import type { Metadata } from "next";
import {
  InboxBoard,
  type InboxCandidate,
  type InboxOrphan,
} from "@/components/inbox/inbox-board";
import { prisma } from "@/db/client";
import { matchParty } from "@/domain/match";
import { toDatetimeLocal } from "@/lib/datetime";

export const metadata: Metadata = { title: "Inbox de sinais" };

/** How many groups saw this text. Spreading wide is itself a sign of urgency. */
function groupReach(message: {
  groupId: string;
  duplicates: { groupId: string }[];
}): number {
  return new Set([message.groupId, ...message.duplicates.map((d) => d.groupId)])
    .size;
}

export default async function InboxPage() {
  const [candidates, orphans, upcoming] = await Promise.all([
    prisma.partyCandidate.findMany({
      where: { status: "pending" },
      include: {
        source: { include: { duplicates: { select: { groupId: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.message.findMany({
      where: {
        class: { in: ["pista_oferta", "pista_procura"] },
        signals: { none: {} },
        // Copies of a cross-posted text ride along with their canonical message.
        duplicateOfId: null,
      },
      include: { sender: true, duplicates: { select: { groupId: true } } },
      orderBy: { sentAt: "desc" },
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
    name: candidate.name ?? "",
    eventAtLocal: candidate.eventAt
      ? toDatetimeLocal(candidate.eventAt.toISOString())
      : "",
    lot: candidate.lotLabel ?? "",
    url: candidate.url ?? "",
    price:
      candidate.officialPrice != null ? String(candidate.officialPrice) : "",
  }));

  const mappedOrphans: InboxOrphan[] = orphans.map((message) => ({
    id: message.id,
    text: message.text,
    sender: message.sender.name ?? message.sender.waId,
    groupReach: groupReach(message),
    defaultPartyId: matchParty(message.text, matchInputs)?.id ?? "",
  }));

  return (
    <main>
      <InboxBoard
        candidates={mappedCandidates}
        orphans={mappedOrphans}
        upcoming={upcoming.map((party) => ({
          id: party.id,
          name: party.name,
        }))}
      />
    </main>
  );
}
