export const TZ = "America/Sao_Paulo";

export function zonedParts(now: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday],
  };
}

export function isListenDay(now: Date): boolean {
  const wd = zonedParts(now).weekday;
  return wd >= 2 && wd <= 6;
}

export function startOfDaySp(now: Date): Date {
  const { year, month, day } = zonedParts(now);
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T03:00:00Z`);
}

export function daysUntil(eventAt: Date, now: Date): number {
  const a = startOfDaySp(eventAt).getTime();
  const b = startOfDaySp(now).getTime();
  return Math.round((a - b) / 86_400_000);
}
