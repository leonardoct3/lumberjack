"use client";

import type { JSX } from "react";
import { useState } from "react";
import { HandCoins, HelpCircle, Tag } from "lucide-react";
import { actionReclassifyMessage } from "@/app/actions/catalog";
import { MuteSenderButton } from "@/components/inbox/mute-sender-button";
import { Button } from "@/components/ui/button";
import { TOAST } from "@/lib/toast-copy";
import { useRowActions } from "./use-row-actions";

export type UnclassifiedMessage = {
  id: string;
  text: string;
  senderId: string;
  sender: string;
  sentAtLabel: string;
};

const PAGE_SIZE = 10;

/**
 * Messages that mention a ticket and that the rules refused to read. Without
 * this drawer they are invisible, which is exactly how the missing demand went
 * unnoticed: whatever shows up here is a phrasing the lexicon still owes.
 */
export function UnclassifiedList({
  messages,
}: {
  messages: UnclassifiedMessage[];
}): JSX.Element | null {
  const { pendingIds, submit } = useRowActions();
  const [visible, setVisible] = useState(PAGE_SIZE);
  if (messages.length === 0) return null;

  const shown = messages.slice(0, visible);
  const remaining = messages.length - shown.length;

  function classify(id: string, next: "pista_procura" | "pista_oferta") {
    const fd = new FormData();
    fd.set("messageId", id);
    fd.set("class", next);
    submit(id, actionReclassifyMessage, fd, TOAST.classified);
  }

  return (
    <details className="rounded-[var(--radius)] border border-border/70 bg-card/45 px-4 py-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground">
        <HelpCircle className="size-4" aria-hidden="true" />
        Não classificadas ({messages.length})
      </summary>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        Falam de ingresso, mas as regras não decidiram o lado. Marcar aqui manda a
        mensagem para a fila de órfãos acima.
      </p>
      <ul className="mt-3 space-y-2">
        {shown.map((message) => {
          const busy = pendingIds.has(message.id);
          return (
            <li
              key={message.id}
              className="flex flex-col gap-2 border-t border-border/60 pt-2.5"
            >
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">
                  {message.sender} · {message.sentAtLabel}
                </span>
                <span className="line-clamp-3 text-sm text-foreground">
                  {message.text}
                </span>
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => classify(message.id, "pista_procura")}
                >
                  <HandCoins /> É procura
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => classify(message.id, "pista_oferta")}
                >
                  <Tag /> É oferta
                </Button>
                {/* The third answer to "what is this": nothing, and never
                    again from this sender. */}
                <MuteSenderButton
                  senderId={message.senderId}
                  senderName={message.sender}
                  busy={busy || pendingIds.has(message.senderId)}
                  submit={submit}
                  compact
                />
              </span>
            </li>
          );
        })}
      </ul>
      {remaining > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 w-full"
          onClick={() => setVisible((prev) => prev + PAGE_SIZE)}
        >
          Mostrar mais {Math.min(PAGE_SIZE, remaining)} de {remaining}
        </Button>
      ) : null}
    </details>
  );
}
