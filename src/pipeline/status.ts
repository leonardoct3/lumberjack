import type { FailureKind, PrismaClient, WaState } from "@prisma/client";
import { startOfDaySp } from "@/domain/timezone";

export type PipelineStatus = {
  capture: {
    lastStoredAt: Date | null;
    sessionState: WaState | null;
    heartbeatAt: Date | null;
  };
  jobs: {
    pending: number;
    running: number;
    succeeded: number;
    dead: number;
    /** Pending and past their backoff: what the next pass will pick up. */
    due: number;
    /** Running under a lease nobody renewed, which means a worker died mid-job. */
    expiredLeases: number;
    /** When the longest-waiting unfinished job was queued. */
    oldestWaitingSince: Date | null;
  };
  deadByKind: Partial<Record<FailureKind, number>>;
  today: { succeeded: number; failed: number; costUsd: number };
};

/** Counts and timestamps only, so it can be printed from production without exposing a message. */
export async function pipelineStatus(
  db: PrismaClient,
  now: Date,
): Promise<PipelineStatus> {
  const [lastStored, session, byStatus, due, expiredLeases, oldest, dead, runs, cost] =
    await Promise.all([
      db.message.aggregate({ _max: { createdAt: true } }),
      db.waSession.findUnique({
        where: { id: "wa" },
        select: { state: true, heartbeatAt: true },
      }),
      db.processingJob.groupBy({ by: ["status"], _count: { _all: true } }),
      db.processingJob.count({ where: { status: "pending", runAfter: { lte: now } } }),
      db.processingJob.count({
        where: { status: "running", leaseExpiresAt: { lt: now } },
      }),
      db.processingJob.aggregate({
        where: { status: { in: ["pending", "running"] } },
        _min: { createdAt: true },
      }),
      db.processingJob.groupBy({
        by: ["lastErrorKind"],
        where: { status: "dead" },
        _count: { _all: true },
      }),
      db.interpretationRun.groupBy({
        by: ["status"],
        where: { createdAt: { gte: startOfDaySp(now) } },
        _count: { _all: true },
      }),
      db.interpretationRun.aggregate({
        where: { createdAt: { gte: startOfDaySp(now) } },
        _sum: { costUsd: true },
      }),
    ]);

  const statusCount = (status: string) =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;
  const runCount = (status: string) =>
    runs.find((row) => row.status === status)?._count._all ?? 0;

  return {
    capture: {
      lastStoredAt: lastStored._max.createdAt,
      sessionState: session?.state ?? null,
      heartbeatAt: session?.heartbeatAt ?? null,
    },
    jobs: {
      pending: statusCount("pending"),
      running: statusCount("running"),
      succeeded: statusCount("succeeded"),
      dead: statusCount("dead"),
      due,
      expiredLeases,
      oldestWaitingSince: oldest._min.createdAt,
    },
    deadByKind: Object.fromEntries(
      dead
        .filter((row) => row.lastErrorKind != null)
        .map((row) => [row.lastErrorKind, row._count._all]),
    ),
    today: {
      succeeded: runCount("succeeded"),
      failed: runCount("failed"),
      costUsd: cost._sum.costUsd ?? 0,
    },
  };
}
