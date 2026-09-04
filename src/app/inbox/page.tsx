import {
  actionConfirmCandidate,
  actionLinkOrphan,
  actionRejectCandidate,
} from "@/app/actions/catalog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { prisma } from "@/db/client";
import { matchParty } from "@/domain/match";
import { TZ } from "@/domain/timezone";

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

export default async function InboxPage() {
  const [candidates, orphans, upcoming] = await Promise.all([
    prisma.partyCandidate.findMany({
      where: { status: "pending" },
      include: { source: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.message.findMany({
      where: {
        class: { in: ["pista_oferta", "pista_procura"] },
        signals: { none: {} },
      },
      include: { sender: true },
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

  return (
    <main className="page stack">
      <h1>Inbox</h1>

      <div className="two-col">
        <section className="stack">
          <h2>Candidatos</h2>
          {candidates.length === 0 ? (
            <p>Nenhum candidato</p>
          ) : (
            candidates.map((candidate) => (
              <Card key={candidate.id}>
                <p>{candidate.source.text}</p>
                <form action={actionConfirmCandidate} className="stack">
                  <input type="hidden" name="candidateId" value={candidate.id} />
                  <label>
                    Nome
                    <input
                      name="name"
                      defaultValue={candidate.name ?? ""}
                      required
                    />
                  </label>
                  <label>
                    Data
                    <input
                      type="datetime-local"
                      name="eventAt"
                      defaultValue={
                        candidate.eventAt
                          ? toDatetimeLocal(candidate.eventAt)
                          : ""
                      }
                      required
                    />
                  </label>
                  <label>
                    Lote
                    <input
                      name="lot"
                      defaultValue={candidate.lotLabel ?? ""}
                    />
                  </label>
                  <label>
                    URL
                    <input name="url" defaultValue={candidate.url ?? ""} />
                  </label>
                  <label>
                    Preço
                    <input
                      name="price"
                      type="number"
                      step="0.01"
                      defaultValue={candidate.officialPrice ?? ""}
                    />
                  </label>
                  <label>
                    Nota
                    <input
                      name="nota"
                      type="number"
                      min={1}
                      max={5}
                    />
                  </label>
                  <Button type="submit">Confirmar</Button>
                </form>
                <form action={actionRejectCandidate}>
                  <input type="hidden" name="candidateId" value={candidate.id} />
                  <Button type="submit" variant="danger">
                    Rejeitar
                  </Button>
                </form>
              </Card>
            ))
          )}
        </section>

        <section className="stack">
          <h2>Órfãos</h2>
          {orphans.length === 0 ? (
            <p>Nenhum órfão</p>
          ) : (
            orphans.map((message) => {
              const suggested = matchParty(message.text, matchInputs);
              return (
                <Card key={message.id}>
                  <p>
                    {message.sender.name ?? message.sender.waId}: {message.text}
                  </p>
                  <form action={actionLinkOrphan} className="stack">
                    <input type="hidden" name="messageId" value={message.id} />
                    <label>
                      Festa
                      <select name="partyId" defaultValue={suggested?.id ?? ""} required>
                        <option value="" disabled>
                          Selecionar festa
                        </option>
                        {upcoming.map((party) => (
                          <option key={party.id} value={party.id}>
                            {party.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit">Vincular</Button>
                  </form>
                </Card>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
