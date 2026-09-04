import { notFound } from "next/navigation";
import {
  actionAddLot,
  actionCloseLot,
  actionEnqueueWatchlist,
  actionUnlinkSignal,
  actionUpdateParty,
} from "@/app/actions/party";
import { prisma } from "@/db/client";
import { TZ } from "@/domain/timezone";

const PLATFORMS = [
  "sympla",
  "gandaya",
  "blacktag",
  "ingresse",
  "other",
  "unknown",
] as const;

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

  const [candidateSources, sameNameParties] = await Promise.all([
    prisma.partyCandidate.findMany({
      where: {
        status: "confirmed",
        name: party.name,
        source: { partyId: null },
      },
      include: {
        source: { include: { sender: true, group: true, signals: true, candidate: true } },
      },
    }),
    prisma.party.findMany({
      where: { name: party.name },
      select: { id: true, createdAt: true },
    }),
  ]);
  const ownedCandidateSources = candidateSources.filter((candidate) => {
    const nearest = sameNameParties.reduce((best, other) => {
      const delta = Math.abs(other.createdAt.getTime() - candidate.createdAt.getTime());
      const bestDelta = Math.abs(best.createdAt.getTime() - candidate.createdAt.getTime());
      return delta < bestDelta ? other : best;
    });
    return nearest.id === party.id;
  });

  const seen = new Set(party.messages.map((m) => m.id));
  const timeline = [
    ...party.messages,
    ...ownedCandidateSources
      .map((c) => c.source)
      .filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      }),
  ].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());

  const upcoming = party.status === "upcoming";

  return (
    <main>
      <h1>{party.name}</h1>

      <form action={actionUpdateParty}>
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
        <button type="submit">Salvar</button>
      </form>

      {upcoming ? (
        <>
          {party.watchlistPosition == null ? (
            <form action={actionEnqueueWatchlist}>
              <input type="hidden" name="partyId" value={party.id} />
              <button type="submit">Entrar na fila</button>
            </form>
          ) : (
            <p>Na watchlist (posição {party.watchlistPosition})</p>
          )}
        </>
      ) : null}

      <section>
        <h2>Lotes</h2>
        <table>
          <thead>
            <tr>
              <th>Lote</th>
              <th>Link</th>
              <th>Preço</th>
              <th>Plataforma</th>
              <th>Aberto em</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {party.lots.map((lot) => (
              <tr key={lot.id}>
                <td>{lot.label || "—"}</td>
                <td>
                  {lot.url ? (
                    <a href={lot.url} rel="noreferrer">
                      {lot.url}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{lot.officialPrice ?? "—"}</td>
                <td>{lot.platform}</td>
                <td>{formatWhen(lot.openedAt)}</td>
                <td>
                  {lot.closedAt == null ? (
                    <form action={actionCloseLot}>
                      <input type="hidden" name="lotId" value={lot.id} />
                      <input type="hidden" name="partyId" value={party.id} />
                      <button type="submit">Fechar lote</button>
                    </form>
                  ) : (
                    `Fechado ${formatWhen(lot.closedAt)}`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {upcoming ? (
          <form action={actionAddLot}>
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
            <button type="submit">Abrir lote</button>
          </form>
        ) : null}
      </section>

      <section>
        <h2>Linha do tempo</h2>
        {timeline.length === 0 && party.signals.length === 0 ? (
          <p>Nenhuma mensagem</p>
        ) : (
          <ul>
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
                    <button type="submit">Desvincular</button>
                  </form>
                ))}
              </li>
            ))}
            {party.signals
              .filter((signal) => !seen.has(signal.messageId))
              .map((signal) => (
                <li key={signal.id}>
                  <p>
                    {formatWhen(signal.message.sentAt)} · {signal.message.group.name} ·{" "}
                    {signal.message.sender.name ?? signal.message.sender.waId}
                  </p>
                  <p>{signal.message.text}</p>
                  <form action={actionUnlinkSignal}>
                    <input type="hidden" name="signalId" value={signal.id} />
                    <input type="hidden" name="partyId" value={party.id} />
                    <p>Sinal {signal.type === "demand" ? "procura" : "oferta"}</p>
                    <button type="submit">Desvincular</button>
                  </form>
                </li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}
