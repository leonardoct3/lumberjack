import type { JSX } from "react";
import Link from "next/link";
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
import { formatWhen } from "@/lib/datetime";

export type HeatRow = {
  id: string;
  name: string;
  score: number | null;
  procura1: number | null;
  procura3: number | null;
  procura7: number | null;
  oferta1: number | null;
  oferta3: number | null;
  autores7d: number | null;
  days: number | null;
};

export type HeatGroup = { id: string; name: string };

const WINDOWS = [1, 3, 7] as const;

function dash(value: number | null): string {
  return value == null ? "—" : String(value);
}

function scoreCell(score: number | null) {
  if (score == null) return "—";
  return (
    <span className="text-primary font-semibold tabular-nums">{score}</span>
  );
}

function janelaHref(janela: number, grupo: string) {
  const q = new URLSearchParams();
  q.set("janela", String(janela));
  if (grupo) q.set("grupo", grupo);
  return `/heat?${q.toString()}`;
}

function headClass(active: boolean) {
  return active ? "font-semibold" : undefined;
}

export function HeatBoard(props: {
  janela: 1 | 3 | 7 | null;
  grupo: string;
  groups: HeatGroup[];
  rows: HeatRow[];
  updatedAt: string | null;
}): JSX.Element {
  const { janela, grupo, groups, rows, updatedAt } = props;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Calor</h1>
        {updatedAt ? (
          <p className="text-muted-foreground text-sm">
            Atualizado em {formatWhen(updatedAt)}
          </p>
        ) : null}
      </header>

      <p className="flex flex-wrap items-center gap-2">
        {WINDOWS.map((w) =>
          janela === w ? (
            <Badge
              key={w}
              asChild
              className="bg-primary text-primary-foreground"
            >
              <Link href={janelaHref(w, grupo)}>{w}d</Link>
            </Badge>
          ) : (
            <Link key={w} href={janelaHref(w, grupo)} className="text-sm">
              {w}d
            </Link>
          ),
        )}
      </p>

      <form
        method="GET"
        action="/heat"
        className="flex flex-wrap items-end gap-3"
      >
        {janela ? (
          <input type="hidden" name="janela" value={String(janela)} />
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          Grupo
          <select
            name="grupo"
            defaultValue={grupo}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
          >
            <option value="">Todos</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="ghost">
          Filtrar
        </Button>
      </form>

      {rows.length === 0 ? (
        <Card className="gap-2 p-6">
          <p>Nenhuma festa no calor</p>
          <p className="text-muted-foreground text-sm">
            <Link href="/inbox">Inbox</Link>
          </p>
        </Card>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead className={headClass(janela === 1)}>
                    Procura 1
                  </TableHead>
                  <TableHead className={headClass(janela === 3)}>
                    Procura 3
                  </TableHead>
                  <TableHead className={headClass(janela === 7)}>
                    Procura 7
                  </TableHead>
                  <TableHead className={headClass(janela === 1)}>
                    Oferta 1
                  </TableHead>
                  <TableHead className={headClass(janela === 3)}>
                    Oferta 3
                  </TableHead>
                  <TableHead>Autores 7d</TableHead>
                  <TableHead>Dias</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/parties/${row.id}`}>{row.name}</Link>
                    </TableCell>
                    <TableCell>{scoreCell(row.score)}</TableCell>
                    <TableCell>{dash(row.procura1)}</TableCell>
                    <TableCell>{dash(row.procura3)}</TableCell>
                    <TableCell>{dash(row.procura7)}</TableCell>
                    <TableCell>{dash(row.oferta1)}</TableCell>
                    <TableCell>{dash(row.oferta3)}</TableCell>
                    <TableCell>{dash(row.autores7d)}</TableCell>
                    <TableCell>{dash(row.days)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Card className="gap-2 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/parties/${row.id}`} className="font-medium">
                      {row.name}
                    </Link>
                    {scoreCell(row.score)}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Procura {dash(row.procura1)} / {dash(row.procura3)} /{" "}
                    {dash(row.procura7)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Oferta {dash(row.oferta1)} / {dash(row.oferta3)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Autores 7d {dash(row.autores7d)} · Dias {dash(row.days)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
