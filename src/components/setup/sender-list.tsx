"use client";

import type { JSX } from "react";
import { useMemo, useState } from "react";
import { BellOff, BellRing, Search, ShieldCheck, UserRoundCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SenderShape } from "@/domain/sender-shape";
import { searchGroups } from "@/lib/group-search";

export type SetupSender = {
  id: string;
  name: string;
  muted: boolean;
  /** WhatsApp says so, and it changes how the classifier reads them. */
  groupAdmin: boolean;
  shape: SenderShape;
  messages: number;
  signals: number;
  candidates: number;
  lastLabel: string | null;
};

const SHAPE_LABEL: Record<SenderShape, string> = {
  announces: "anuncia",
  trades: "negocia",
  both: "anuncia e negocia",
  quiet: "só conversa",
};

const PAGE_SIZE = 15;

/**
 * Silencing is decided from volume, so the list is ordered by it. Muted senders
 * stay visible whatever their volume, because this is where undoing happens.
 */
function rank(a: SetupSender, b: SetupSender): number {
  return b.messages - a.messages || a.name.localeCompare(b.name, "pt-BR");
}

function Marks({ sender }: { sender: SetupSender }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">{SHAPE_LABEL[sender.shape]}</Badge>
      {sender.groupAdmin ? (
        <Badge
          variant="outline"
          title="Admin do grupo no WhatsApp: as mensagens dele nunca viram sinal de pista"
        >
          <ShieldCheck className="size-3" aria-hidden="true" /> admin
        </Badge>
      ) : null}
    </span>
  );
}

function MuteButton({
  sender,
  busy,
  onToggle,
}: {
  sender: SetupSender;
  busy: boolean;
  onToggle: (sender: SetupSender) => void;
}) {
  return (
    <Button
      type="button"
      variant={sender.muted ? "secondary" : "ghost"}
      size="sm"
      disabled={busy}
      aria-busy={busy || undefined}
      aria-pressed={sender.muted}
      title={
        sender.muted
          ? "Voltar a abrir candidato e sinal deste remetente"
          : "Parar de abrir candidato e sinal deste remetente"
      }
      onClick={() => onToggle(sender)}
    >
      {sender.muted ? <BellOff /> : <BellRing />}
      {sender.muted ? "Silenciado" : "Ativo"}
    </Button>
  );
}

/**
 * Replaces the old role editor. That screen asked the operator to declare
 * `admin`, `pista` or `unknown` on every contact, but the classifier takes the
 * same path for the last two and sets the first one itself from the WhatsApp
 * group flag — so the work bought nothing. What is left is what a decision
 * needs: who is flooding the board, and one button to stop them.
 */
export function SenderList(props: {
  senders: SetupSender[];
  windowDays: number;
  isBusy: (id: string) => boolean;
  onToggleMute: (sender: SetupSender) => void;
}): JSX.Element {
  const { senders, windowDays, isBusy, onToggleMute } = props;
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const active = useMemo(
    () => senders.filter((s) => s.messages > 0 || s.muted).sort(rank),
    [senders],
  );
  const found = useMemo(() => searchGroups(senders, query), [senders, query]);

  const searching = query.trim().length > 0;
  const rows = searching ? found.matches.slice().sort(rank) : active.slice(0, visible);
  const remaining = searching ? 0 : active.length - rows.length;

  function hint(): string {
    if (searching) {
      if (found.total === 0) return "Nenhum remetente com esse nome.";
      return found.total === 1
        ? "1 remetente encontrado"
        : `${found.total} remetentes encontrados`;
    }
    return `${senders.length} remetentes no total · ${active.length} com mensagem nos últimos ${windowDays} dias`;
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Remetentes"
        count={active.length}
        description={`Quem move o board nos últimos ${windowDays} dias. Silenciar mantém o histórico, mas para de abrir candidato e sinal.`}
      />

      {senders.length === 0 ? (
        <EmptyState
          title="Nenhum remetente"
          description="Novos contatos aparecem quando mensagens forem sincronizadas."
          icon={UserRoundCog}
          compact
        />
      ) : (
        <>
          <Card className="gap-3 p-4 md:p-5">
            <label
              htmlFor="sender-search"
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
            >
              <Search className="size-3.5" aria-hidden="true" />
              Buscar remetente
            </label>
            <Input
              id="sender-search"
              type="search"
              autoComplete="off"
              placeholder="Busque pelo nome, ex: promoter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {hint()}
            </p>
          </Card>

          {rows.length === 0 ? null : (
            <Card className="overflow-hidden p-0">
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Remetente</TableHead>
                      <TableHead>Mensagens</TableHead>
                      <TableHead>Sinais</TableHead>
                      <TableHead>Candidatos</TableHead>
                      <TableHead className="hidden lg:table-cell">Última</TableHead>
                      <TableHead className="text-right">Silenciar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((sender) => (
                      <TableRow key={sender.id} className="h-14">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-background/40 text-muted-foreground">
                              {sender.groupAdmin ? (
                                <ShieldCheck className="size-4" />
                              ) : (
                                <UserRoundCog className="size-4" />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">
                                {sender.name}
                              </span>
                              <Marks sender={sender} />
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {sender.messages}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {sender.signals}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {sender.candidates}
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                          {sender.lastLabel ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <MuteButton
                            sender={sender}
                            busy={isBusy(sender.id)}
                            onToggle={onToggleMute}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul className="divide-y divide-border/70 md:hidden">
                {rows.map((sender) => (
                  <li key={sender.id} className="space-y-3 p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-background/40 text-muted-foreground">
                        {sender.groupAdmin ? (
                          <ShieldCheck className="size-4" />
                        ) : (
                          <UserRoundCog className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{sender.name}</p>
                        <Marks sender={sender} />
                      </div>
                      <MuteButton
                        sender={sender}
                        busy={isBusy(sender.id)}
                        onToggle={onToggleMute}
                      />
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      {sender.messages} msg · {sender.signals} sinais ·{" "}
                      {sender.candidates} cand.
                      {sender.lastLabel ? ` · ${sender.lastLabel}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {remaining > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setVisible((prev) => prev + PAGE_SIZE)}
            >
              Mostrar mais {Math.min(PAGE_SIZE, remaining)} de {remaining}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
