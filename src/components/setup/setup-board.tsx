"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  actionSetGroupListen,
  actionSetSenderRole,
} from "@/app/actions/setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { runAction } from "@/lib/run-action";
import { TOAST } from "@/lib/toast-copy";

const selectClassName =
  "border-input bg-background h-9 w-full max-w-[10rem] rounded-md border px-3 text-sm shadow-xs";

export function SetupBoard(props: {
  connected: boolean;
  banner: { tone: "accent" | "danger"; text: string } | null;
  groups: { id: string; name: string; listen: boolean }[];
  senders: { id: string; name: string; role: "admin" | "pista" | "unknown" }[];
}): JSX.Element {
  const { connected, banner, groups, senders } = props;
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

  const stripClass =
    banner?.tone === "danger"
      ? "border-destructive text-destructive"
      : "border-primary text-primary";

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Setup</h1>
        {connected ? (
          <Badge variant="outline">Conectado</Badge>
        ) : banner ? (
          <div
            className={`rounded-[10px] border px-3 py-2 text-sm ${stripClass}`}
          >
            {banner.text}
          </div>
        ) : null}
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Grupos</h2>
        {groups.length === 0 ? (
          <p>Nenhum grupo</p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group) => {
                    const busy = pendingIds.has(`group-${group.id}`);
                    return (
                      <TableRow key={group.id}>
                        <TableCell>{group.name}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-muted-foreground"
                          >
                            {group.listen ? "Ouvindo" : "Pausado"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-busy={busy || undefined}
                            onClick={() => {
                              const fd = new FormData();
                              fd.set("id", group.id);
                              fd.set("listen", group.listen ? "0" : "1");
                              submit(
                                `group-${group.id}`,
                                actionSetGroupListen,
                                fd,
                                group.listen ? TOAST.paused : TOAST.listening,
                              );
                            }}
                          >
                            {group.listen ? "Pausar" : "Ouvir"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <ul className="space-y-3 md:hidden">
              {groups.map((group) => {
                const busy = pendingIds.has(`group-${group.id}`);
                return (
                  <li key={group.id}>
                    <Card className="gap-3 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{group.name}</span>
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                        >
                          {group.listen ? "Ouvindo" : "Pausado"}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-busy={busy || undefined}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("id", group.id);
                          fd.set("listen", group.listen ? "0" : "1");
                          submit(
                            `group-${group.id}`,
                            actionSetGroupListen,
                            fd,
                            group.listen ? TOAST.paused : TOAST.listening,
                          );
                        }}
                      >
                        {group.listen ? "Pausar" : "Ouvir"}
                      </Button>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Remetentes</h2>
        {senders.length === 0 ? (
          <p>Nenhum remetente</p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {senders.map((sender) => {
                    const busy = pendingIds.has(`sender-${sender.id}`);
                    return (
                      <TableRow key={sender.id}>
                        <TableCell>{sender.name}</TableCell>
                        <TableCell colSpan={2}>
                          <form
                            className="flex flex-wrap items-center gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              submit(
                                `sender-${sender.id}`,
                                actionSetSenderRole,
                                new FormData(e.currentTarget),
                                TOAST.saved,
                              );
                            }}
                          >
                            <input type="hidden" name="id" value={sender.id} />
                            <select
                              name="role"
                              defaultValue={sender.role}
                              className={selectClassName}
                              disabled={busy}
                              aria-busy={busy || undefined}
                            >
                              <option value="admin">admin</option>
                              <option value="pista">pista</option>
                              <option value="unknown">unknown</option>
                            </select>
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              aria-busy={busy || undefined}
                            >
                              Salvar
                            </Button>
                          </form>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <ul className="space-y-3 md:hidden">
              {senders.map((sender) => {
                const busy = pendingIds.has(`sender-${sender.id}`);
                return (
                  <li key={sender.id}>
                    <Card className="gap-3 p-4">
                      <p className="font-medium">{sender.name}</p>
                      <form
                        className="flex flex-wrap items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submit(
                            `sender-${sender.id}`,
                            actionSetSenderRole,
                            new FormData(e.currentTarget),
                            TOAST.saved,
                          );
                        }}
                      >
                        <input type="hidden" name="id" value={sender.id} />
                        <select
                          name="role"
                          defaultValue={sender.role}
                          className={selectClassName}
                          disabled={busy}
                          aria-busy={busy || undefined}
                        >
                          <option value="admin">admin</option>
                          <option value="pista">pista</option>
                          <option value="unknown">unknown</option>
                        </select>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-busy={busy || undefined}
                        >
                          Salvar
                        </Button>
                      </form>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
