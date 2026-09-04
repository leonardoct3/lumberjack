"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
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

export function WatchlistBoard({ items }: { items: WatchlistItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const refresh = () => router.refresh();

  function submit(
    action: (fd: FormData) => Promise<void>,
    fd: FormData,
    success: string,
  ) {
    start(() => runAction(action, fd, success, refresh));
  }

  if (items.length === 0) {
    return (
      <Card className="p-6">
        <p>Nenhuma festa na fila</p>
        <p className="text-muted-foreground mt-2 text-sm">
          <Link href="/inbox">Inbox</Link> · <Link href="/heat">Calor</Link>
        </p>
      </Card>
    );
  }

  return (
    <ol className="space-y-3">
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
            <p className="text-sm">
              Calor{" "}
              <span className="text-primary font-semibold tabular-nums">
                {item.heat ?? "—"}
              </span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/parties/${item.id}`}>Detalhe</Link>
              </Button>
              {item.canMoveUp ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("partyId", item.id);
                    fd.set("direction", "up");
                    submit(actionMoveWatchlist, fd, TOAST.up);
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
                  disabled={pending}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("partyId", item.id);
                    fd.set("direction", "down");
                    submit(actionMoveWatchlist, fd, TOAST.down);
                  }}
                >
                  Descer
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("partyId", item.id);
                  submit(actionRemoveFromWatchlist, fd, TOAST.leftQueue);
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
                  disabled={pending}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("lotId", lotId);
                    submit(actionCloseLot, fd, TOAST.lotClosed);
                  }}
                >
                  Fechar lote
                </Button>
              ))}
            </div>
          </Card>
        </li>
      ))}
    </ol>
  );
}
