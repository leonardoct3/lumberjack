export type HeatCounts = {
  /** People, not messages: one person asking five times is one buyer. */
  uniqueDemandSenders: number;
  uniqueOfferSenders: number;
};

/**
 * Buyers per seller. A ratio, not a sum, because what decides a buy is
 * scarcity: the old sum added offers, so ten sellers and no buyer outranked a
 * party with a real buyer. The +1 keeps a party with no seller finite, so it
 * reads as "four buyers and nobody selling" instead of infinity.
 */
export function computePressure(counts: HeatCounts): number {
  const ratio =
    counts.uniqueDemandSenders / (counts.uniqueOfferSenders + 1);
  return Math.round(ratio * 10) / 10;
}

/**
 * How much the ratio is worth believing. Pressure of 3 from three people and
 * from thirty is the same number and a very different bet, and hiding that
 * inside a weight is what made the old score unreadable.
 */
export type Confidence = "none" | "low" | "medium" | "high";

export function demandConfidence(uniqueDemandSenders: number): Confidence {
  if (uniqueDemandSenders <= 0) return "none";
  if (uniqueDemandSenders <= 2) return "low";
  if (uniqueDemandSenders <= 5) return "medium";
  return "high";
}

export type Trend = "up" | "flat" | "down";

/** Half a buyer per seller: below that, hourly snapshots only show noise. */
const TREND_STEP = 0.5;

export function pressureTrend(
  current: number,
  previous: number | null,
): Trend | null {
  if (previous == null) return null;
  if (current - previous >= TREND_STEP) return "up";
  if (previous - current >= TREND_STEP) return "down";
  return "flat";
}

/**
 * Snapshot taken closest to a past moment, for reading the trend. Hourly runs
 * never land on the hour asked for, and a gap in the worker should not read as
 * a drop, so the nearest one wins instead of the first one before it.
 */
export function snapshotNearest<T extends { computedAt: Date }>(
  snapshots: T[],
  target: Date,
): T | null {
  let best: T | null = null;
  let bestGap = Number.POSITIVE_INFINITY;

  for (const snapshot of snapshots) {
    const gap = Math.abs(snapshot.computedAt.getTime() - target.getTime());
    if (gap < bestGap) {
      best = snapshot;
      bestGap = gap;
    }
  }

  return best;
}
