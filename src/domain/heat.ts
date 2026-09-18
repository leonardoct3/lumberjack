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
 * What the row is telling the operator to do, which is what the board gets to
 * colour. Pressure alone cannot: 1× from "1 procurando, 0 vendendo" is silence,
 * not scarcity, and the ratio reads the same either way.
 */
export type HeatVerdict = "scarce" | "balanced" | "flooded" | "unknown";

/** Below three people it is one person's mood, not a market. */
const PEOPLE = 3;
/** A buyer and a half per seller: under that, 1× keeps coming from silence. */
const SCARCE = 1.5;
const FLOODED = 0.75;

export function heatVerdict(input: {
  pressure: number;
  buyers: number;
  sellers: number;
}): HeatVerdict {
  if (input.buyers >= PEOPLE && input.pressure >= SCARCE) return "scarce";
  // Read off the sellers, because that is whose evidence this is: nobody
  // asking with nobody selling is an empty room, not a glut.
  if (input.sellers >= PEOPLE && input.pressure < FLOODED) return "flooded";
  if (input.buyers >= PEOPLE || input.sellers >= PEOPLE) return "balanced";
  return "unknown";
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
