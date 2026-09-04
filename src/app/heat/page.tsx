import Link from "next/link";
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

function emphasize(active: boolean, children: string) {
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

  function href(next: { janela?: string; grupo?: string }) {
    const q = new URLSearchParams();
    const j = next.janela ?? params.janela;
    const g = next.grupo ?? grupo;
    if (j) q.set("janela", j);
    if (g) q.set("grupo", g);
    const s = q.toString();
    return s ? `/heat?${s}` : "/heat";
  }

  return (
    <main>
      <h1>Calor</h1>

      <form>
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
        <button type="submit">Filtrar</button>
      </form>

      <p>
        Janela{" "}
        {WINDOWS.map((w, i) => (
          <span key={w}>
            {i > 0 ? " | " : null}
            <Link href={href({ janela: String(w) })}>
              {janela === w ? <strong>{w}d</strong> : `${w}d`}
            </Link>
          </span>
        ))}
      </p>

      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>{emphasize(janela === 1, "Procura 1")}</th>
            <th>{emphasize(janela === 3, "Procura 3")}</th>
            <th>{emphasize(janela === 7, "Procura 7")}</th>
            <th>{emphasize(janela === 1, "Oferta 1")}</th>
            <th>{emphasize(janela === 3, "Oferta 3")}</th>
            <th>Autores 7d</th>
            <th>Dias</th>
            <th>Score</th>
            <th>Atualizado em</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/parties/${row.id}`}>{row.name}</Link>
              </td>
              <td>{emphasize(janela === 1, dash(row.demand1d))}</td>
              <td>{emphasize(janela === 3, dash(row.demand3d))}</td>
              <td>{emphasize(janela === 7, dash(row.demand7d))}</td>
              <td>{emphasize(janela === 1, dash(row.offer1d))}</td>
              <td>{emphasize(janela === 3, dash(row.offer3d))}</td>
              <td>{dash(row.uniqueDemandSenders7d)}</td>
              <td>{dash(row.daysToEvent)}</td>
              <td>{dash(row.score)}</td>
              <td>{row.computedAt ? formatUpdatedAt(row.computedAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
