import type { Metadata } from "next";
import {
  HeatBoard,
  type HeatRow,
} from "@/components/heat/heat-board";
import { prisma } from "@/db/client";
import { canRankOnHeat } from "@/domain/gates";
import { latestSnapshot } from "@/jobs/refresh-heat";

export const metadata: Metadata = { title: "Mapa de calor" };

const WINDOWS = [1, 3, 7] as const;
type Window = (typeof WINDOWS)[number];

function parseWindow(raw: string | undefined): Window | null {
  const n = Number(raw);
  return WINDOWS.includes(n as Window) ? (n as Window) : null;
}

export default async function HeatPage({
  searchParams,
}: {
  searchParams: Promise<{ janela?: string; grupo?: string }>;
}) {
  const params = await searchParams;
  const janela = parseWindow(params.janela);
  const grupo = params.grupo?.trim() || "";

  const [groups, parties] = await Promise.all([
    prisma.group.findMany({ orderBy: { name: "asc" } }),
    prisma.party.findMany({
      where: {
        ...(grupo ? { messages: { some: { groupId: grupo } } } : {}),
      },
      include: { heatSnapshots: true },
    }),
  ]);

  const mapped = parties
    .filter((party) => canRankOnHeat(party.status))
    .map((party) => {
      const snap = latestSnapshot(party.heatSnapshots);
      return {
        id: party.id,
        name: party.name,
        score: snap?.score ?? null,
        procura1: snap?.demand1d ?? null,
        procura3: snap?.demand3d ?? null,
        procura7: snap?.demand7d ?? null,
        oferta1: snap?.offer1d ?? null,
        oferta3: snap?.offer3d ?? null,
        autores7d: snap?.uniqueDemandSenders7d ?? null,
        days: snap?.daysToEvent ?? null,
        computedAt: snap?.computedAt ?? null,
      };
    })
    .sort((a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
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
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        rows={rows}
        updatedAt={latestComputedAt?.toISOString() ?? null}
      />
    </main>
  );
}
