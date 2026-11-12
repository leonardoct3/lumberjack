"use client";

import type { JSX } from "react";
import { ArrowRight, Link2, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { ReachBadge } from "@/components/ui/reach-badge";
import {
  highlight,
  type Cluster,
  type Span,
  type Suggestion,
} from "@/features/inbox/suggestions";
import type { InboxOrphan } from "./orphan-list";

/** What the resolver thinks of a message the operator reviews on its own. */
export function SuggestionNote(props: {
  suggestion: Suggestion;
  disabled: boolean;
  onCreate: (name: string) => void;
}): JSX.Element {
  const { suggestion, disabled, onCreate } = props;
  let title: string;
  let detail: string | null = null;
  if (suggestion.kind === "link") {
    title = `IA sugere ${suggestion.party.name}`;
  } else if (suggestion.kind === "new_event") {
    title = suggestion.name
      ? `IA acha que é uma festa nova: ${suggestion.name}`
      : "IA acha que é uma festa nova";
  } else {
    const names = suggestion.options.map((o) => o.name);
    title =
      names.length > 0 ? `IA em dúvida entre ${names.join(", ")}` : "IA em dúvida";
    detail = suggestion.reasons[0] ?? null;
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-foreground">{title}</p>
        {detail ? <p className="line-clamp-2 text-muted-foreground">{detail}</p> : null}
      </div>
      {suggestion.kind === "new_event" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0"
          disabled={disabled}
          onClick={() => onCreate(suggestion.name)}
        >
          Criar
        </Button>
      ) : null}
    </div>
  );
}

/** The message with the words the resolver relied on marked. */
export function EvidenceText(props: { text: string; spans: Span[] }): JSX.Element {
  return (
    <p className="text-sm leading-6 text-foreground">
      {highlight(props.text, props.spans).map((piece, i) =>
        piece.mark ? (
          <mark key={i} className="rounded bg-primary/15 px-0.5 text-foreground">
            {piece.text}
          </mark>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * One card per festa the resolver would link messages to. Linking is still the
 * operator's click; a member taken out drops to the list below for its own review.
 */
export function SuggestionClusters(props: {
  clusters: Cluster[];
  orphans: Map<string, InboxOrphan>;
  pendingIds: Set<string>;
  onLink: (cluster: Cluster) => void;
  onTakeOut: (messageId: string) => void;
}): JSX.Element | null {
  const { clusters, orphans, pendingIds, onLink, onTakeOut } = props;
  if (clusters.length === 0) return null;
  const total = clusters.reduce((sum, c) => sum + c.memberIds.length, 0);

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Sugestões"
        count={total}
        description="A IA propõe a festa de cada grupo. Confira os trechos marcados, tire o que não for dela e vincule de uma vez."
      />
      {clusters.map((cluster) => {
        const key = `cluster-${cluster.party.id}`;
        const busy = pendingIds.has(key);
        const n = cluster.memberIds.length;
        return (
          <Card key={cluster.party.id} className="gap-3 border-primary/25 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                {cluster.party.name}
              </p>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                {n} {n === 1 ? "mensagem" : "mensagens"}
              </span>
            </div>

            <ul className="space-y-2.5">
              {cluster.memberIds.map((id) => {
                const orphan = orphans.get(id);
                if (!orphan?.suggestion) return null;
                return (
                  <li key={id} className="space-y-1.5 border-t border-border/60 pt-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">{orphan.sender}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                        {orphan.sentAtLabel}
                      </span>
                      <span className="ml-auto flex items-center gap-1">
                        <ReachBadge groups={orphan.groupReach} />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title="Não é desta festa: revisar à parte"
                          aria-label={`Tirar a mensagem de ${orphan.sender} do grupo`}
                          disabled={busy}
                          onClick={() => onTakeOut(id)}
                        >
                          <X />
                        </Button>
                      </span>
                    </div>
                    <EvidenceText text={orphan.text} spans={orphan.suggestion.spans} />
                  </li>
                );
              })}
            </ul>

            <Button
              type="button"
              className="w-full"
              disabled={busy || n === 0}
              aria-busy={busy || undefined}
              onClick={() => onLink(cluster)}
            >
              <Link2 /> Vincular {n} a {cluster.party.name} <ArrowRight />
            </Button>
          </Card>
        );
      })}
    </section>
  );
}
