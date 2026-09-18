"use client";

import type { JSX } from "react";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarPlus,
  EyeOff,
  Link2,
  Plus,
  RotateCcw,
  UserRound,
  X,
} from "lucide-react";
import {
  actionCreatePartyFromMessage,
  actionDismissOrphan,
  actionLinkOrphan,
  actionLinkOrphans,
  actionRestoreOrphan,
} from "@/app/actions/catalog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SectionHeader } from "@/components/ui/page-header";
import { ReachBadge } from "@/components/ui/reach-badge";
import { TOAST } from "@/lib/toast-copy";
import { SimilarWarning } from "./similar-warning";
import { useRowActions } from "./use-row-actions";

export type InboxOrphan = {
  id: string;
  text: string;
  sender: string;
  groupReach: number;
  sentAtLabel: string;
  suggestedEventAtLocal: string;
  defaultPartyId: string;
};

export type DismissedOrphan = {
  id: string;
  text: string;
  sender: string;
  sentAtLabel: string;
};

/** Long lists are the norm here, so the column starts short and grows on demand. */
const PAGE_SIZE = 8;

export function OrphanList(props: {
  orphans: InboxOrphan[];
  dismissed: DismissedOrphan[];
  upcoming: { id: string; name: string; aliases: string[] }[];
}): JSX.Element {
  const { orphans, dismissed, upcoming } = props;
  const { pendingIds, submit } = useRowActions();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [selected, setSelected] = useState(() => new Set<string>());
  const [bulkPartyId, setBulkPartyId] = useState("");

  const hasParties = upcoming.length > 0;
  const shown = orphans.slice(0, visible);
  const remaining = orphans.length - shown.length;
  const selectedOrphans = useMemo(
    () => orphans.filter((o) => selected.has(o.id)),
    [orphans, selected],
  );
  const selectedIds = selectedOrphans.map((o) => o.id);

  // When every selected message points at the same party, the bar starts there:
  // create the party once, tick the rest, confirm.
  const sharedSuggestion = useMemo(() => {
    const ids = new Set(selectedOrphans.map((o) => o.defaultPartyId));
    const [only] = [...ids];
    return ids.size === 1 && only ? only : "";
  }, [selectedOrphans]);
  const effectivePartyId = bulkPartyId || sharedSuggestion;

  function openCreate(id: string) {
    setCreatingFor(id);
    setNewName("");
  }

  function closeCreate() {
    setCreatingFor(null);
    setNewName("");
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function linkSelected() {
    if (!effectivePartyId || selectedIds.length === 0) return;
    const fd = new FormData();
    fd.set("partyId", effectivePartyId);
    for (const id of selectedIds) fd.append("messageIds", id);
    submit("bulk", actionLinkOrphans, fd, TOAST.linkedMany, () => {
      setSelected(new Set());
      setBulkPartyId("");
    });
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Sinais órfãos"
        count={orphans.length}
        description="Vincule a uma festa ativa, crie a festa que ainda não existe, ou dispense."
      />

      {selectedIds.length > 0 ? (
        <Card className="sticky top-4 z-10 gap-3 border-primary/25 bg-primary/8 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-primary">
              {selectedIds.length}{" "}
              {selectedIds.length === 1 ? "selecionada" : "selecionadas"}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              <X /> Limpar
            </Button>
          </div>
          <NativeSelect
            aria-label="Festa para vincular as mensagens selecionadas"
            value={effectivePartyId}
            onChange={(event) => setBulkPartyId(event.target.value)}
            disabled={!hasParties || pendingIds.has("bulk")}
          >
            <option value="">Selecionar festa</option>
            {upcoming.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            className="w-full"
            disabled={!effectivePartyId || pendingIds.has("bulk")}
            aria-busy={pendingIds.has("bulk") || undefined}
            onClick={linkSelected}
          >
            <Link2 /> Vincular selecionadas <ArrowRight />
          </Button>
        </Card>
      ) : null}

      {orphans.length === 0 ? (
        <EmptyState
          title="Nenhum órfão"
          description="Todos os sinais reconhecidos já têm destino."
          icon={Link2}
          compact
        />
      ) : (
        <div className="space-y-3">
          {shown.map((orphan) => {
            const busy = pendingIds.has(orphan.id);
            const creating = creatingFor === orphan.id;
            const checked = selected.has(orphan.id);

            return (
              <Card
                key={orphan.id}
                className={`gap-4 p-4 ${checked ? "border-primary/40" : ""}`}
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelected(orphan.id)}
                    disabled={busy}
                    aria-label={`Selecionar mensagem de ${orphan.sender}`}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted">
                    <UserRound className="size-3.5" />
                  </span>
                  <span className="min-w-0 truncate">{orphan.sender}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                    {orphan.sentAtLabel}
                  </span>
                  <span className="ml-auto">
                    <ReachBadge groups={orphan.groupReach} />
                  </span>
                </div>

                <p className="text-sm leading-6 text-foreground">{orphan.text}</p>

                {creating ? (
                  <form
                    className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submit(
                        orphan.id,
                        actionCreatePartyFromMessage,
                        new FormData(event.currentTarget),
                        TOAST.partyCreated,
                        closeCreate,
                      );
                    }}
                  >
                    <input type="hidden" name="messageId" value={orphan.id} />
                    <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.1em] text-primary uppercase">
                      <CalendarPlus className="size-3.5" /> Nova festa
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor={`new-name-${orphan.id}`}>Nome da festa</Label>
                      <Input
                        id={`new-name-${orphan.id}`}
                        name="name"
                        placeholder="Ex.: Rodeio Jaguariúna"
                        required
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                        disabled={busy}
                        aria-busy={busy || undefined}
                      />
                    </div>
                    <SimilarWarning name={newName} parties={upcoming} />
                    <div className="space-y-2">
                      <Label htmlFor={`new-eventAt-${orphan.id}`}>Data e hora</Label>
                      <Input
                        id={`new-eventAt-${orphan.id}`}
                        name="eventAt"
                        type="datetime-local"
                        defaultValue={orphan.suggestedEventAtLocal}
                        required
                        disabled={busy}
                        aria-busy={busy || undefined}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`new-aliases-${orphan.id}`}>Apelidos</Label>
                      <Input
                        id={`new-aliases-${orphan.id}`}
                        name="aliases"
                        placeholder="Separados por vírgula"
                        disabled={busy}
                        aria-busy={busy || undefined}
                      />
                      <p className="text-[11px] leading-4 text-muted-foreground">
                        Apelidos ajudam as próximas mensagens a casarem sozinhas.
                      </p>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={closeCreate}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy}
                        aria-busy={busy || undefined}
                      >
                        <Plus /> Criar e vincular
                      </Button>
                    </div>
                  </form>
                ) : (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submit(
                        orphan.id,
                        actionLinkOrphan,
                        new FormData(event.currentTarget),
                        TOAST.linked,
                      );
                    }}
                  >
                    <input type="hidden" name="messageId" value={orphan.id} />
                    <div className="space-y-2">
                      <Label htmlFor={`party-${orphan.id}`}>Vincular à festa</Label>
                      <NativeSelect
                        id={`party-${orphan.id}`}
                        name="partyId"
                        defaultValue={orphan.defaultPartyId}
                        required
                        disabled={busy || !hasParties}
                        aria-busy={busy || undefined}
                      >
                        <option value="" disabled>
                          {hasParties
                            ? "Selecionar festa"
                            : "Nenhuma festa ativa ainda"}
                        </option>
                        {upcoming.map((party) => (
                          <option key={party.id} value={party.id}>
                            {party.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        variant="outline"
                        className="flex-1"
                        disabled={busy || !hasParties}
                        aria-busy={busy || undefined}
                      >
                        <Link2 /> Vincular <ArrowRight />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="Criar festa a partir desta mensagem"
                        aria-label="Criar festa a partir desta mensagem"
                        disabled={busy}
                        onClick={() => openCreate(orphan.id)}
                      >
                        <CalendarPlus />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Dispensar"
                        aria-label="Dispensar mensagem"
                        disabled={busy}
                        aria-busy={busy || undefined}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("messageId", orphan.id);
                          submit(orphan.id, actionDismissOrphan, fd, TOAST.dismissed);
                        }}
                      >
                        <EyeOff />
                      </Button>
                    </div>
                  </form>
                )}
              </Card>
            );
          })}

          {remaining > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setVisible((prev) => prev + PAGE_SIZE)}
            >
              {remaining <= PAGE_SIZE
                ? `Mostrar ${remaining === 1 ? "a última" : `as ${remaining} restantes`}`
                : `Mostrar mais ${PAGE_SIZE} de ${remaining}`}
            </Button>
          ) : null}
        </div>
      )}

      {dismissed.length > 0 ? (
        <details className="rounded-[var(--radius)] border border-border/70 bg-card/45 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            Dispensados ({dismissed.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {dismissed.map((message) => (
              <li
                key={message.id}
                className="flex items-start gap-3 border-t border-border/60 pt-2.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">
                    {message.sender} · {message.sentAtLabel}
                  </span>
                  <span className="line-clamp-2 text-muted-foreground">
                    {message.text}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Devolver para a fila"
                  aria-label="Devolver para a fila"
                  disabled={pendingIds.has(message.id)}
                  aria-busy={pendingIds.has(message.id) || undefined}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("messageId", message.id);
                    submit(message.id, actionRestoreOrphan, fd, TOAST.restored);
                  }}
                >
                  <RotateCcw />
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
