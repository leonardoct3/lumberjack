"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  actionConfirmCandidate,
  actionLinkOrphan,
  actionRejectCandidate,
} from "@/app/actions/catalog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  "border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs";

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

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Candidatos</h2>
        {candidates.length === 0 ? (
          <p>Nenhum candidato</p>
        ) : (
          candidates.map((candidate) => {
            const busy = pendingIds.has(candidate.id);
            return (
              <Card key={candidate.id} className="gap-4 p-4">
                <p className="text-muted-foreground text-sm">
                  {candidate.sourceText}
                </p>
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(
                      candidate.id,
                      actionConfirmCandidate,
                      new FormData(e.currentTarget),
                      TOAST.confirmed,
                    );
                  }}
                >
                  <input
                    type="hidden"
                    name="candidateId"
                    value={candidate.id}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor={`name-${candidate.id}`}>Nome</Label>
                    <Input
                      id={`name-${candidate.id}`}
                      name="name"
                      defaultValue={candidate.name}
                      required
                      disabled={busy}
                      aria-busy={busy || undefined}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`eventAt-${candidate.id}`}>Data</Label>
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
                  <div className="space-y-1.5">
                    <Label htmlFor={`lot-${candidate.id}`}>Lote</Label>
                    <Input
                      id={`lot-${candidate.id}`}
                      name="lot"
                      defaultValue={candidate.lot}
                      disabled={busy}
                      aria-busy={busy || undefined}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`url-${candidate.id}`}>URL</Label>
                    <Input
                      id={`url-${candidate.id}`}
                      name="url"
                      defaultValue={candidate.url}
                      disabled={busy}
                      aria-busy={busy || undefined}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`price-${candidate.id}`}>Preço</Label>
                    <Input
                      id={`price-${candidate.id}`}
                      name="price"
                      type="number"
                      step="0.01"
                      defaultValue={candidate.price}
                      disabled={busy}
                      aria-busy={busy || undefined}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`nota-${candidate.id}`}>Nota</Label>
                    <Input
                      id={`nota-${candidate.id}`}
                      name="nota"
                      type="number"
                      min={1}
                      max={5}
                      disabled={busy}
                      aria-busy={busy || undefined}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={busy}
                    aria-busy={busy || undefined}
                  >
                    Confirmar
                  </Button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(
                      candidate.id,
                      actionRejectCandidate,
                      new FormData(e.currentTarget),
                      TOAST.rejected,
                    );
                  }}
                >
                  <input
                    type="hidden"
                    name="candidateId"
                    value={candidate.id}
                  />
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={busy}
                    aria-busy={busy || undefined}
                  >
                    Rejeitar
                  </Button>
                </form>
              </Card>
            );
          })
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Órfãos</h2>
        {orphans.length === 0 ? (
          <p>Nenhum órfão</p>
        ) : (
          orphans.map((orphan) => {
            const busy = pendingIds.has(orphan.id);
            return (
              <Card key={orphan.id} className="gap-4 p-4">
                <p className="text-sm">
                  {orphan.sender}: {orphan.text}
                </p>
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(
                      orphan.id,
                      actionLinkOrphan,
                      new FormData(e.currentTarget),
                      TOAST.linked,
                    );
                  }}
                >
                  <input type="hidden" name="messageId" value={orphan.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor={`party-${orphan.id}`}>Festa</Label>
                    <select
                      id={`party-${orphan.id}`}
                      name="partyId"
                      defaultValue={orphan.defaultPartyId}
                      required
                      disabled={busy}
                      aria-busy={busy || undefined}
                      className={selectClassName}
                    >
                      <option value="" disabled>
                        Selecionar festa
                      </option>
                      {upcoming.map((party) => (
                        <option key={party.id} value={party.id}>
                          {party.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="submit"
                    disabled={busy}
                    aria-busy={busy || undefined}
                  >
                    Vincular
                  </Button>
                </form>
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
}
