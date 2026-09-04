import Link from "next/link";
import {
  actionCloseLot,
  actionMoveWatchlist,
  actionRemoveFromWatchlist,
} from "@/app/actions/watchlist";
import { hasPreviousEdition, listWatchlist } from "@/catalog/watchlist";
import { prisma } from "@/db/client";
import { TZ } from "@/domain/timezone";
import { latestSnapshot } from "@/jobs/refresh-heat";

function formatEventAt(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

export default async function WatchlistPage() {
  const [parties, catalog] = await Promise.all([
    listWatchlist(prisma),
    prisma.party.findMany({
      select: { id: true, name: true, aliases: true, status: true },
    }),
  ]);

  return (
    <main>
      <h1>Watchlist</h1>
      {parties.length === 0 ? (
        <p>Nenhuma festa na fila</p>
      ) : (
        <ol>
          {parties.map((party, index) => {
            const openLots = party.lots.filter((lot) => lot.closedAt == null);
            const heat = latestSnapshot(party.heatSnapshots)?.score ?? "—";
            const previous = hasPreviousEdition(party, catalog);
            return (
              <li key={party.id}>
                <p>
                  <strong>{party.name}</strong>
                  {previous ? <span> edição anterior</span> : null}
                </p>
                <p>Data {formatEventAt(party.eventAt)}</p>
                <p>
                  Lote{" "}
                  {openLots.map((lot) => lot.label).filter(Boolean).join(", ") || "—"}
                </p>
                <p>
                  Link{" "}
                  {openLots
                    .filter((lot) => lot.url)
                    .map((lot) => (
                      <a key={lot.id} href={lot.url!} rel="noreferrer">
                        {lot.url}
                      </a>
                    ))}
                  {openLots.every((lot) => !lot.url) ? "—" : null}
                </p>
                <p>Nota {party.qualitativeScore ?? "—"}</p>
                <p>Calor {heat}</p>
                <p>
                  <Link href={`/parties/${party.id}`}>Detalhe</Link>
                </p>
                {index > 0 ? (
                  <form action={actionMoveWatchlist}>
                    <input type="hidden" name="partyId" value={party.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button type="submit">Subir</button>
                  </form>
                ) : null}
                {index < parties.length - 1 ? (
                  <form action={actionMoveWatchlist}>
                    <input type="hidden" name="partyId" value={party.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button type="submit">Descer</button>
                  </form>
                ) : null}
                <form action={actionRemoveFromWatchlist}>
                  <input type="hidden" name="partyId" value={party.id} />
                  <button type="submit">Sair da fila</button>
                </form>
                {openLots.map((lot) => (
                  <form key={lot.id} action={actionCloseLot}>
                    <input type="hidden" name="lotId" value={lot.id} />
                    <button type="submit">Fechar lote</button>
                  </form>
                ))}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
