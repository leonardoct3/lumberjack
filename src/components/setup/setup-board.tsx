"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  CircleAlert,
  Headphones,
  LogOut,
  Pause,
  QrCode,
  Radio,
  Settings2,
  UsersRound,
  Wifi,
} from "lucide-react";
import { actionLogout } from "@/app/actions/auth";
import { actionSetGroupListen, actionSetSenderMuted } from "@/app/actions/setup";
import { GroupPicker } from "@/components/setup/group-picker";
import { SenderList, type SetupSender } from "@/components/setup/sender-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import type { SessionGuidance } from "@/components/ui/session-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { duplicateNames, shortWaId } from "@/lib/group-search";
import { runAction } from "@/lib/run-action";
import { TOAST } from "@/lib/toast-copy";


export function SetupBoard(props: {
  connected: boolean;
  banner: SessionGuidance | null;
  qrDataUrl: string | null;
  canLogout: boolean;
  listening: { id: string; name: string; waId: string }[];
  available: { id: string; name: string; waId: string }[];
  windowDays: number;
  senders: SetupSender[];
}): JSX.Element {
  const {
    connected,
    banner,
    qrDataUrl,
    canLogout,
    listening,
    available,
    windowDays,
    senders,
  } = props;
  const duplicates = useMemo(
    () => duplicateNames([...listening, ...available]),
    [listening, available],
  );
  const router = useRouter();
  const [, start] = useTransition();
  const [pendingIds, setPendingIds] = useState(() => new Set<string>());
  const refresh = () => router.refresh();

  // Baileys rotates the QR about every 20s; keep the board in sync while pairing.
  useEffect(() => {
    if (!qrDataUrl) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [qrDataUrl, router]);

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

  const totalGroups = listening.length + available.length;
  // "Classificados" counted a role nobody needed to declare; what matters is
  // how many contacts are actually producing something to triage.
  const active = senders.filter((sender) => sender.messages > 0).length;

  function pause(group: { id: string; name: string }) {
    const fd = new FormData();
    fd.set("id", group.id);
    fd.set("listen", "0");
    submit(`group-${group.id}`, actionSetGroupListen, fd, TOAST.paused);
  }
  const StatusIcon =
    banner?.kind === "qr"
      ? QrCode
      : banner?.tone === "danger"
        ? CircleAlert
        : Settings2;
  const showSetupGuidance =
    banner?.visibility === "setup" &&
    (banner.kind !== "qr" || qrDataUrl == null);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Configuração"
        title="Central de conexão"
        description="Controle o que o monitor escuta e como cada remetente participa da classificação."
        icon={Settings2}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {connected ? (
              <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/8 px-3.5 py-2.5 text-xs font-semibold text-primary">
                <Wifi className="size-4" aria-hidden="true" />
                WhatsApp conectado
              </div>
            ) : null}
            {canLogout ? (
              <form action={actionLogout}>
                <Button type="submit" variant="ghost" size="sm">
                  <LogOut /> Sair
                </Button>
              </form>
            ) : null}
          </div>
        }
      />

      {showSetupGuidance ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/8 px-4 py-3.5 text-primary"
        >
          <StatusIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{banner.title}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {banner.step}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius)] border border-border/80 bg-card">
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Grupos</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">{String(totalGroups).padStart(2, "0")}</p>
        </div>
        <div className="border-x border-border/80 p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Ouvindo</p>
          <p className="mt-2 font-mono text-xl font-semibold text-primary tabular-nums md:text-2xl">{String(listening.length).padStart(2, "0")}</p>
        </div>
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">Remetentes ativos</p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">{String(active).padStart(2, "0")}</p>
        </div>
      </div>

      {qrDataUrl ? (
        <Card className="flex flex-col items-center gap-5 p-6 md:flex-row md:items-start md:gap-8">
          <div className="rounded-xl border border-border bg-white p-3">
            <img
              src={qrDataUrl}
              alt="QR Code do WhatsApp para emparelhar o monitor"
              width={280}
              height={280}
              className="size-[220px] md:size-[280px]"
            />
          </div>
          <div className="max-w-md space-y-3 text-center md:text-left">
            <div className="flex items-center justify-center gap-2 text-primary md:justify-start">
              <QrCode className="size-4" aria-hidden="true" />
              <p className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase">
                Emparelhar WhatsApp
              </p>
            </div>
            <h2 className="text-xl font-semibold tracking-[-0.03em]">
              Escaneie o código no celular
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              No WhatsApp: Aparelhos conectados → Conectar aparelho. O código
              renova sozinho a cada poucos segundos.
            </p>
          </div>
        </Card>
      ) : null}

      <section className="space-y-4">
        <SectionHeader
          title="Grupos monitorados"
          count={listening.length}
          description="A lista mostra apenas o que o monitor escuta. Use a busca para incluir outros grupos."
        />

        {totalGroups === 0 ? (
          <EmptyState
            title="Nenhum grupo"
            description="Os grupos aparecem após a primeira sincronização do WhatsApp."
            icon={UsersRound}
            compact
          />
        ) : (
          <>
            <GroupPicker
              groups={available}
              duplicates={duplicates}
              isBusy={(id) => pendingIds.has(`group-${id}`)}
              onSelect={(group) => {
                const fd = new FormData();
                fd.set("id", group.id);
                fd.set("listen", "1");
                submit(`group-${group.id}`, actionSetGroupListen, fd, TOAST.listening);
              }}
            />

            {listening.length === 0 ? (
              <EmptyState
                title="Nenhum grupo no monitor"
                description="Busque acima para escolher os grupos de revenda e promoção que o Lumberjack deve escutar."
                icon={Headphones}
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
                      {listening.map((group) => {
                        const busy = pendingIds.has(`group-${group.id}`);
                        return (
                          <TableRow key={group.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <span className="grid size-9 place-items-center rounded-xl border border-border bg-background/40 text-muted-foreground">
                                  <Headphones className="size-4" />
                                </span>
                                <span className="font-semibold">{group.name}</span>
                                {duplicates.has(group.name) ? (
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {`#${shortWaId(group.waId)}`}
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="border-primary/20 bg-primary/8 text-primary">
                                <span className="size-1.5 rounded-full bg-primary" />
                                Ouvindo
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                aria-busy={busy || undefined}
                                onClick={() => pause(group)}
                              >
                                <Pause /> Pausar
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>

                <ul className="grid gap-3 md:hidden">
                  {listening.map((group) => {
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
                                <span className="size-1.5 rounded-full bg-primary" />
                                Recebendo mensagens
                                {duplicates.has(group.name) ? (
                                  <span className="font-mono text-[10px]">
                                    {`#${shortWaId(group.waId)}`}
                                  </span>
                                ) : null}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              aria-busy={busy || undefined}
                              onClick={() => pause(group)}
                            >
                              <Pause /> Pausar
                            </Button>
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <SenderList
        senders={senders}
        windowDays={windowDays}
        isBusy={(id) => pendingIds.has(`sender-${id}`)}
        onToggleMute={(sender) => {
          const fd = new FormData();
          fd.set("id", sender.id);
          fd.set("muted", sender.muted ? "0" : "1");
          submit(
            `sender-${sender.id}`,
            actionSetSenderMuted,
            fd,
            sender.muted ? TOAST.senderUnmuted : TOAST.senderMuted,
          );
        }}
      />

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
        <Radio className="mt-0.5 size-3.5 shrink-0 text-primary" />
        Alterações são aplicadas ao monitor em tempo real e não interrompem a sessão atual.
      </div>
    </div>
  );
}
