import type {
  FailureKind,
  PrismaClient,
  ProcessingStage,
  ResolutionDecision,
  WaState,
} from "@prisma/client";
import { reviewCounts, type ReviewCounts } from "@/catalog/review";
import { startOfDaySp } from "@/domain/timezone";

type JobCounts = {
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

export type PipelineStatus = {
  capture: {
    lastStoredAt: Date | null;
    sessionState: WaState | null;
    heartbeatAt: Date | null;
  };
  /** Each stage's backlog on its own, so a stuck resolver never hides behind a healthy interpreter. */
  jobs: Record<ProcessingStage, JobCounts>;
  deadByKind: Record<ProcessingStage, Partial<Record<FailureKind, number>>>;
  /** Shadow resolution proposals so far, by decision. */
  proposals: Record<ResolutionDecision, number>;
  /** What the operator did with Inbox suggestions: the acceptance evidence for promotion. */
  reviews: ReviewCounts;
  today: { succeeded: number; failed: number; costUsd: number };
};

const STAGES: ProcessingStage[] = ["interpret", "resolve"];

async function stageCounts(
  db: PrismaClient,
  stage: ProcessingStage,
  now: Date,
): Promise<[JobCounts, Partial<Record<FailureKind, number>>]> {
  const [byStatus, due, expiredLeases, oldest, dead] = await Promise.all([
    db.processingJob.groupBy({
      by: ["status"],
      where: { stage },
      _count: { _all: true },
    }),
    db.processingJob.count({
      where: { stage, status: "pending", runAfter: { lte: now } },
    }),
    db.processingJob.count({
      where: { stage, status: "running", leaseExpiresAt: { lt: now } },
    }),
    db.processingJob.aggregate({
      where: { stage, status: { in: ["pending", "running"] } },
      _min: { createdAt: true },
    }),
    db.processingJob.groupBy({
      by: ["lastErrorKind"],
      where: { stage, status: "dead" },
      _count: { _all: true },
    }),
  ]);
  const count = (status: string) =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;
  return [
    {
      pending: count("pending"),
      running: count("running"),
      succeeded: count("succeeded"),
      dead: count("dead"),
      due,
      expiredLeases,
      oldestWaitingSince: oldest._min.createdAt,
    },
    Object.fromEntries(
      dead
        .filter((row) => row.lastErrorKind != null)
        .map((row) => [row.lastErrorKind, row._count._all]),
    ),
  ];
}

/** Counts and timestamps only, so it can be printed from production without exposing a message. */
export async function pipelineStatus(
  db: PrismaClient,
  now: Date,
): Promise<PipelineStatus> {
  const [lastStored, session, stages, decisions, runs, cost, reviews] =
    await Promise.all([
      db.message.aggregate({ _max: { createdAt: true } }),
      db.waSession.findUnique({
        where: { id: "wa" },
        select: { state: true, heartbeatAt: true },
      }),
      Promise.all(STAGES.map((stage) => stageCounts(db, stage, now))),
      db.resolutionProposal.groupBy({ by: ["decision"], _count: { _all: true } }),
      db.interpretationRun.groupBy({
        by: ["status"],
        where: { createdAt: { gte: startOfDaySp(now) } },
        _count: { _all: true },
      }),
      db.interpretationRun.aggregate({
        where: { createdAt: { gte: startOfDaySp(now) } },
        _sum: { costUsd: true },
      }),
      reviewCounts(db),
    ]);

  const runCount = (status: string) =>
    runs.find((row) => row.status === status)?._count._all ?? 0;
  const decided = (decision: ResolutionDecision) =>
    decisions.find((row) => row.decision === decision)?._count._all ?? 0;

  return {
    capture: {
      lastStoredAt: lastStored._max.createdAt,
      sessionState: session?.state ?? null,
      heartbeatAt: session?.heartbeatAt ?? null,
    },
    jobs: Object.fromEntries(
      STAGES.map((s, i) => [s, stages[i][0]]),
    ) as PipelineStatus["jobs"],
    deadByKind: Object.fromEntries(
      STAGES.map((s, i) => [s, stages[i][1]]),
    ) as PipelineStatus["deadByKind"],
    proposals: {
      link: decided("link"),
      new_event: decided("new_event"),
      abstain: decided("abstain"),
      not_mentioned: decided("not_mentioned"),
    },
    reviews,
    today: {
      succeeded: runCount("succeeded"),
      failed: runCount("failed"),
      costUsd: cost._sum.costUsd ?? 0,
    },
  };
}
