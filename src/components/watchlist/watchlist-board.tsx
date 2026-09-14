"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  ExternalLink,
  Flame,
  ListOrdered,
  LogOut,
  TicketCheck,
} from "lucide-react";
import {
  actionCloseLot,
  actionMoveWatchlist,
  actionRemoveFromWatchlist,
} from "@/app/actions/watchlist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { formatEventWhen } from "@/lib/datetime";
import { runAction } from "@/lib/run-action";
import { TOAST } from "@/lib/toast-copy";

// Header and rows must share one template, or the `auto` action track sizes
// differently in each and every column below drifts out of alignment.
const ROW_GRID =
  "grid grid-cols-[56px_minmax(200px,1.8fr)_minmax(150px,1fr)_minmax(130px,.8fr)_64px_240px] items-center px-4";

export type WatchlistItem = {
  id: string;
  name: string;
  eventAt: string;
  countdown: string;
  lotLabels: string;
  lotUrl: string | null;
  heat: number | null;
  previousEdition: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  openLotIds: string[];
};

function HeatValue({ heat }: { heat: number | null }) {
  if (heat == null) {
    return <span className="font-mono text-sm text-muted-foreground">—</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-primary tabular-nums">
      <Flame className="size-3.5 fill-primary/20" aria-hidden="true" />
      {heat}
    </span>
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

  /** `compact` collapses the secondary actions to icons so the table row stays readable. */
  function actions(item: WatchlistItem, compact: boolean) {
    const busy = pendingIds.has(item.id);
    const secondary = (label: string) =>
      compact
        ? { size: "icon-sm" as const, title: label, "aria-label": label }
        : { size: "sm" as const };

    return (
      <div
        className={
          compact
            ? "flex items-center gap-1"
            : "flex flex-wrap items-center gap-1"
        }
      >
        {item.canMoveUp ? (
          <Button
            type="button"
            variant="ghost"
            {...secondary("Subir")}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              const fd = new FormData();
              fd.set("partyId", item.id);
              fd.set("direction", "up");
              submit(item.id, actionMoveWatchlist, fd, TOAST.up);
            }}
          >
            <ArrowUp />
            {compact ? null : "Subir"}
          </Button>
        ) : null}
        {item.canMoveDown ? (
          <Button
            type="button"
            variant="ghost"
            {...secondary("Descer")}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              const fd = new FormData();
              fd.set("partyId", item.id);
              fd.set("direction", "down");
              submit(item.id, actionMoveWatchlist, fd, TOAST.down);
            }}
          >
            <ArrowDown />
            {compact ? null : "Descer"}
          </Button>
        ) : null}
        {/* With two or more open lots there is no telling which icon closes
            which, so that decision belongs on the party page. */}
        {item.openLotIds.length === 1 ? (
          <Button
            type="button"
            variant="ghost"
            {...secondary("Fechar lote")}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              const fd = new FormData();
              fd.set("lotId", item.openLotIds[0]);
              submit(item.id, actionCloseLot, fd, TOAST.lotClosed);
            }}
          >
            <TicketCheck />
            {compact ? null : "Fechar lote"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          {...secondary("Sair da fila")}
          disabled={busy}
          aria-busy={busy || undefined}
          className="hover:text-destructive"
          onClick={() => {
            const fd = new FormData();
            fd.set("partyId", item.id);
            submit(item.id, actionRemoveFromWatchlist, fd, TOAST.leftQueue);
          }}
        >
          <LogOut />
          {compact ? null : "Sair"}
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/parties/${item.id}`}>
            Detalhe
            <ArrowRight />
          </Link>
        </Button>
      </div>
    );
  }

  const scored = items.filter((item) => item.heat != null);
  const hottest = scored.reduce<WatchlistItem | null>((best, item) => {
    if (!best || (item.heat ?? -Infinity) > (best.heat ?? -Infinity)) return item;
    return best;
  }, null);
  const openLots = items.reduce((total, item) => total + item.openLotIds.length, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Operação"
        title="Fila de compra"
        description="Priorize as próximas compras e acompanhe os sinais que podem mudar sua decisão."
        icon={ListOrdered}
        actions={
          <Button asChild variant="outline">
            <Link href="/heat">
              Ver calor
              <Flame />
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius)] border border-border/80 bg-card">
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            Na fila
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">
            {String(items.length).padStart(2, "0")}
          </p>
        </div>
        <div className="border-x border-border/80 p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            Lotes abertos
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">
            {String(openLots).padStart(2, "0")}
          </p>
        </div>
        <div className="min-w-0 p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            Mais quente
          </p>
          <p className="mt-2 truncate text-sm font-semibold text-primary md:text-base">
            {hottest?.name ?? "—"}
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Prioridade atual"
          count={items.length}
          description="A ordem define o foco da operação."
        />

        {items.length === 0 ? (
          <EmptyState
            title="Nenhuma festa na fila"
            description="Confirme uma festa na Inbox ou avalie os sinais de calor para começar."
            icon={ListOrdered}
            action={
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/inbox">Abrir Inbox</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/heat">Ver calor</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <>
            <Card className="hidden gap-0 overflow-hidden p-0 xl:block">
              <div
                className={`${ROW_GRID} border-b border-border/80 bg-muted/35 py-3 font-mono text-[9px] font-semibold tracking-[0.09em] text-muted-foreground uppercase`}
              >
                <span>Rank</span>
                <span>Festa</span>
                <span>Quando</span>
                <span>Lote</span>
                <span>Calor</span>
                <span className="text-right">Ações</span>
              </div>
              <div>
                {items.map((item, index) => (
                  <div
                    key={item.id}
                    className={`${ROW_GRID} group border-b border-border/65 py-3 transition-colors last:border-0 hover:bg-muted/35`}
                  >
                    <span className="font-mono text-lg font-medium text-muted-foreground/70 tabular-nums group-first:text-primary">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 pr-3">
                      <Link
                        href={`/parties/${item.id}`}
                        className="block truncate text-sm font-semibold text-foreground no-underline hover:text-primary"
                      >
                        {item.name}
                      </Link>
                      {item.previousEdition ? (
                        <Badge className="mt-1.5" variant="outline">
                          edição anterior
                        </Badge>
                      ) : null}
                    </div>
                    <div className="min-w-0 pr-3 text-xs">
                      <span className="flex items-center gap-2">
                        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{formatEventWhen(item.eventAt)}</span>
                      </span>
                      <span className="mt-1 block pl-[22px] text-[11px] text-muted-foreground">
                        {item.countdown}
                      </span>
                    </div>
                    <div className="min-w-0 pr-3 text-xs">
                      <span className="block truncate">{item.lotLabels || "—"}</span>
                      {item.lotUrl ? (
                        <a
                          href={item.lotUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground no-underline hover:text-primary"
                        >
                          Abrir venda <ExternalLink className="size-3" />
                        </a>
                      ) : null}
                    </div>
                    <HeatValue heat={item.heat} />
                    <div className="flex justify-end">{actions(item, true)}</div>
                  </div>
                ))}
              </div>
            </Card>

            <ol className="space-y-3 xl:hidden">
              {items.map((item, index) => (
                <li key={item.id}>
                  <Card className="gap-4 overflow-hidden p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-background/50 font-mono text-sm font-semibold text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <Link
                            href={`/parties/${item.id}`}
                            className="truncate font-semibold text-foreground no-underline"
                          >
                            {item.name}
                          </Link>
                          <HeatValue heat={item.heat} />
                        </div>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <CalendarDays className="size-3.5 shrink-0" />
                          {formatEventWhen(item.eventAt)}
                          <span className="text-muted-foreground/70">· {item.countdown}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/35 px-3 py-2.5 text-xs">
                      <span className="min-w-0 truncate">
                        {item.lotLabels || "Sem lote aberto"}
                      </span>
                      {item.lotUrl ? (
                        <a
                          href={item.lotUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Abrir página de venda"
                          className="shrink-0 text-muted-foreground hover:text-primary"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      ) : null}
                    </div>
                    {item.previousEdition ? (
                      <Badge variant="outline">edição anterior</Badge>
                    ) : null}
                    <div className="-mx-1 flex flex-wrap border-t border-border/60 pt-3">
                      {actions(item, false)}
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
