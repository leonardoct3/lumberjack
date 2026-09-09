"use client";

import type { JSX } from "react";
import { useMemo, useState } from "react";
import { Headphones, Plus, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { searchGroups, shortWaId } from "@/lib/group-search";

type PickerGroup = { id: string; name: string; waId: string };

export function GroupPicker(props: {
  groups: PickerGroup[];
  duplicates: Set<string>;
  isBusy: (id: string) => boolean;
  onSelect: (group: PickerGroup) => void;
}): JSX.Element {
  const { groups, duplicates, isBusy, onSelect } = props;
  const [query, setQuery] = useState("");
  const { matches, total } = useMemo(
    () => searchGroups(groups, query),
    [groups, query],
  );

  function hint(): string {
    if (query.trim().length === 0) {
      return groups.length === 1
        ? "1 grupo fora do monitor."
        : `${groups.length} grupos fora do monitor.`;
    }
    if (total === 0) return "Nenhum grupo disponível com esse nome.";
    const found = total === 1 ? "1 grupo encontrado" : `${total} grupos encontrados`;
    return total > matches.length
      ? `${found} · mostrando os ${matches.length} primeiros`
      : found;
  }

  return (
    <Card className="gap-4 p-4 md:p-5">
      <div>
        <label
          htmlFor="group-search"
          className="mb-2.5 flex items-center gap-2 text-xs font-medium text-muted-foreground"
        >
          <Search className="size-3.5" aria-hidden="true" />
          Adicionar grupo ao monitor
        </label>
        <Input
          id="group-search"
          type="search"
          autoComplete="off"
          placeholder="Busque pelo nome, ex: baile carnaval"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const first = matches[0];
            if (first && !isBusy(first.id)) onSelect(first);
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {hint()}
        </p>
      </div>

      {matches.length > 0 ? (
        <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70 bg-background/35">
          {matches.map((group) => {
            const busy = isBusy(group.id);
            return (
              <li key={group.id}>
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => onSelect(group)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background/40 text-muted-foreground">
                    <Headphones className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {group.name}
                  </span>
                  {duplicates.has(group.name) ? (
                    <span
                      className="shrink-0 font-mono text-[10px] text-muted-foreground"
                      title="Vários grupos usam este nome; os últimos dígitos do ID diferenciam"
                    >
                      {`#${shortWaId(group.waId)}`}
                    </span>
                  ) : null}
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-primary">
                    <Plus className="size-3.5" aria-hidden="true" />
                    Ouvir
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
