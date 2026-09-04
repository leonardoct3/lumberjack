import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { prisma } from "@/db/client";
import { canRankOnHeat } from "@/domain/gates";
import { TZ } from "@/domain/timezone";
import { latestSnapshot } from "@/jobs/refresh-heat";

const WINDOWS = [1, 3, 7] as const;
type Window = (typeof WINDOWS)[number];

function parseWindow(raw: string | undefined): Window | null {
  const n = Number(raw);
  return WINDOWS.includes(n as Window) ? (n as Window) : null;
}

function formatUpdatedAt(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function dash(value: number | null | undefined): string {
  return value == null ? "—" : String(value);
}

function emphasize(active: boolean, children: React.ReactNode) {
  return active ? <strong>{children}</strong> : children;
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

  const rows = parties
    .filter((party) => canRankOnHeat(party.status))
    .map((party) => {
      const snap = latestSnapshot(party.heatSnapshots);
      return {
        id: party.id,
        name: party.name,
        score: snap?.score ?? null,
        demand1d: snap?.demand1d ?? null,
        demand3d: snap?.demand3d ?? null,
        demand7d: snap?.demand7d ?? null,
        offer1d: snap?.offer1d ?? null,
        offer3d: snap?.offer3d ?? null,
        uniqueDemandSenders7d: snap?.uniqueDemandSenders7d ?? null,
        daysToEvent: snap?.daysToEvent ?? null,
        computedAt: snap?.computedAt ?? null,
      };
    })
    .sort((a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });

  const latestComputedAt = rows.reduce<Date | null>((latest, row) => {
    if (!row.computedAt) return latest;
    if (!latest || row.computedAt > latest) return row.computedAt;
    return latest;
  }, null);

  function href(next: { janela?: string; grupo?: string }) {
    const q = new URLSearchParams();
    const j = next.janela ?? params.janela;
    const g = next.grupo ?? grupo;
    if (j) q.set("janela", j);
    if (g) q.set("grupo", g);
    const s = q.toString();
    return s ? `/heat?${s}` : "/heat";
  }

  const columns = [
    { key: "name", header: "Nome" },
    { key: "demand1d", header: emphasize(janela === 1, "Procura 1") },
    { key: "demand3d", header: emphasize(janela === 3, "Procura 3") },
    { key: "demand7d", header: emphasize(janela === 7, "Procura 7") },
    { key: "offer1d", header: emphasize(janela === 1, "Oferta 1") },
    { key: "offer3d", header: emphasize(janela === 3, "Oferta 3") },
    { key: "uniqueDemandSenders7d", header: "Autores 7d" },
    { key: "daysToEvent", header: "Dias" },
    { key: "score", header: "Score" },
    { key: "computedAt", header: "Atualizado em" },
  ];

  const tableRows = rows.map((row) => ({
    id: row.id,
    cells: {
      name: <Link href={`/parties/${row.id}`}>{row.name}</Link>,
      demand1d: emphasize(janela === 1, dash(row.demand1d)),
      demand3d: emphasize(janela === 3, dash(row.demand3d)),
      demand7d: emphasize(janela === 7, dash(row.demand7d)),
      offer1d: emphasize(janela === 1, dash(row.offer1d)),
      offer3d: emphasize(janela === 3, dash(row.offer3d)),
      uniqueDemandSenders7d: dash(row.uniqueDemandSenders7d),
      daysToEvent: dash(row.daysToEvent),
      score:
        row.score == null ? (
          "—"
        ) : (
          <span className="score">{row.score}</span>
        ),
      computedAt: row.computedAt ? formatUpdatedAt(row.computedAt) : "—",
    },
  }));

  return (
    <main className="page stack">
      <h1>Calor</h1>

      {latestComputedAt ? (
        <Banner tone="muted">
          Atualizado em {formatUpdatedAt(latestComputedAt)}
        </Banner>
      ) : null}

      <p>
        {WINDOWS.map((w, i) => (
          <span key={w}>
            {i > 0 ? " " : null}
            <Link href={href({ janela: String(w) })}>
              {janela === w ? <Badge tone="accent">{w}d</Badge> : `${w}d`}
            </Link>
          </span>
        ))}
      </p>

      <form method="GET">
        <label>
          Grupo
          <select name="grupo" defaultValue={grupo}>
            <option value="">Todos</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        {janela ? <input type="hidden" name="janela" value={String(janela)} /> : null}
        <Button type="submit" variant="ghost">
          Filtrar
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={tableRows}
        empty={
          <Card>
            <p>Nenhuma festa no calor</p>
            <a href="/inbox">Inbox</a>
          </Card>
        }
      />
    </main>
  );
}
