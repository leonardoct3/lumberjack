import type { JSX } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Clock3,
  Flame,
  Radio,
  Users,
} from "lucide-react";
import { HeatFilter } from "@/components/heat/heat-filter";
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
import { formatWhen } from "@/lib/datetime";
import { cn } from "@/lib/utils";

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

export type HeatGroup = { id: string; name: string; paused?: boolean };

const WINDOWS = [1, 3, 7] as const;

function dash(value: number | null): string {
  return value == null ? "—" : String(value);
}

function Score({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="font-mono text-muted-foreground">—</span>;
  }

  const width = `${Math.min(100, Math.max(8, score * 10))}%`;
  return (
    <div className="min-w-16">
      <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-primary tabular-nums">
        <Flame className="size-3.5 fill-primary/20" aria-hidden="true" />
        {score}
      </span>
      <span className="mt-1.5 block h-0.5 w-12 overflow-hidden rounded-full bg-border">
        <span className="block h-full rounded-full bg-primary" style={{ width }} />
      </span>
    </div>
  );
}

function janelaHref(janela: number, grupo: string) {
  const q = new URLSearchParams();
  q.set("janela", String(janela));
  if (grupo) q.set("grupo", grupo);
  return `/heat?${q.toString()}`;
}

function Metric({
  label,
  value,
  active,
}: {
  label: string;
  value: number | null;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-2.5 py-2",
        active && "bg-primary/8 ring-1 ring-primary/15",
      )}
    >
      <p className="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-sm font-medium tabular-nums",
          active && "text-primary",
        )}
      >
        {dash(value)}
      </p>
    </div>
  );
}

export function HeatBoard(props: {
  janela: 1 | 3 | 7 | null;
  grupo: string;
  groups: HeatGroup[];
  rows: HeatRow[];
  updatedAt: string | null;
}): JSX.Element {
  const { janela, grupo, groups, rows, updatedAt } = props;
  const totalDemand = rows.reduce((sum, row) => sum + (row.procura7 ?? 0), 0);
  const activeAuthors = rows.reduce((sum, row) => sum + (row.autores7d ?? 0), 0);
  const hottest = rows.find((row) => row.score != null) ?? null;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Inteligência de sinais"
        title="Mapa de calor"
        description="Compare procura e oferta para entender onde a pressão de compra está aumentando."
        icon={Flame}
        meta={
          updatedAt ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" aria-hidden="true" />
              Atualizado em {formatWhen(updatedAt)}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Radio className="size-3.5" aria-hidden="true" />
              Aguardando o primeiro processamento
            </p>
          )
        }
      />

      <div className="grid grid-cols-2 overflow-hidden rounded-[var(--radius)] border border-border/80 bg-card md:grid-cols-4">
        <div className="p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            Monitoradas
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">
            {String(rows.length).padStart(2, "0")}
          </p>
        </div>
        <div className="border-l border-border/80 p-4 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            Procura 7d
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">
            {totalDemand}
          </p>
        </div>
        <div className="border-t border-border/80 p-4 md:border-t-0 md:border-l md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            Autores
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">
            {activeAuthors}
          </p>
        </div>
        <div className="min-w-0 border-t border-l border-border/80 p-4 md:border-t-0 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            Mais quente
          </p>
          <p className="mt-2 truncate text-sm font-semibold text-primary md:text-base">
            {hottest?.name ?? "—"}
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Leitura do mercado"
          count={rows.length}
          description="Escolha uma janela para destacar os sinais mais relevantes."
        />

        <Card className="gap-4 p-4 md:flex-row md:items-end md:justify-between md:p-5">
          <div>
            <p className="mb-2.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BarChart3 className="size-3.5" aria-hidden="true" />
              Janela de análise
            </p>
            <div className="inline-flex rounded-xl border border-border bg-background/50 p-1">
              {WINDOWS.map((window) => {
                const active = janela === window;
                return (
                  <Link
                    key={window}
                    href={janelaHref(window, grupo)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-lg px-4 py-2 font-mono text-xs font-semibold no-underline transition-all",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {window}d
                  </Link>
                );
              })}
            </div>
          </div>

          <HeatFilter janela={janela} grupo={grupo} groups={groups} />
        </Card>

        {rows.length === 0 ? (
          <EmptyState
            title="Nenhuma festa no calor"
            description="Os sinais classificados vão aparecer aqui após o próximo processamento."
            icon={Flame}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/inbox">
                  Abrir Inbox <ArrowRight />
                </Link>
              </Button>
            }
          />
        ) : (
          <>
            <Card className="hidden overflow-hidden p-0 md:block">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Festa</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead className={cn(janela === 1 && "text-primary")}>
                      Procura 1d
                    </TableHead>
                    <TableHead className={cn(janela === 3 && "text-primary")}>
                      Procura 3d
                    </TableHead>
                    <TableHead className={cn(janela === 7 && "text-primary")}>
                      Procura 7d
                    </TableHead>
                    <TableHead className={cn(janela === 1 && "text-primary")}>
                      Oferta 1d
                    </TableHead>
                    <TableHead className={cn(janela === 3 && "text-primary")}>
                      Oferta 3d
                    </TableHead>
                    <TableHead>Autores 7d</TableHead>
                    <TableHead>Dias</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[10px] text-muted-foreground/60">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <Link
                            href={`/parties/${row.id}`}
                            className="font-semibold text-foreground no-underline hover:text-primary"
                          >
                            {row.name}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell><Score score={row.score} /></TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{dash(row.procura1)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{dash(row.procura3)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{dash(row.procura7)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{dash(row.oferta1)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{dash(row.oferta3)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{dash(row.autores7d)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{dash(row.days)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <ul className="space-y-3 md:hidden">
              {rows.map((row, index) => (
                <li key={row.id}>
                  <Card className="gap-4 p-4">
                    <div className="flex items-start gap-3">
                      <span className="font-mono text-xs text-muted-foreground/60">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/parties/${row.id}`}
                          className="block truncate font-semibold text-foreground no-underline"
                        >
                          {row.name}
                        </Link>
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users className="size-3.5" />
                          {dash(row.autores7d)} autores · {dash(row.days)} dias
                        </p>
                      </div>
                      <Score score={row.score} />
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded-xl border border-border/70 bg-background/35 p-1.5">
                      <Metric label="Proc. 1d" value={row.procura1} active={janela === 1} />
                      <Metric label="Proc. 3d" value={row.procura3} active={janela === 3} />
                      <Metric label="Proc. 7d" value={row.procura7} active={janela === 7} />
                      <Metric label="Oferta 1d" value={row.oferta1} active={janela === 1} />
                      <Metric label="Oferta 3d" value={row.oferta3} active={janela === 3} />
                      <Metric label="Autores" value={row.autores7d} />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
