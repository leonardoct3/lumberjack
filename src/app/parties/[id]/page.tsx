import { notFound } from "next/navigation";
import {
  PartyBoard,
  type PartyLot,
  type PartyMergeTarget,
  type PartyTimelineItem,
} from "@/components/party/party-board";
import { prisma } from "@/db/client";
import { canAppearOnWatchlist } from "@/domain/gates";
import { findSimilarParties } from "@/domain/similar";

export default async function PartyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const party = await prisma.party.findUnique({
    where: { id },
    include: {
      lots: { orderBy: { openedAt: "desc" } },
      messages: {
        include: { sender: true, group: true, candidate: true, signals: true },
        orderBy: { sentAt: "desc" },
      },
      signals: {
        include: { message: { include: { sender: true, group: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!party) notFound();

  const others = await prisma.party.findMany({
    where: { id: { not: party.id } },
    select: { id: true, name: true, aliases: true, eventAt: true },
    orderBy: { eventAt: "desc" },
  });
  const similarIds = new Set(
    findSimilarParties(party.name, others).map((other) => other.id),
  );
  // Stable sort keeps the date order inside each half.
  const mergeTargets: PartyMergeTarget[] = others
    .slice()
    .sort(
      (a, b) => Number(similarIds.has(b.id)) - Number(similarIds.has(a.id)),
    )
    .map((other) => ({
      id: other.id,
      name: other.name,
      eventAt: other.eventAt.toISOString(),
      similar: similarIds.has(other.id),
    }));

  const upcoming = party.status === "upcoming";
  const noBuy = party.status === "past" || party.status === "cancelled";
  const hasOpenLot = party.lots.some((lot) => lot.closedAt == null);
  const watchlistEligible = canAppearOnWatchlist({
    status: party.status,
    hasOpenLot,
  });

  const lots: PartyLot[] = party.lots.map((lot) => ({
    id: lot.id,
    label: lot.label,
    url: lot.url,
    price: lot.officialPrice != null ? String(lot.officialPrice) : "",
    platform: lot.platform,
    openedAt: lot.openedAt.toISOString(),
    closedAt: lot.closedAt?.toISOString() ?? null,
  }));

  const seen = new Set(party.messages.map((m) => m.id));
  const timeline: PartyTimelineItem[] = [
    ...party.messages.map((message) => ({
      id: message.id,
      sentAt: message.sentAt.toISOString(),
      groupName: message.group.name,
      sender: message.sender.name ?? message.sender.waId,
      text: message.text,
      isCandidateSource: message.candidate != null,
      signals: message.signals.map((signal) => ({
        id: signal.id,
        kind: (signal.type === "demand" ? "procura" : "oferta") as
          | "procura"
          | "oferta",
      })),
    })),
    ...party.signals
      .filter((signal) => !seen.has(signal.messageId))
      .map((signal) => ({
        id: signal.id,
        sentAt: signal.message.sentAt.toISOString(),
        groupName: signal.message.group.name,
        sender: signal.message.sender.name ?? signal.message.sender.waId,
        text: signal.message.text,
        isCandidateSource: false,
        signals: [
          {
            id: signal.id,
            kind: (signal.type === "demand" ? "procura" : "oferta") as
              | "procura"
              | "oferta",
          },
        ],
      })),
  ];

  return (
    <main className="space-y-6">
      <PartyBoard
        party={{
          id: party.id,
          name: party.name,
          eventAt: party.eventAt.toISOString(),
          status: party.status,
          aliases: party.aliases.join(", "),
          nota:
            party.qualitativeScore != null
              ? String(party.qualitativeScore)
              : "",
          notes: party.notes ?? "",
          watchlistPosition: party.watchlistPosition,
        }}
        noBuy={noBuy}
        upcoming={upcoming}
        watchlistEligible={watchlistEligible}
        lots={lots}
        timeline={timeline}
        mergeTargets={mergeTargets}
        linkedMessages={party.messages.length}
      />
    </main>
  );
}
