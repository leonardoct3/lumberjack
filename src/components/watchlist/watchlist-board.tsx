"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  actionCloseLot,
  actionMoveWatchlist,
  actionRemoveFromWatchlist,
} from "@/app/actions/watchlist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatWhen } from "@/lib/datetime";
import { runAction } from "@/lib/run-action";
import { TOAST } from "@/lib/toast-copy";

export type WatchlistItem = {
  id: string;
  name: string;
  eventAt: string;
  lotLabels: string;
  lotUrl: string | null;
  heat: number | null;
  previousEdition: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  openLotIds: string[];
};

function heatCell(heat: number | null) {
  if (heat == null) return "—";
  return (
    <span className="text-primary font-semibold tabular-nums">{heat}</span>
  );
}

export function WatchlistBoard({ items }: { items: WatchlistItem[] }) {
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

  function actions(item: WatchlistItem) {
    const busy = pendingIds.has(item.id);
    return (
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/parties/${item.id}`}>Detalhe</Link>
        </Button>
        {item.canMoveUp ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              const fd = new FormData();
              fd.set("partyId", item.id);
              fd.set("direction", "up");
              submit(item.id, actionMoveWatchlist, fd, TOAST.up);
            }}
          >
            Subir
          </Button>
        ) : null}
        {item.canMoveDown ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              const fd = new FormData();
              fd.set("partyId", item.id);
              fd.set("direction", "down");
              submit(item.id, actionMoveWatchlist, fd, TOAST.down);
            }}
          >
            Descer
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => {
            const fd = new FormData();
            fd.set("partyId", item.id);
            submit(item.id, actionRemoveFromWatchlist, fd, TOAST.leftQueue);
          }}
        >
          Sair da fila
        </Button>
        {item.openLotIds.map((lotId) => (
          <Button
            key={lotId}
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              const fd = new FormData();
              fd.set("lotId", lotId);
              submit(item.id, actionCloseLot, fd, TOAST.lotClosed);
            }}
          >
            Fechar lote
          </Button>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="gap-2 p-6">
        <p>Nenhuma festa na fila</p>
        <p className="text-muted-foreground text-sm">
          <Link href="/inbox">Inbox</Link> · <Link href="/heat">Calor</Link>
        </p>
      </Card>
    );
  }

  return (
    <>
      <div className="hidden space-y-0 md:block">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2 text-sm last:border-b-0"
          >
            <span className="text-muted-foreground w-6 shrink-0 tabular-nums">
              {index + 1}.
            </span>
            <strong className="min-w-[8rem] shrink-0">{item.name}</strong>
            <span className="text-muted-foreground shrink-0">
              {formatWhen(item.eventAt)}
            </span>
            <span className="min-w-[4rem] shrink-0">
              {item.lotLabels || "—"}
            </span>
            <span className="w-10 shrink-0">{heatCell(item.heat)}</span>
            {item.previousEdition ? (
              <Badge variant="outline">edição anterior</Badge>
            ) : null}
            <div className="ml-auto">{actions(item)}</div>
          </div>
        ))}
      </div>

      <ol className="space-y-3 md:hidden">
        {items.map((item, index) => (
          <li key={item.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-muted-foreground w-6 tabular-nums">
                  {index + 1}.
                </span>
                <strong>{item.name}</strong>
                {item.previousEdition ? (
                  <Badge variant="outline">edição anterior</Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-2 text-sm">
                Data {formatWhen(item.eventAt)}
              </p>
              <p className="text-sm">Lote {item.lotLabels || "—"}</p>
              <p className="text-sm">
                Link{" "}
                {item.lotUrl ? (
                  <a href={item.lotUrl} rel="noreferrer">
                    {item.lotUrl}
                  </a>
                ) : (
                  "—"
                )}
              </p>
              <p className="text-sm">Calor {heatCell(item.heat)}</p>
              <div className="mt-3">{actions(item)}</div>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
