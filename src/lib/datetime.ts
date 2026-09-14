import { TZ } from "@/domain/timezone";

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Dense variant for queue rows: "sáb, 19/09 · 20:00". The countdown carries the year. */
export function formatEventWhen(iso: string): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short" })
    .format(date)
    .replace(".", "");
  const day = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    timeStyle: "short",
  }).format(date);
  return `${weekday}, ${day} · ${time}`;
}

/** Calendar days apart in São Paulo, so a party at 20:00 tonight reads "hoje". */
export function countdownLabel(iso: string, now: number): string {
  const days = saoPauloDay(new Date(iso)) - saoPauloDay(new Date(now));
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days === -1) return "ontem";
  return days > 0 ? `em ${days} dias` : `há ${-days} dias`;
}

function saoPauloDay(date: Date): number {
  const ymd = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

export function toDatetimeLocal(iso: string): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date(iso)).replace(" ", "T");
}
