"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CircleAlert,
  Clock3,
  ExternalLink,
  History,
  Link2Off,
  ListPlus,
  MessageSquareText,
  NotebookPen,
  Pencil,
  Plus,
  Save,
  Tag,
  Ticket,
  TicketCheck,
  UserRound,
} from "lucide-react";
import {
  actionAddLot,
  actionCloseLot,
  actionEnqueueWatchlist,
  actionUnlinkSignal,
  actionUpdateLot,
  actionUpdateParty,
} from "@/app/actions/party";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatWhen, toDatetimeLocal } from "@/lib/datetime";
import { runAction } from "@/lib/run-action";
import { TOAST } from "@/lib/toast-copy";

export type PartyLot = {
  id: string;
  label: string;
  url: string | null;
  price: string;
  platform: string;
  openedAt: string;
  closedAt: string | null;
};

export type PartyTimelineItem = {
  id: string;
  sentAt: string;
  groupName: string;
  sender: string;
  text: string;
  isCandidateSource: boolean;
  signals: { id: string; kind: "procura" | "oferta" }[];
};

const PLATFORMS = ["sympla", "gandaya", "blacktag", "ingresse", "other", "unknown"] as const;

const PLATFORM_LABEL: Record<(typeof PLATFORMS)[number], string> = {
  sympla: "Sympla",
  gandaya: "Gandaya",
  blacktag: "Blacktag",
  ingresse: "Ingresse",
  other: "Outra",
  unknown: "Não informada",
};

const STATUS_LABEL: Record<"upcoming" | "past" | "cancelled", string> = {
  upcoming: "Futura",
  past: "Passada",
  cancelled: "Cancelada",
};

const selectClassName =
  "h-10 w-full rounded-[10px] border border-input bg-background/55 px-3.5 text-sm outline-none transition-colors hover:border-muted-foreground/45 focus:border-ring focus:ring-3 focus:ring-ring/12";

