import Link from "next/link";
import {
  actionCloseLot,
  actionMoveWatchlist,
  actionRemoveFromWatchlist,
} from "@/app/actions/watchlist";
import { hasPreviousEdition, listWatchlist } from "@/catalog/watchlist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <main className="page stack">
      <h1>Watchlist</h1>
      {parties.length === 0 ? (
        <Card>
          <p>Nenhuma festa na fila</p>
          <p>
            <a href="/inbox">Inbox</a> · <a href="/heat">Calor</a>
          </p>
        </Card>
      ) : (
        parties.map((party, index) => {
          const openLots = party.lots.filter((lot) => lot.closedAt == null);
          const heat = latestSnapshot(party.heatSnapshots)?.score ?? "—";
          const previous = hasPreviousEdition(party, catalog);
          return (
            <Card key={party.id}>
              <p>
                <strong>{party.name}</strong>
                {previous ? <Badge>edição anterior</Badge> : null}
              </p>
              <p>Data {formatEventAt(party.eventAt)}</p>
              <p>
                Lote{" "}
                {openLots.map((lot) => lot.label).filter(Boolean).join(", ") ||
                  "—"}
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
              <p>
                Calor <span className="heat-score">{heat}</span>
              </p>
              <div className="row">
                <Link href={`/parties/${party.id}`}>Detalhe</Link>
                {index > 0 ? (
                  <form action={actionMoveWatchlist}>
                    <input type="hidden" name="partyId" value={party.id} />
                    <input type="hidden" name="direction" value="up" />
                    <Button type="submit" variant="ghost">
                      Subir
                    </Button>
                  </form>
                ) : null}
                {index < parties.length - 1 ? (
                  <form action={actionMoveWatchlist}>
                    <input type="hidden" name="partyId" value={party.id} />
                    <input type="hidden" name="direction" value="down" />
                    <Button type="submit" variant="ghost">
                      Descer
                    </Button>
                  </form>
                ) : null}
                <form action={actionRemoveFromWatchlist}>
                  <input type="hidden" name="partyId" value={party.id} />
                  <Button type="submit" variant="ghost">
                    Sair da fila
                  </Button>
                </form>
                {openLots.map((lot) => (
                  <form key={lot.id} action={actionCloseLot}>
                    <input type="hidden" name="lotId" value={lot.id} />
                    <Button type="submit" variant="ghost">
                      Fechar lote
                    </Button>
                  </form>
                ))}
              </div>
            </Card>
          );
        })
      )}
    </main>
  );
}
