"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  actionAddLot,
  actionCloseLot,
  actionEnqueueWatchlist,
  actionUnlinkSignal,
  actionUpdateParty,
} from "@/app/actions/party";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const PLATFORMS = [
  "sympla",
  "gandaya",
  "blacktag",
  "ingresse",
  "other",
  "unknown",
] as const;

const STATUS_LABEL: Record<"upcoming" | "past" | "cancelled", string> = {
  upcoming: "Futura",
  past: "Passada",
  cancelled: "Cancelada",
};

const selectClassName =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs";

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
  const [pending, start] = useTransition();
  const refresh = () => router.refresh();

  function submit(
    action: (fd: FormData) => Promise<void>,
    fd: FormData,
    success: string,
  ) {
    start(() => runAction(action, fd, success, refresh));
  }

  return (
    <div className="space-y-6">
      <Card className="gap-3 p-4">
        <h1 className="text-2xl font-semibold">{party.name}</h1>
        <p className="text-muted-foreground text-sm">
          Data {formatWhen(party.eventAt)}
        </p>
        <p className="text-sm">Status {STATUS_LABEL[party.status]}</p>
        {noBuy ? (
          <Alert className="border-destructive text-destructive">
            sem compra
          </Alert>
        ) : null}
        {watchlistEligible && !noBuy && upcoming ? (
          party.watchlistPosition == null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(
                  actionEnqueueWatchlist,
                  new FormData(e.currentTarget),
                  TOAST.enrolled,
                );
              }}
            >
              <input type="hidden" name="partyId" value={party.id} />
              <Button type="submit" disabled={pending}>
                Entrar na fila
              </Button>
            </form>
          ) : (
            <p className="text-sm">
              Na watchlist (posição {party.watchlistPosition})
            </p>
          )
        ) : null}
      </Card>

      <Card className="gap-4 p-4">
        <h2 className="text-lg font-semibold">Lotes</h2>
        {lots.length === 0 ? (
          <p>Nenhum lote</p>
        ) : (
          <>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Lote</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Aberto em</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lots.map((lot) => (
                  <TableRow key={lot.id}>
                    <TableCell>{lot.label || "—"}</TableCell>
                    <TableCell>
                      {lot.url ? (
                        <a href={lot.url} rel="noreferrer">
                          {lot.url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{lot.price || "—"}</TableCell>
                    <TableCell>{lot.platform}</TableCell>
                    <TableCell>{formatWhen(lot.openedAt)}</TableCell>
                    <TableCell>
                      {lot.closedAt == null ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("lotId", lot.id);
                            fd.set("partyId", party.id);
                            submit(actionCloseLot, fd, TOAST.lotClosed);
                          }}
                        >
                          Fechar lote
                        </Button>
                      ) : (
                        `Fechado ${formatWhen(lot.closedAt)}`
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <ul className="space-y-3 md:hidden">
              {lots.map((lot) => (
                <li key={lot.id}>
                  <Card className="gap-2 p-4">
                    <p className="font-medium">{lot.label || "—"}</p>
                    <p className="text-muted-foreground text-sm">
                      {lot.url ? (
                        <a href={lot.url} rel="noreferrer">
                          {lot.url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </p>
                    <p className="text-sm">
                      Preço {lot.price || "—"} · {lot.platform}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Aberto em {formatWhen(lot.openedAt)}
                    </p>
                    {lot.closedAt == null ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("lotId", lot.id);
                          fd.set("partyId", party.id);
                          submit(actionCloseLot, fd, TOAST.lotClosed);
                        }}
                      >
                        Fechar lote
                      </Button>
                    ) : (
                      <p className="text-sm">
                        Fechado {formatWhen(lot.closedAt)}
                      </p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}

        {!noBuy && upcoming ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(
                actionAddLot,
                new FormData(e.currentTarget),
                TOAST.lotOpened,
              );
            }}
          >
            <input type="hidden" name="partyId" value={party.id} />
            <div className="space-y-1.5">
              <Label htmlFor="lot-label">Lote</Label>
              <Input
                id="lot-label"
                name="label"
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lot-url">URL</Label>
              <Input id="lot-url" name="url" disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lot-price">Preço</Label>
              <Input
                id="lot-price"
                name="price"
                type="number"
                step="0.01"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lot-platform">Plataforma</Label>
              <select
                id="lot-platform"
                name="platform"
                defaultValue="unknown"
                disabled={pending}
                className={selectClassName}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={pending}>
              Abrir lote
            </Button>
          </form>
        ) : null}
      </Card>

      <Card className="gap-4 p-4">
        <h2 className="text-lg font-semibold">Editar</h2>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              actionUpdateParty,
              new FormData(e.currentTarget),
              TOAST.saved,
            );
          }}
        >
          <input type="hidden" name="partyId" value={party.id} />
          <div className="space-y-1.5">
            <Label htmlFor="party-name">Nome</Label>
            <Input
              id="party-name"
              name="name"
              defaultValue={party.name}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-eventAt">Data</Label>
            <Input
              id="party-eventAt"
              type="datetime-local"
              name="eventAt"
              defaultValue={toDatetimeLocal(party.eventAt)}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-status">Status</Label>
            <select
              id="party-status"
              name="status"
              defaultValue={party.status}
              disabled={pending}
              className={selectClassName}
            >
              <option value="upcoming">Futura</option>
              <option value="past">Passada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-aliases">Apelidos</Label>
            <Input
              id="party-aliases"
              name="aliases"
              defaultValue={party.aliases}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-nota">Nota</Label>
            <Input
              id="party-nota"
              name="nota"
              type="number"
              min={1}
              max={5}
              defaultValue={party.nota}
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-notes">Notas</Label>
            <Textarea
              id="party-notes"
              name="notes"
              defaultValue={party.notes}
              disabled={pending}
            />
          </div>
          <Button type="submit" disabled={pending}>
            Salvar
          </Button>
        </form>
      </Card>

      <Card className="gap-4 p-4">
        <h2 className="text-lg font-semibold">Linha do tempo</h2>
        {timeline.length === 0 ? (
          <p>Nenhuma mensagem</p>
        ) : (
          <ul className="space-y-4">
            {timeline.map((item) => (
              <li key={item.id} className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  {formatWhen(item.sentAt)} · {item.groupName} · {item.sender}
                </p>
                <p className="text-sm">{item.text}</p>
                {item.isCandidateSource ? (
                  <p className="text-sm">Origem do candidato</p>
                ) : null}
                {item.signals.map((signal) => (
                  <div key={signal.id} className="space-y-1">
                    <p className="text-sm">Sinal {signal.kind}</p>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("signalId", signal.id);
                        fd.set("partyId", party.id);
                        submit(actionUnlinkSignal, fd, TOAST.unlinked);
                      }}
                    >
                      Desvincular
                    </Button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