export function PartyBoard(props: {
  party: {
    id: string;
    name: string;
    eventAt: string;
    status: "upcoming" | "past" | "cancelled";
    aliases: string;
    nota: string;
    notes: string;
    watchlistPosition: number | null;
  };
  noBuy: boolean;
  upcoming: boolean;
  watchlistEligible: boolean;
  lots: PartyLot[];
  timeline: PartyTimelineItem[];
}): JSX.Element {
  const { party, noBuy, upcoming, watchlistEligible, lots, timeline } = props;
  const router = useRouter();
  const [, start] = useTransition();
  const [pendingIds, setPendingIds] = useState(() => new Set<string>());
  const [editingLotId, setEditingLotId] = useState<string | null>(null);
  const refresh = () => router.refresh();

  function submit(
    id: string,
    action: (fd: FormData) => Promise<void>,
    fd: FormData,
    success: string,
    onSuccess?: () => void,
  ) {
    setPendingIds((prev) => new Set(prev).add(id));
    start(() => {
      void runAction(action, fd, success, refresh)
        .then((ok) => {
          if (ok) onSuccess?.();
        })
        .finally(() =>
          setPendingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        );
    });
  }

  function editLotButton(lot: PartyLot): JSX.Element {
    const open = editingLotId === lot.id;
    const label = open ? "Fechar edição do lote" : "Editar lote";
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setEditingLotId(open ? null : lot.id)}
      >
        <Pencil />
      </Button>
    );
  }

  /** `scope` keeps the ids unique between the desktop table and the mobile cards. */
  function lotForm(lot: PartyLot, scope: string): JSX.Element {
    const busy = pendingIds.has(`lot-edit-${lot.id}`);
    const field = (name: string) => `lot-${scope}-${lot.id}-${name}`;
    return (
      <form
        className="grid gap-4 md:grid-cols-[1fr_1.5fr_.7fr_1fr_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          submit(
            `lot-edit-${lot.id}`,
            actionUpdateLot,
            new FormData(event.currentTarget),
            TOAST.saved,
            () => setEditingLotId(null),
          );
        }}
      >
        <input type="hidden" name="lotId" value={lot.id} />
        <input type="hidden" name="partyId" value={party.id} />
        <div className="space-y-2">
          <Label htmlFor={field("label")}>Lote</Label>
          <Input id={field("label")} name="label" defaultValue={lot.label} required disabled={busy} aria-busy={busy || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={field("url")}>Link de venda</Label>
          <Input id={field("url")} name="url" type="url" defaultValue={lot.url ?? ""} placeholder="https://" disabled={busy} aria-busy={busy || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={field("price")}>Preço</Label>
          <Input id={field("price")} name="price" type="number" step="0.01" defaultValue={lot.price} placeholder="0,00" disabled={busy} aria-busy={busy || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={field("platform")}>Plataforma</Label>
          <select id={field("platform")} name="platform" defaultValue={lot.platform} disabled={busy} aria-busy={busy || undefined} className={selectClassName}>
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>{PLATFORM_LABEL[platform]}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            <Save /> Salvar
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditingLotId(null)}>
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  const enqueueBusy = pendingIds.has("enqueue");
  const addLotBusy = pendingIds.has("add-lot");
  const editBusy = pendingIds.has("edit");
  const openLots = lots.filter((lot) => lot.closedAt == null);

  return (
    <div className="space-y-7">
      <Link
        href="/watchlist"
        className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground no-underline hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Voltar para a fila
      </Link>

      <PageHeader
        eyebrow="Dossiê da festa"
        title={party.name}
        description="Centralize lotes, detalhes do evento e sinais capturados em uma única leitura."
        icon={Ticket}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={upcoming ? "border-primary/20 bg-primary/8 text-primary" : undefined}>
              <span className={`size-1.5 rounded-full ${upcoming ? "bg-primary" : "bg-muted-foreground"}`} />
              {STATUS_LABEL[party.status]}
            </Badge>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" />
              {formatWhen(party.eventAt)}
            </span>
          </div>
        }
        actions={
          watchlistEligible && !noBuy && upcoming ? (
            party.watchlistPosition == null ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit("enqueue", actionEnqueueWatchlist, new FormData(event.currentTarget), TOAST.enrolled);
                }}
              >
                <input type="hidden" name="partyId" value={party.id} />
                <Button type="submit" disabled={enqueueBusy} aria-busy={enqueueBusy || undefined}>
                  <ListPlus /> Entrar na fila
                </Button>
              </form>
            ) : (
              <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-2.5 text-xs font-semibold text-primary">
                Posição {String(party.watchlistPosition).padStart(2, "0")} na fila
              </div>
            )
          ) : null
        }
      />

      {noBuy ? (
        <Alert variant="destructive" className="border-destructive/25 bg-destructive/8 py-4">
          <CircleAlert />
          <AlertTitle>Sem compra</AlertTitle>
          <AlertDescription>
            Esta festa está encerrada ou cancelada. As ações de compra foram desativadas.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius)] border border-border/80 bg-card">
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Lotes</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">{String(lots.length).padStart(2, "0")}</p>
        </div>
        <div className="border-x border-border/80 p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Em aberto</p>
          <p className="mt-2 font-mono text-xl font-semibold text-primary tabular-nums md:text-2xl">{String(openLots.length).padStart(2, "0")}</p>
        </div>
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Sinais</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">{String(timeline.length).padStart(2, "0")}</p>
        </div>
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Lotes e venda"
          count={lots.length}
          description="Histórico de disponibilidade e links oficiais."
        />

        {lots.length === 0 ? (
          <EmptyState
            title="Nenhum lote cadastrado"
            description={upcoming ? "Abra o primeiro lote usando o formulário abaixo." : "Não há registros de venda para esta festa."}
            icon={Ticket}
            compact
          />
        ) : (
          <>
            <Card className="hidden overflow-hidden p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Lote</TableHead>
                    <TableHead>Preço</TableHead>
                    <TableHead>Plataforma</TableHead>
                    <TableHead>Aberto em</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lots.map((lot) => {
                    const busy = pendingIds.has(`lot-${lot.id}`);
                    return (
                      <Fragment key={lot.id}>
                      <TableRow>
                        <TableCell>
                          <div>
                            <p className="font-semibold">{lot.label || "Sem nome"}</p>
                            {lot.url ? (
                              <a href={lot.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground no-underline hover:text-primary">
                                Abrir venda <ExternalLink className="size-3" />
                              </a>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">{lot.price ? `R$ ${lot.price}` : "—"}</TableCell>
                        <TableCell><Badge variant="outline">{PLATFORM_LABEL[lot.platform as keyof typeof PLATFORM_LABEL] ?? lot.platform}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatWhen(lot.openedAt)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={lot.closedAt == null ? "border-primary/20 bg-primary/8 text-primary" : undefined}>
                            {lot.closedAt == null ? "Aberto" : "Fechado"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {lot.closedAt == null ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                aria-busy={busy || undefined}
                                onClick={() => {
                                  const fd = new FormData();
                                  fd.set("lotId", lot.id);
                                  fd.set("partyId", party.id);
                                  submit(`lot-${lot.id}`, actionCloseLot, fd, TOAST.lotClosed);
                                }}
                              >
                                <TicketCheck /> Fechar lote
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">{formatWhen(lot.closedAt)}</span>
                            )}
                            {editLotButton(lot)}
                          </div>
                        </TableCell>
                      </TableRow>
                      {editingLotId === lot.id ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={6} className="bg-muted/25 p-5">
                            {lotForm(lot, "table")}
                          </TableCell>
                        </TableRow>
                      ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            <ul className="space-y-3 md:hidden">
              {lots.map((lot) => {
                const busy = pendingIds.has(`lot-${lot.id}`);
                return (
                  <li key={lot.id}>
                    <Card className="gap-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{lot.label || "Sem nome"}</p>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">{lot.price ? `R$ ${lot.price}` : "Preço não informado"}</p>
                        </div>
                        <Badge variant="outline" className={lot.closedAt == null ? "border-primary/20 bg-primary/8 text-primary" : undefined}>
                          {lot.closedAt == null ? "Aberto" : "Fechado"}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border/70 bg-background/35 p-3 text-xs">
                        <div>
                          <p className="text-muted-foreground">Plataforma</p>
                          <p className="mt-1 font-medium">{PLATFORM_LABEL[lot.platform as keyof typeof PLATFORM_LABEL] ?? lot.platform}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Aberto em</p>
                          <p className="mt-1 font-medium">{formatWhen(lot.openedAt)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {lot.url ? (
                          <Button asChild variant="outline" size="sm">
                            <a href={lot.url} target="_blank" rel="noreferrer">Abrir venda <ExternalLink /></a>
                          </Button>
                        ) : null}
                        {lot.closedAt == null ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-busy={busy || undefined}
                            onClick={() => {
                              const fd = new FormData();
                              fd.set("lotId", lot.id);
                              fd.set("partyId", party.id);
                              submit(`lot-${lot.id}`, actionCloseLot, fd, TOAST.lotClosed);
                            }}
                          >
                            <TicketCheck /> Fechar lote
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={editingLotId === lot.id}
                          onClick={() =>
                            setEditingLotId(editingLotId === lot.id ? null : lot.id)
                          }
                        >
                          <Pencil /> {editingLotId === lot.id ? "Fechar" : "Editar"}
                        </Button>
                      </div>
                      {editingLotId === lot.id ? (
                        <div className="border-t border-border/60 pt-4">
                          {lotForm(lot, "card")}
                        </div>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {!noBuy && upcoming ? (
          <Card className="gap-5 border-primary/15 bg-card p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Plus className="size-4" />
              </span>
              <div>
                <h3 className="font-semibold">Abrir novo lote</h3>
                <p className="mt-1 text-xs text-muted-foreground">Adicione uma nova janela de venda para esta festa.</p>
              </div>
            </div>
            <form
              className="grid gap-4 md:grid-cols-[1fr_1.5fr_.7fr_1fr_auto] md:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                submit("add-lot", actionAddLot, new FormData(event.currentTarget), TOAST.lotOpened);
              }}
            >
              <input type="hidden" name="partyId" value={party.id} />
              <div className="space-y-2">
                <Label htmlFor="lot-label">Lote</Label>
                <Input id="lot-label" name="label" placeholder="2º lote" required disabled={addLotBusy} aria-busy={addLotBusy || undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lot-url">Link de venda</Label>
                <Input id="lot-url" name="url" type="url" placeholder="https://" disabled={addLotBusy} aria-busy={addLotBusy || undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lot-price">Preço</Label>
                <Input id="lot-price" name="price" type="number" step="0.01" placeholder="0,00" disabled={addLotBusy} aria-busy={addLotBusy || undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lot-platform">Plataforma</Label>
                <select id="lot-platform" name="platform" defaultValue="unknown" disabled={addLotBusy} aria-busy={addLotBusy || undefined} className={selectClassName}>
                  {PLATFORMS.map((platform) => <option key={platform} value={platform}>{PLATFORM_LABEL[platform]}</option>)}
                </select>
              </div>
              <Button type="submit" disabled={addLotBusy} aria-busy={addLotBusy || undefined}>
                <Plus /> Abrir
              </Button>
            </form>
          </Card>
        ) : null}
      </section>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(320px,.72fr)_minmax(0,1.28fr)]">
        <section className="space-y-4 xl:sticky xl:top-8">
          <SectionHeader title="Dados da festa" description="Informações usadas no catálogo e nas regras de compra." />
          <Card className="gap-5 p-5">
            <div className="flex items-center gap-3 border-b border-border/65 pb-4">
              <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground"><NotebookPen className="size-4" /></span>
              <div>
                <h3 className="font-semibold">Editar cadastro</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Mantenha os dados normalizados.</p>
              </div>
            </div>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit("edit", actionUpdateParty, new FormData(event.currentTarget), TOAST.saved);
              }}
            >
              <input type="hidden" name="partyId" value={party.id} />
              <div className="space-y-2">
                <Label htmlFor="party-name">Nome</Label>
                <Input id="party-name" name="name" defaultValue={party.name} required disabled={editBusy} aria-busy={editBusy || undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="party-eventAt">Data e hora</Label>
                <Input id="party-eventAt" type="datetime-local" name="eventAt" defaultValue={toDatetimeLocal(party.eventAt)} required disabled={editBusy} aria-busy={editBusy || undefined} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="party-status">Status</Label>
                  <select id="party-status" name="status" defaultValue={party.status} disabled={editBusy} aria-busy={editBusy || undefined} className={selectClassName}>
                    <option value="upcoming">Futura</option>
                    <option value="past">Passada</option>
                    <option value="cancelled">Cancelada</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="party-nota">Nota</Label>
                  <Input id="party-nota" name="nota" type="number" min={1} max={5} defaultValue={party.nota} placeholder="1–5" disabled={editBusy} aria-busy={editBusy || undefined} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="party-aliases">Apelidos</Label>
                <Input id="party-aliases" name="aliases" defaultValue={party.aliases} placeholder="Separados por vírgula" disabled={editBusy} aria-busy={editBusy || undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="party-notes">Notas internas</Label>
                <Textarea id="party-notes" name="notes" defaultValue={party.notes} placeholder="Contexto útil para a operação…" disabled={editBusy} aria-busy={editBusy || undefined} />
              </div>
              <Button type="submit" className="w-full" disabled={editBusy} aria-busy={editBusy || undefined}>
                <Save /> Salvar alterações
              </Button>
            </form>
          </Card>
        </section>

        <section className="space-y-4">
          <SectionHeader title="Linha do tempo" count={timeline.length} description="Mensagens e sinais associados a esta festa." />
          {timeline.length === 0 ? (
            <EmptyState title="Nenhuma mensagem" description="Os sinais vinculados vão compor o histórico desta festa." icon={History} compact />
          ) : (
            <Card className="gap-0 overflow-hidden p-0">
              <ul className="divide-y divide-border/70">
                {timeline.map((item, index) => (
                  <li key={item.id} className="relative p-5">
                    <div className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-background/50 text-muted-foreground">
                          <MessageSquareText className="size-4" />
                        </span>
                        {index < timeline.length - 1 ? <span className="mt-2 h-full w-px bg-border/70" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="flex items-center gap-2 text-xs font-medium">
                            <UserRound className="size-3.5 text-muted-foreground" />
                            {item.sender}
                            <span className="text-muted-foreground">em {item.groupName}</span>
                          </p>
                          <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                            <Clock3 className="size-3" /> {formatWhen(item.sentAt)}
                          </p>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-foreground/90">{item.text}</p>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          {item.isCandidateSource ? (
                            <Badge variant="outline"><Tag /> Origem do candidato</Badge>
                          ) : null}
                          {item.signals.map((signal) => {
                            const busy = pendingIds.has(`signal-${signal.id}`);
                            return (
                              <div key={signal.id} className="inline-flex items-center gap-1 rounded-lg border border-border bg-background/35 p-1 pl-2.5">
                                <span className="font-mono text-[10px] font-medium text-muted-foreground uppercase">{signal.kind}</span>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="xs"
                                  disabled={busy}
                                  aria-busy={busy || undefined}
                                  onClick={() => {
                                    const fd = new FormData();
                                    fd.set("signalId", signal.id);
                                    fd.set("partyId", party.id);
                                    submit(`signal-${signal.id}`, actionUnlinkSignal, fd, TOAST.unlinked);
                                  }}
                                >
                                  <Link2Off /> Desvincular
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
