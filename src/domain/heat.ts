export type HeatCounts = {
  demand1d: number;
  demand3d: number;
  demand7d: number;
  uniqueDemandSenders7d: number;
  offer1d: number;
  offer3d: number;
};

export function computeHeatScore(c: HeatCounts): number {
  return (
    4 * c.demand1d +
    2 * c.demand3d +
    1 * c.demand7d +
    2 * c.uniqueDemandSenders7d +
    1 * c.offer1d +
    1 * c.offer3d
  );
}
