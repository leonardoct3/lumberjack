"use client";

import type { JSX } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { findSimilarParties, type SimilarParty } from "@/domain/similar";

const MAX_SHOWN = 3;

/**
 * Cheap guard against a second party for the same festa: both the candidate
 * form and the orphan form create parties without ever looking at the catalog.
 */
export function SimilarWarning({
  name,
  parties,
}: {
  name: string;
  parties: SimilarParty[];
}): JSX.Element | null {
  const matches = findSimilarParties(name, parties).slice(0, MAX_SHOWN);
  if (matches.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs">
      <TriangleAlert className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="font-medium">Já existe no catálogo:</span>
      {matches.map((match) => (
        <Link
          key={match.id}
          href={`/parties/${match.id}`}
          className="font-medium text-primary underline decoration-dotted underline-offset-2"
        >
          {match.name}
        </Link>
      ))}
      <span className="text-muted-foreground">
        Seguir aqui cria uma festa separada.
      </span>
    </div>
  );
}
