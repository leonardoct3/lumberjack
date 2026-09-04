"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowRight,
  Check,
  Inbox as InboxIcon,
  Link2,
  MessageSquareText,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  actionConfirmCandidate,
  actionLinkOrphan,
  actionRejectCandidate,
} from "@/app/actions/catalog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { runAction } from "@/lib/run-action";
import { TOAST } from "@/lib/toast-copy";

export type InboxCandidate = {
  id: string;
  sourceText: string;
  name: string;
  eventAtLocal: string;
  lot: string;
  url: string;
  price: string;
};

export type InboxOrphan = {
  id: string;
  text: string;
  sender: string;
  defaultPartyId: string;
};

const selectClassName =
  "h-10 w-full rounded-[10px] border border-input bg-background/55 px-3.5 text-sm outline-none transition-colors hover:border-muted-foreground/45 focus:border-ring focus:ring-3 focus:ring-ring/12";

export function InboxBoard(props: {
  candidates: InboxCandidate[];
  orphans: InboxOrphan[];
  upcoming: { id: string; name: string }[];
}): JSX.Element {
  const { candidates, orphans, upcoming } = props;
  const router = useRouter();
  const [, start] = useTransition();
  const [pendingIds, setPendingIds] = useState(() => new Set<string>());
  const refresh = () => router.refresh();

  function submit(
    id: string,
    action: (fd: FormData) => Promise<void>,
    fd: FormData,
    success: string,
  ) {
    setPendingIds((prev) => new Set(prev).add(id));
    start(() => {
      void runAction(action, fd, success, refresh).finally(() =>
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      );
    });
  }

  const total = candidates.length + orphans.length;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Triagem assistida"
        title="Inbox de sinais"
        description="Revise o que o monitor encontrou antes de transformar mensagens em dados de operação."
        icon={InboxIcon}
        meta={
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" />
              {candidates.length} candidatos sugeridos
            </span>
            <span className="flex items-center gap-1.5">
              <Link2 className="size-3.5" />
              {orphans.length} sinais sem vínculo
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius)] border border-border/80 bg-card">
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Pendências</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">{String(total).padStart(2, "0")}</p>
        </div>
        <div className="border-x border-border/80 p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Candidatos</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">{String(candidates.length).padStart(2, "0")}</p>
        </div>
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Órfãos</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">{String(orphans.length).padStart(2, "0")}</p>
        </div>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <section className="space-y-4">
          <SectionHeader
            title="Candidatos"
            count={candidates.length}
            description="Valide as informações extraídas da mensagem original."
          />
          {candidates.length === 0 ? (
            <EmptyState
              title="Nenhum candidato"
              description="Novas festas detectadas vão chegar aqui para confirmação."
              icon={Sparkles}
              compact
            />
          ) : (
            <div className="space-y-4">
              {candidates.map((candidate, index) => {
                const busy = pendingIds.has(candidate.id);
                return (
                  <Card key={candidate.id} className="gap-5 overflow-hidden p-0">
                    <div className="border-b border-border/70 bg-muted/25 px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="flex items-center gap-2 font-mono text-[9px] font-semibold tracking-[0.1em] text-primary uppercase">
                          <MessageSquareText className="size-3.5" />
                          Mensagem fonte
                        </p>
                        <span className="font-mono text-[10px] text-muted-foreground/60">
                          #{String(index + 1).padStart(2, "0")}
                        </span>
                      </div>
                      <blockquote className="mt-3 border-l-2 border-primary/30 pl-3 text-sm leading-6 text-muted-foreground">
                        {candidate.sourceText}
                      </blockquote>
                    </div>

                    <form
                      className="space-y-5 px-5 pb-5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submit(
                          candidate.id,
                          actionConfirmCandidate,
                          new FormData(event.currentTarget),
                          TOAST.confirmed,
                        );
                      }}
                    >
                      <input type="hidden" name="candidateId" value={candidate.id} />
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`name-${candidate.id}`}>Nome da festa</Label>
                          <Input
                            id={`name-${candidate.id}`}
                            name="name"
                            defaultValue={candidate.name}
                            placeholder="Ex.: ONIX"
                            required
                            disabled={busy}
                            aria-busy={busy || undefined}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`eventAt-${candidate.id}`}>Data e hora</Label>
                          <Input
                            id={`eventAt-${candidate.id}`}
                            type="datetime-local"
                            name="eventAt"
                            defaultValue={candidate.eventAtLocal}
                            required
                            disabled={busy}
                            aria-busy={busy || undefined}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label htmlFor={`lot-${candidate.id}`}>Lote</Label>
                          <Input id={`lot-${candidate.id}`} name="lot" defaultValue={candidate.lot} placeholder="1º lote" disabled={busy} aria-busy={busy || undefined} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`price-${candidate.id}`}>Preço</Label>
                          <Input id={`price-${candidate.id}`} name="price" type="number" step="0.01" defaultValue={candidate.price} placeholder="0,00" disabled={busy} aria-busy={busy || undefined} />
                        </div>
                        <div className="col-span-2 space-y-2 md:col-span-1">
                          <Label htmlFor={`nota-${candidate.id}`}>Nota</Label>
                          <Input id={`nota-${candidate.id}`} name="nota" type="number" min={1} max={5} placeholder="1–5" disabled={busy} aria-busy={busy || undefined} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`url-${candidate.id}`}>Link de venda</Label>
                        <Input id={`url-${candidate.id}`} name="url" type="url" defaultValue={candidate.url} placeholder="https://" disabled={busy} aria-busy={busy || undefined} />
                      </div>
                      <div className="flex flex-col-reverse gap-2 border-t border-border/65 pt-4 sm:flex-row sm:justify-end">
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={busy}
                          aria-busy={busy || undefined}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("candidateId", candidate.id);
                            submit(candidate.id, actionRejectCandidate, fd, TOAST.rejected);
                          }}
                        >
                          <Trash2 /> Rejeitar
                        </Button>
                        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
                          <Check /> Confirmar festa
                        </Button>
                      </div>
                    </form>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4 lg:sticky lg:top-8">
          <SectionHeader
            title="Sinais órfãos"
            count={orphans.length}
            description="Vincule mensagens reconhecidas a uma festa ativa."
          />
          {orphans.length === 0 ? (
            <EmptyState
              title="Nenhum órfão"
              description="Todos os sinais reconhecidos já têm destino."
              icon={Link2}
              compact
            />
          ) : (
            <div className="space-y-3">
              {orphans.map((orphan) => {
                const busy = pendingIds.has(orphan.id);
                return (
                  <Card key={orphan.id} className="gap-4 p-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="grid size-7 place-items-center rounded-lg bg-muted">
                        <UserRound className="size-3.5" />
                      </span>
                      <span>{orphan.sender}</span>
                    </div>
                    <p className="text-sm leading-6 text-foreground">{orphan.text}</p>
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submit(orphan.id, actionLinkOrphan, new FormData(event.currentTarget), TOAST.linked);
                      }}
                    >
                      <input type="hidden" name="messageId" value={orphan.id} />
                      <div className="space-y-2">
                        <Label htmlFor={`party-${orphan.id}`}>Vincular à festa</Label>
                        <select id={`party-${orphan.id}`} name="partyId" defaultValue={orphan.defaultPartyId} required disabled={busy} aria-busy={busy || undefined} className={selectClassName}>
                          <option value="" disabled>Selecionar festa</option>
                          {upcoming.map((party) => (
                            <option key={party.id} value={party.id}>{party.name}</option>
                          ))}
                        </select>
                      </div>
                      <Button type="submit" variant="outline" className="w-full" disabled={busy} aria-busy={busy || undefined}>
                        <Link2 /> Vincular mensagem <ArrowRight />
                      </Button>
                    </form>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
