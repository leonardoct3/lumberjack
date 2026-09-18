import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/db/client";
import { fingerprintText, withinDedupeWindow } from "@/domain/dedupe";

export type DedupeReport = {
  messages: number;
  fingerprinted: number;
  duplicates: number;
  signalsMoved: number;
  signalsRemoved: number;
  candidatesRemoved: number;
};

type Plan = {
  report: DedupeReport;
  fingerprints: { id: string; fingerprint: string }[];
  duplicates: { id: string; canonicalId: string; keepPartyId: boolean }[];
  signalsToMove: { id: string; canonicalId: string; partyId: string }[];
  signalIdsToDelete: string[];
  candidateIdsToDelete: string[];
};

/**
 * Retrofits cross-post collapsing onto rows ingested before dedupe existed.
 * Signals a copy carried are moved to the canonical message when the canonical
 * has none, so operator linking done by hand is never lost. Confirmed candidates
 * are left untouched because a party already depends on them.
 */
export async function backfillDedupe(
  db: PrismaClient,
  options: { apply: boolean },
): Promise<DedupeReport> {
  const plan = await planDedupe(db);
  if (options.apply) await applyPlan(db, plan);
  return plan.report;
}

async function planDedupe(db: PrismaClient): Promise<Plan> {
  const messages = await db.message.findMany({
    orderBy: { sentAt: "asc" },
    select: { id: true, senderId: true, sentAt: true, text: true, partyId: true },
  });

  const fingerprints: Plan["fingerprints"] = [];
  const duplicates: Plan["duplicates"] = [];
  const clusters = new Map<string, string[]>();
  const canonicals = new Map<string, { id: string; sentAt: Date }>();

  for (const message of messages) {
    const fingerprint = fingerprintText(message.text);
    if (!fingerprint) continue;
    fingerprints.push({ id: message.id, fingerprint });

    const key = `${message.senderId}:${fingerprint}`;
    const canonical = canonicals.get(key);
    if (canonical && withinDedupeWindow(canonical.sentAt, message.sentAt)) {
      duplicates.push({
        id: message.id,
        canonicalId: canonical.id,
        keepPartyId: false,
      });
      clusters.set(canonical.id, [
        ...(clusters.get(canonical.id) ?? []),
        message.id,
      ]);
      continue;
    }
    canonicals.set(key, { id: message.id, sentAt: message.sentAt });
  }

  const clusterMessageIds = [...clusters.keys(), ...duplicates.map((d) => d.id)];
  const [signals, candidates] = await Promise.all([
    db.signal.findMany({
      where: { messageId: { in: clusterMessageIds } },
      orderBy: { createdAt: "asc" },
      select: { id: true, messageId: true, partyId: true },
    }),
    db.partyCandidate.findMany({
      where: { sourceMessageId: { in: clusterMessageIds } },
      select: { id: true, sourceMessageId: true, status: true },
    }),
  ]);

  const signalByMessage = new Map(signals.map((s) => [s.messageId, s]));
  // A blast leaves one row per festa, so a message maps to several candidates.
  const candidatesByMessage = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const current = candidatesByMessage.get(candidate.sourceMessageId) ?? [];
    current.push(candidate);
    candidatesByMessage.set(candidate.sourceMessageId, current);
  }

  const signalsToMove: Plan["signalsToMove"] = [];
  const signalIdsToDelete: string[] = [];
  const candidateIdsToDelete: string[] = [];

  for (const [canonicalId, copyIds] of clusters) {
    const copySignals = copyIds.flatMap((id) => {
      const signal = signalByMessage.get(id);
      return signal ? [signal] : [];
    });

    if (signalByMessage.has(canonicalId)) {
      signalIdsToDelete.push(...copySignals.map((s) => s.id));
    } else {
      const [survivor, ...rest] = copySignals;
      if (survivor) {
        signalsToMove.push({
          id: survivor.id,
          canonicalId,
          partyId: survivor.partyId,
        });
      }
      signalIdsToDelete.push(...rest.map((s) => s.id));
    }

    for (const id of copyIds) {
      for (const candidate of candidatesByMessage.get(id) ?? []) {
        if (candidate.status === "pending") {
          candidateIdsToDelete.push(candidate.id);
          continue;
        }
        // A confirmed candidate already spawned a party through this message.
        const copy = duplicates.find((d) => d.id === id);
        if (copy) copy.keepPartyId = true;
      }
    }
  }

  return {
    report: {
      messages: messages.length,
      fingerprinted: fingerprints.length,
      duplicates: duplicates.length,
      signalsMoved: signalsToMove.length,
      signalsRemoved: signalIdsToDelete.length,
      candidatesRemoved: candidateIdsToDelete.length,
    },
    fingerprints,
    duplicates,
    signalsToMove,
    signalIdsToDelete,
    candidateIdsToDelete,
  };
}

async function applyPlan(db: PrismaClient, plan: Plan): Promise<void> {
  await db.signal.deleteMany({ where: { id: { in: plan.signalIdsToDelete } } });
  await db.partyCandidate.deleteMany({
    where: { id: { in: plan.candidateIdsToDelete } },
  });

  for (const move of plan.signalsToMove) {
    await db.signal.update({
      where: { id: move.id },
      data: { messageId: move.canonicalId },
    });
    await db.message.update({
      where: { id: move.canonicalId },
      data: { partyId: move.partyId },
    });
  }

  for (const { id, fingerprint } of plan.fingerprints) {
    await db.message.update({ where: { id }, data: { fingerprint } });
  }

  for (const copy of plan.duplicates) {
    await db.message.update({
      where: { id: copy.id },
      data: {
        duplicateOfId: copy.canonicalId,
        ...(copy.keepPartyId ? {} : { partyId: null }),
      },
    });
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await prisma.$connect();
  try {
    const report = await backfillDedupe(prisma, { apply });
    console.log(apply ? "dedupe applied" : "dedupe dry run (use --apply)");
    console.table(report);
    if (apply) {
      console.log("heat snapshots refresh on the next worker run");
    }
  } finally {
    await prisma.$disconnect();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
