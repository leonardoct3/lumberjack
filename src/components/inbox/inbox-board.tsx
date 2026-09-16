"use client";

import type { JSX } from "react";
import { useState } from "react";
import {
  Check,
  Inbox as InboxIcon,
  Link2,
  Megaphone,
  MessageSquareText,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  actionConfirmCandidate,
  actionRejectCandidate,
} from "@/app/actions/catalog";
import {
  OrphanList,
  type DismissedOrphan,
  type InboxOrphan,
} from "@/components/inbox/orphan-list";
import { SimilarWarning } from "@/components/inbox/similar-warning";
import { useRowActions } from "@/components/inbox/use-row-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { TOAST } from "@/lib/toast-copy";

export type { DismissedOrphan, InboxOrphan };

export type InboxCandidate = {
  id: string;
  sourceText: string;
  groupReach: number;
  name: string;
  eventAtLocal: string;
  lot: string;
  url: string;
  price: string;
};

/** Cross-posting is collapsed into one entry, so surface how far it spread. */
function ReachBadge({ groups }: { groups: number }) {
  if (groups < 2) return null;
  return (
    <span
      title={`A mesma mensagem apareceu em ${groups} grupos`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary tabular-nums"
    >
      <Megaphone className="size-3" aria-hidden="true" />
      {groups} grupos
    </span>
  );
}

export function InboxBoard(props: {
  candidates: InboxCandidate[];
  orphans: InboxOrphan[];
  dismissed: DismissedOrphan[];
  upcoming: { id: string; name: string; aliases: string[] }[];
}): JSX.Element {
  const { candidates, orphans, dismissed, upcoming } = props;
  const { pendingIds, submit } = useRowActions();
  // Tracks what the operator typed, so the duplicate warning follows the edit.
  const [names, setNames] = useState<Record<string, string>>({});

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
                const typedName = names[candidate.id] ?? candidate.name;
                return (
                  <Card key={candidate.id} className="gap-5 overflow-hidden p-0">
                    <div className="border-b border-border/70 bg-muted/25 px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="flex items-center gap-2 font-mono text-[9px] font-semibold tracking-[0.1em] text-primary uppercase">
                          <MessageSquareText className="size-3.5" />
                          Mensagem fonte
                        </p>
                        <span className="flex items-center gap-2">
                          <ReachBadge groups={candidate.groupReach} />
                          <span className="font-mono text-[10px] text-muted-foreground/60">
                            #{String(index + 1).padStart(2, "0")}
                          </span>
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
                            value={typedName}
                            onChange={(event) =>
                              setNames((prev) => ({
                                ...prev,
                                [candidate.id]: event.target.value,
                              }))
                            }
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
                      <SimilarWarning name={typedName} parties={upcoming} />
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

        <div className="lg:sticky lg:top-8">
          <OrphanList
            orphans={orphans}
            dismissed={dismissed}
            upcoming={upcoming}
          />
        </div>
      </div>
    </div>
  );
}
