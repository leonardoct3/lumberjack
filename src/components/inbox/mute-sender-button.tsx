"use client";

import type { JSX } from "react";
import { BellOff } from "lucide-react";
import { actionSetSenderMuted } from "@/app/actions/setup";
import { Button } from "@/components/ui/button";
import { TOAST } from "@/lib/toast-copy";

/**
 * Muting is decided here, looking at the noise, not in a settings list of a
 * hundred contacts sorted by name. One click and the weekly agenda stops
 * opening candidates; the messages stay in the history either way.
 */
export function MuteSenderButton(props: {
  senderId: string;
  senderName: string;
  busy: boolean;
  submit: (
    id: string,
    action: (data: FormData) => Promise<void>,
    data: FormData,
    success: string,
  ) => void;
  /**
   * Icon only, for the drawer: the label is a third of that column, and the
   * two answers about the message itself come first.
   */
  compact?: boolean;
}): JSX.Element {
  const { senderId, senderName, busy, submit, compact } = props;

  function mute() {
    const fd = new FormData();
    fd.set("id", senderId);
    fd.set("muted", "1");
    submit(senderId, actionSetSenderMuted, fd, TOAST.senderMuted);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      aria-busy={busy || undefined}
      title={`Parar de abrir candidato e sinal de ${senderName}. O histórico fica, e dá para reativar no Setup.`}
      onClick={mute}
    >
      <BellOff />
      <span className={compact ? "sr-only" : undefined}>Silenciar remetente</span>
    </Button>
  );
}
