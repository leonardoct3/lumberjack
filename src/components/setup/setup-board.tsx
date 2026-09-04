"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CircleAlert,
  Headphones,
  Pause,
  Play,
  QrCode,
  Radio,
  Save,
  Settings2,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
  Wifi,
} from "lucide-react";
import { actionSetGroupListen, actionSetSenderRole } from "@/app/actions/setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
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
  "h-10 w-full max-w-52 rounded-[10px] border border-input bg-background/55 px-3.5 text-sm outline-none transition-colors hover:border-muted-foreground/45 focus:border-ring focus:ring-3 focus:ring-ring/12";

const ROLE_LABEL = {
  admin: "Administrador",
  pista: "Pista",
  unknown: "Não classificado",
} as const;

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

  const listening = groups.filter((group) => group.listen).length;
  const classified = senders.filter((sender) => sender.role !== "unknown").length;
  const statusTone = banner?.tone === "danger" ? "danger" : "accent";
  const StatusIcon = connected ? Wifi : banner?.tone === "danger" ? CircleAlert : QrCode;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Configuração"
        title="Central de conexão"
        description="Controle o que o monitor escuta e como cada remetente participa da classificação."
        icon={Settings2}
        actions={
          <div
            className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold ${
              connected
                ? "border-primary/20 bg-primary/8 text-primary"
                : statusTone === "danger"
                  ? "border-destructive/25 bg-destructive/8 text-destructive"
                  : "border-primary/20 bg-primary/8 text-primary"
            }`}
          >
            <StatusIcon className="size-4" aria-hidden="true" />
            {connected ? "WhatsApp conectado" : banner?.text}
          </div>
        }
      />

      <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius)] border border-border/80 bg-card">
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Grupos</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">{String(groups.length).padStart(2, "0")}</p>
        </div>
        <div className="border-x border-border/80 p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Ouvindo</p>
          <p className="mt-2 font-mono text-xl font-semibold text-primary tabular-nums md:text-2xl">{String(listening).padStart(2, "0")}</p>
        </div>
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Classificados</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">{String(classified).padStart(2, "0")}</p>
        </div>
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Grupos monitorados"
          count={groups.length}
          description="Pause fontes ruidosas sem desconectar a sessão."
        />
        {groups.length === 0 ? (
          <EmptyState
            title="Nenhum grupo"
            description="Os grupos aparecem após a primeira sincronização do WhatsApp."
            icon={UsersRound}
            compact
          />
        ) : (
          <>
            <Card className="hidden overflow-hidden p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Grupo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Controle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group) => {
                    const busy = pendingIds.has(`group-${group.id}`);
                    return (
                      <TableRow key={group.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 place-items-center rounded-xl border border-border bg-background/40 text-muted-foreground">
                              <Headphones className="size-4" />
                            </span>
                            <span className="font-semibold">{group.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={group.listen ? "border-primary/20 bg-primary/8 text-primary" : undefined}>
                            <span className={`size-1.5 rounded-full ${group.listen ? "bg-primary" : "bg-muted-foreground/45"}`} />
                            {group.listen ? "Ouvindo" : "Pausado"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
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
                              submit(`group-${group.id}`, actionSetGroupListen, fd, group.listen ? TOAST.paused : TOAST.listening);
                            }}
                          >
                            {group.listen ? <Pause /> : <Play />}
                            {group.listen ? "Pausar" : "Ouvir"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            <ul className="grid gap-3 md:hidden">
              {groups.map((group) => {
                const busy = pendingIds.has(`group-${group.id}`);
                return (
                  <li key={group.id}>
                    <Card className="gap-4 p-4">
                      <div className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-xl border border-border bg-background/40 text-muted-foreground">
                          <Headphones className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{group.name}</p>
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className={`size-1.5 rounded-full ${group.listen ? "bg-primary" : "bg-muted-foreground/45"}`} />
                            {group.listen ? "Recebendo mensagens" : "Monitoramento pausado"}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-busy={busy || undefined}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("id", group.id);
                            fd.set("listen", group.listen ? "0" : "1");
                            submit(`group-${group.id}`, actionSetGroupListen, fd, group.listen ? TOAST.paused : TOAST.listening);
                          }}
                        >
                          {group.listen ? <Pause /> : <Play />}
                          {group.listen ? "Pausar" : "Ouvir"}
                        </Button>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Papéis dos remetentes"
          count={senders.length}
          description="O papel ajuda o classificador a interpretar cada mensagem."
        />
        {senders.length === 0 ? (
          <EmptyState
            title="Nenhum remetente"
            description="Novos contatos aparecem quando mensagens forem sincronizadas."
            icon={UserRoundCog}
            compact
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Remetente</TableHead>
                    <TableHead>Papel atual</TableHead>
                    <TableHead className="text-right">Alterar papel</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {senders.map((sender) => {
                    const busy = pendingIds.has(`sender-${sender.id}`);
                    return (
                      <TableRow key={sender.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 place-items-center rounded-xl border border-border bg-background/40 text-muted-foreground">
                              {sender.role === "admin" ? <ShieldCheck className="size-4" /> : <UserRoundCog className="size-4" />}
                            </span>
                            <span className="font-semibold">{sender.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{ROLE_LABEL[sender.role]}</Badge>
                        </TableCell>
                        <TableCell>
                          <form
                            className="flex items-center justify-end gap-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              submit(`sender-${sender.id}`, actionSetSenderRole, new FormData(event.currentTarget), TOAST.saved);
                            }}
                          >
                            <input type="hidden" name="id" value={sender.id} />
                            <select name="role" defaultValue={sender.role} className={selectClassName} disabled={busy} aria-busy={busy || undefined}>
                              <option value="admin">Administrador</option>
                              <option value="pista">Pista</option>
                              <option value="unknown">Não classificado</option>
                            </select>
                            <Button type="submit" variant="outline" size="sm" disabled={busy} aria-busy={busy || undefined}>
                              <Save /> Salvar
                            </Button>
                          </form>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border/70 md:hidden">
              {senders.map((sender) => {
                const busy = pendingIds.has(`sender-${sender.id}`);
                return (
                  <li key={sender.id} className="p-4">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-xl border border-border bg-background/40 text-muted-foreground">
                        <UserRoundCog className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{sender.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_LABEL[sender.role]}</p>
                      </div>
                    </div>
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submit(`sender-${sender.id}`, actionSetSenderRole, new FormData(event.currentTarget), TOAST.saved);
                      }}
                    >
                      <input type="hidden" name="id" value={sender.id} />
                      <select name="role" defaultValue={sender.role} className={`${selectClassName} max-w-none flex-1`} disabled={busy} aria-busy={busy || undefined}>
                        <option value="admin">Administrador</option>
                        <option value="pista">Pista</option>
                        <option value="unknown">Não classificado</option>
                      </select>
                      <Button type="submit" variant="outline" size="sm" disabled={busy} aria-busy={busy || undefined}>
                        <Save /> Salvar
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
        <Radio className="mt-0.5 size-3.5 shrink-0 text-primary" />
        Alterações são aplicadas ao monitor em tempo real e não interrompem a sessão atual.
      </div>
    </div>
  );
}
