import type { Metadata } from "next";
import {
  HeatBoard,
  type HeatRow,
} from "@/components/heat/heat-board";
import { prisma } from "@/db/client";
import { canRankOnHeat } from "@/domain/gates";
import {
  computePressure,
  demandConfidence,
  pressureTrend,
  snapshotNearest,
} from "@/domain/heat";
import { latestSnapshot } from "@/jobs/refresh-heat";

export const metadata: Metadata = { title: "Mapa de calor" };

const WINDOWS = [1, 3, 7] as const;
type Window = (typeof WINDOWS)[number];

/** Hourly runs, so three days of history is about seventy rows. */
const SNAPSHOT_HISTORY = 96;
const TREND_LOOKBACK_MS = 3 * 864e5;

function parseWindow(raw: string | undefined): Window | null {
  const n = Number(raw);
  return WINDOWS.includes(n as Window) ? (n as Window) : null;
}

type Snapshot = {
  computedAt: Date;
  uniqueDemandSenders1d: number;
  uniqueDemandSenders3d: number;
  uniqueDemandSenders7d: number;
  uniqueOfferSenders1d: number;
  uniqueOfferSenders3d: number;
  uniqueOfferSenders7d: number;
};

function peopleIn(snapshot: Snapshot, window: Window) {
  if (window === 1) {
    return {
      buyers: snapshot.uniqueDemandSenders1d,
      sellers: snapshot.uniqueOfferSenders1d,
    };
  }
  if (window === 3) {
    return {
      buyers: snapshot.uniqueDemandSenders3d,
      sellers: snapshot.uniqueOfferSenders3d,
    };
  }
  return {
    buyers: snapshot.uniqueDemandSenders7d,
    sellers: snapshot.uniqueOfferSenders7d,
  };
}

export default async function HeatPage({
  searchParams,
}: {
  searchParams: Promise<{ janela?: string; grupo?: string }>;
}) {
  const params = await searchParams;
  const janela = parseWindow(params.janela) ?? 7;
  const grupo = params.grupo?.trim() || "";

  const [groups, parties] = await Promise.all([
    prisma.group.findMany({
      where: grupo ? { OR: [{ listen: true }, { id: grupo }] } : { listen: true },
      select: { id: true, name: true, listen: true },
      orderBy: { name: "asc" },
    }),
    prisma.party.findMany({
      where: {
        ...(grupo ? { messages: { some: { groupId: grupo } } } : {}),
      },
      include: {
        heatSnapshots: {
          orderBy: { computedAt: "desc" },
          take: SNAPSHOT_HISTORY,
        },
      },
    }),
  ]);

  const now = Date.now();

  const mapped = parties
    .filter((party) => canRankOnHeat(party.status))
    .map((party) => {
      const snap = latestSnapshot(party.heatSnapshots);
      if (!snap) {
        return {
          id: party.id,
          name: party.name,
          pressure: null,
          buyers: null,
          sellers: null,
          messages: null,
          confidence: "none" as const,
          trend: null,
          days: null,
          computedAt: null,
        };
      }

      const { buyers, sellers } = peopleIn(snap, janela);
      const pressure = computePressure({
        uniqueDemandSenders: buyers,
        uniqueOfferSenders: sellers,
      });

      // Same window, three days back: a party can only be "heating up"
      // against its own past, never against another party's numbers.
      const before = snapshotNearest(
        party.heatSnapshots.filter(
          (candidate) =>
            candidate.computedAt.getTime() <= now - TREND_LOOKBACK_MS / 2,
        ),
        new Date(now - TREND_LOOKBACK_MS),
      );
      const previous = before
        ? computePressure({
            uniqueDemandSenders: peopleIn(before, janela).buyers,
            uniqueOfferSenders: peopleIn(before, janela).sellers,
          })
        : null;

      return {
        id: party.id,
        name: party.name,
        pressure,
        buyers,
        sellers,
        messages:
          janela === 1 ? snap.demand1d : janela === 3 ? snap.demand3d : snap.demand7d,
        confidence: demandConfidence(buyers),
        trend: pressureTrend(pressure, previous),
        days: snap.daysToEvent,
        computedAt: snap.computedAt,
      };
    })
    .sort((a, b) => {
      if (a.pressure == null && b.pressure == null) return 0;
      if (a.pressure == null) return 1;
      if (b.pressure == null) return -1;
      // People break the tie, so 2/0 from two buyers sits above 2/0 from one.
      return b.pressure - a.pressure || (b.buyers ?? 0) - (a.buyers ?? 0);
    });

  const latestComputedAt = mapped.reduce<Date | null>((latest, row) => {
    if (!row.computedAt) return latest;
    if (!latest || row.computedAt > latest) return row.computedAt;
    return latest;
  }, null);

  const rows: HeatRow[] = mapped.map(
    ({ computedAt: _computedAt, ...row }) => row,
  );

  return (
    <main>
      <HeatBoard
        janela={janela}
        grupo={grupo}
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          paused: !g.listen,
        }))}
        rows={rows}
        updatedAt={latestComputedAt?.toISOString() ?? null}
      />
    </main>
  );
}
