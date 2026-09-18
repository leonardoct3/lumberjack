import type { JSX } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Clock3,
  Flame,
  Minus,
  Radio,
  Snowflake,
  TrendingDown,
  TrendingUp,
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
import type { HeatVerdict, Trend } from "@/domain/heat";
import { formatWhen } from "@/lib/datetime";
import { TREND_LABEL, VERDICT_LABEL, readHeat } from "@/lib/heat-copy";
import { cn } from "@/lib/utils";

export type HeatRow = {
  id: string;
  name: string;
  /** Unique buyers per unique seller in the chosen window. */
  pressure: number | null;
  buyers: number | null;
  sellers: number | null;
  messages: number | null;
  verdict: HeatVerdict;
  trend: Trend | null;
  days: number | null;
};

export type HeatGroup = { id: string; name: string; paused?: boolean };

const WINDOWS = [1, 3, 7] as const;

/** Five buyers per seller fills the bar; above that the bar stops arguing. */
const FULL_BAR = 5;

function dash(value: number | null): string {
  return value == null ? "—" : String(value);
}

function pressureLabel(value: number): string {
  return `${String(value).replace(".", ",")}×`;
}

const TREND_ICON = {
  up: TrendingUp,
  flat: Minus,
  down: TrendingDown,
} as const;

function Pressure({
  pressure,
  verdict,
  trend,
}: {
  pressure: number | null;
  verdict: HeatVerdict;
  trend: Trend | null;
}) {
  // Colour says buy, not "believe this number". It used to say the second, and
  // the loudest row on the board was the one with forty-two sellers.
  const buy = verdict === "scarce";
  // A room full of sellers and an empty room both go quiet, so the icon is what
  // tells them apart: the market answered, versus nobody spoke.
  const Mark = verdict === "flooded" ? Snowflake : Flame;
  const TrendIcon = trend ? TREND_ICON[trend] : null;

  return (
    <div className="min-w-20">
      {/* One fixed-height box for both states: an inline icon measures taller
          than bare text, which used to skew the row. */}
      <span
        className={cn(
          "flex h-5 items-center gap-1.5 font-mono text-sm tabular-nums",
          buy ? "font-semibold text-primary" : "text-muted-foreground",
        )}
        title={
          pressure == null
            ? undefined
            : `${VERDICT_LABEL[verdict]}${trend ? `, ${TREND_LABEL[trend]}` : ""}`
        }
      >
        {pressure == null ? (
          "—"
        ) : (
          <>
            <Mark
              className={cn("size-3.5", buy && "fill-primary/20")}
              aria-hidden="true"
            />
            {pressureLabel(pressure)}
            {TrendIcon ? (
              <TrendIcon
                className={cn(
                  "size-3",
                  trend === "up" && buy ? "text-primary" : "text-muted-foreground/60",
                )}
                aria-hidden="true"
              />
            ) : null}
          </>
        )}
      </span>
      {/* The track renders even with nothing to fill: dropping it made the
          unscored row shorter than every other one. */}
      <span
        className={cn(
          "mt-1.5 block h-0.5 w-14 overflow-hidden rounded-full",
          pressure == null ? "bg-border/45" : "bg-border",
        )}
      >
        {pressure == null || pressure === 0 ? null : (
          <span
            className={cn(
              "block h-full rounded-full",
              buy ? "bg-primary" : "bg-muted-foreground/50",
            )}
            style={{
              width: `${Math.min(100, Math.max(8, (pressure / FULL_BAR) * 100))}%`,
            }}
          />
        )}
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

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg px-2.5 py-2">
      <p className="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-medium tabular-nums">
        {dash(value)}
      </p>
    </div>
  );
}

function rowReading(row: HeatRow): string | null {
  if (row.buyers == null || row.sellers == null) return null;
  return readHeat({ buyers: row.buyers, sellers: row.sellers, days: row.days });
}

export function HeatBoard(props: {
  janela: 1 | 3 | 7;
  grupo: string;
  groups: HeatGroup[];
  rows: HeatRow[];
  updatedAt: string | null;
}): JSX.Element {
  const { janela, grupo, groups, rows, updatedAt } = props;
  const buyers = rows.reduce((sum, row) => sum + (row.buyers ?? 0), 0);
  const underPressure = rows.filter((row) => row.verdict === "scarce").length;
  // The top row is only the highest ratio; calling it the hottest when the
  // verdict says "pouca gente" is how the board started lying to the operator.
  const hottest = rows.find((row) => row.verdict === "scarce") ?? null;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Inteligência de sinais"
        title="Mapa de calor"
        description="Pressão é quanta gente diferente está procurando por vendedor na janela escolhida."
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
            Sob pressão
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">
            {String(underPressure).padStart(2, "0")}
          </p>
        </div>
        <div className="border-t border-border/80 p-4 md:border-t-0 md:border-l md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            Procurando
          </p>
          <p className="mt-2 font-mono text-xl font-semibold tabular-nums md:text-2xl">
            {buyers}
          </p>
        </div>
        <div className="min-w-0 border-t border-l border-border/80 p-4 md:border-t-0 md:p-5">
          <p className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground uppercase">
            Mais quente
          </p>
          <p className="mt-2 truncate text-sm font-semibold text-primary md:text-base">
            {hottest?.name ?? "—"}
          </p>
          {hottest ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {rowReading(hottest)}
            </p>
          ) : null}
        </div>
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Leitura do mercado"
          count={rows.length}
          description="A janela muda o período de contagem: gente diferente procurando e vendendo dentro dela."
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
                    <TableHead>Pressão</TableHead>
                    <TableHead>Procurando</TableHead>
                    <TableHead>Vendendo</TableHead>
                    {/* Secondary on a laptop, cut before the five that decide. */}
                    <TableHead className="hidden lg:table-cell">Mensagens</TableHead>
                    <TableHead>Dias</TableHead>
                    <TableHead className="hidden xl:table-cell">Leitura</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => (
                    // Fixed height so a row never gets measured by its glyphs.
                    <TableRow key={row.id} className="h-14">
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
                      <TableCell>
                        <Pressure
                          pressure={row.pressure}
                          verdict={row.verdict}
                          trend={row.trend}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {dash(row.buyers)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                        {dash(row.sellers)}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground tabular-nums lg:table-cell">
                        {dash(row.messages)}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {dash(row.days)}
                      </TableCell>
                      <TableCell className="hidden max-w-56 truncate text-xs text-muted-foreground xl:table-cell">
                        {rowReading(row) ?? "—"}
                      </TableCell>
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
                          <Users className="size-3.5 shrink-0" />
                          {rowReading(row) ?? "sem leitura ainda"}
                        </p>
                      </div>
                      <Pressure
                        pressure={row.pressure}
                        verdict={row.verdict}
                        trend={row.trend}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded-xl border border-border/70 bg-background/35 p-1.5">
                      <Metric label="Procurando" value={row.buyers} />
                      <Metric label="Vendendo" value={row.sellers} />
                      <Metric label="Mensagens" value={row.messages} />
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
