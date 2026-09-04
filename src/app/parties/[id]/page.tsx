import { notFound } from "next/navigation";
import {
  actionAddLot,
  actionCloseLot,
  actionEnqueueWatchlist,
  actionUnlinkSignal,
  actionUpdateParty,
} from "@/app/actions/party";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { prisma } from "@/db/client";
import { canAppearOnWatchlist } from "@/domain/gates";
import { TZ } from "@/domain/timezone";

const PLATFORMS = [
  "sympla",
  "gandaya",
  "blacktag",
  "ingresse",
  "other",
  "unknown",
] as const;

const STATUS_LABEL: Record<string, string> = {
  upcoming: "Futura",
  past: "Passada",
  cancelled: "Cancelada",
};

function toDatetimeLocal(value: Date): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(value).replace(" ", "T");
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

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

  const seen = new Set(party.messages.map((m) => m.id));
  const timeline = party.messages;

  const upcoming = party.status === "upcoming";
  const noBuy = party.status === "past" || party.status === "cancelled";
  const hasOpenLot = party.lots.some((lot) => lot.closedAt == null);
  const watchlistEligible = canAppearOnWatchlist({
    status: party.status,
    hasOpenLot,
  });

  const lotRows = party.lots.map((lot) => ({
    id: lot.id,
    cells: {
      label: lot.label || "—",
      link: lot.url ? (
        <a href={lot.url} rel="noreferrer">
          {lot.url}
        </a>
      ) : (
        "—"
      ),
      price: lot.officialPrice ?? "—",
      platform: lot.platform,
      openedAt: formatWhen(lot.openedAt),
      action:
        lot.closedAt == null ? (
          <form action={actionCloseLot}>
            <input type="hidden" name="lotId" value={lot.id} />
            <input type="hidden" name="partyId" value={party.id} />
            <Button type="submit" variant="ghost">
              Fechar lote
            </Button>
          </form>
        ) : (
          `Fechado ${formatWhen(lot.closedAt)}`
        ),
    },
  }));

  return (
    <main className="page stack">
      <Card>
        <h1>{party.name}</h1>
        <p>Data {formatWhen(party.eventAt)}</p>
        <p>Status {STATUS_LABEL[party.status] ?? party.status}</p>
        {noBuy ? <Banner tone="danger">sem compra</Banner> : null}
        {watchlistEligible ? (
          party.watchlistPosition == null ? (
            <form action={actionEnqueueWatchlist}>
              <input type="hidden" name="partyId" value={party.id} />
              <Button type="submit">Entrar na fila</Button>
            </form>
          ) : (
            <p>Na watchlist (posição {party.watchlistPosition})</p>
          )
        ) : null}
      </Card>

      <Card>
        <h2>Lotes</h2>
        <DataTable
          columns={[
            { key: "label", header: "Lote" },
            { key: "link", header: "Link" },
            { key: "price", header: "Preço" },
            { key: "platform", header: "Plataforma" },
            { key: "openedAt", header: "Aberto em" },
            { key: "action", header: "" },
          ]}
          rows={lotRows}
          empty={<p>Nenhum lote</p>}
        />

        {upcoming ? (
          <form action={actionAddLot} className="stack">
            <input type="hidden" name="partyId" value={party.id} />
            <label>
              Lote
              <input name="label" required />
            </label>
            <label>
              URL
              <input name="url" />
            </label>
            <label>
              Preço
              <input name="price" type="number" step="0.01" />
            </label>
            <label>
              Plataforma
              <select name="platform" defaultValue="unknown">
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Abrir lote</Button>
          </form>
        ) : null}
      </Card>

      <Card>
        <h2>Editar</h2>
        <form action={actionUpdateParty} className="stack">
          <input type="hidden" name="partyId" value={party.id} />
          <label>
            Nome
            <input name="name" defaultValue={party.name} required />
          </label>
          <label>
            Data
            <input
              type="datetime-local"
              name="eventAt"
              defaultValue={toDatetimeLocal(party.eventAt)}
              required
            />
          </label>
          <label>
            Status
            <select name="status" defaultValue={party.status}>
              <option value="upcoming">Futura</option>
              <option value="past">Passada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
          <label>
            Apelidos
            <input name="aliases" defaultValue={party.aliases.join(", ")} />
          </label>
          <label>
            Nota
            <input
              name="nota"
              type="number"
              min={1}
              max={5}
              defaultValue={party.qualitativeScore ?? ""}
            />
          </label>
          <label>
            Notas
            <textarea name="notes" defaultValue={party.notes ?? ""} />
          </label>
          <Button type="submit">Salvar</Button>
        </form>
      </Card>

      <Card>
        <h2>Linha do tempo</h2>
        {timeline.length === 0 && party.signals.length === 0 ? (
          <p>Nenhuma mensagem</p>
        ) : (
          <ul className="stack">
            {timeline.map((message) => (
              <li key={message.id}>
                <p>
                  {formatWhen(message.sentAt)} · {message.group.name} ·{" "}
                  {message.sender.name ?? message.sender.waId}
                </p>
                <p>{message.text}</p>
                {message.candidate ? <p>Origem do candidato</p> : null}
                {message.signals.map((signal) => (
                  <form key={signal.id} action={actionUnlinkSignal}>
                    <input type="hidden" name="signalId" value={signal.id} />
                    <input type="hidden" name="partyId" value={party.id} />
                    <p>Sinal {signal.type === "demand" ? "procura" : "oferta"}</p>
                    <Button type="submit" variant="danger">
                      Desvincular
                    </Button>
                  </form>
                ))}
              </li>
            ))}
            {party.signals
              .filter((signal) => !seen.has(signal.messageId))
              .map((signal) => (
                <li key={signal.id}>
                  <p>
                    {formatWhen(signal.message.sentAt)} ·{" "}
                    {signal.message.group.name} ·{" "}
                    {signal.message.sender.name ?? signal.message.sender.waId}
                  </p>
                  <p>{signal.message.text}</p>
                  <form action={actionUnlinkSignal}>
                    <input type="hidden" name="signalId" value={signal.id} />
                    <input type="hidden" name="partyId" value={party.id} />
                    <p>Sinal {signal.type === "demand" ? "procura" : "oferta"}</p>
                    <Button type="submit" variant="danger">
                      Desvincular
                    </Button>
                  </form>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
