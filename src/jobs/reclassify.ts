import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MessageClass, PrismaClient, SignalType } from "@prisma/client";
import { prisma } from "@/db/client";
import { classifyMessage } from "@/domain/classify";
import {
  type ExtractedCandidate,
  extractCandidate,
  extractCandidates,
  isActionableCandidate,
} from "@/domain/extract";
import { matchParty } from "@/domain/match";
import { refreshHeat } from "@/jobs/refresh-heat";

export type ReclassifyReport = {
  messages: number;
  changed: number;
  /** Was ruído, now reads as a pista message: the demand the operator never saw. */
  becamePista: number;
  /** Was ruído, now reads as an announced festa: a promoter who is not an admin. */
  becamePromo: number;
  /** Was pista, now reads as ruído: a keyword that used to be too greedy. */
  lostPista: number;
  /** Offer and demand swapped places. */
  flipped: number;
  signalsCreated: number;
  signalsRetyped: number;
  /** Signals on messages that are no longer pista; left alone on purpose. */
  signalsToReview: number;
  candidatesCreated: number;
  /** Candidates whose message stopped being a promo; left alone on purpose. */
  candidatesToReview: number;
  /** Pending candidates re-read with the current extractor. */
  candidatesRefreshed: number;
  /** Pending candidates that no longer have a name and a way to buy. */
  candidatesDropped: number;
};

type Plan = {
  report: ReclassifyReport;
  classes: { id: string; next: MessageClass }[];
  signalsToCreate: {
    messageId: string;
    partyId: string;
    senderId: string;
    type: SignalType;
  }[];
  signalsToRetype: { id: string; type: SignalType }[];
  candidatesToCreate: { messageId: string; extracted: ExtractedCandidate }[];
  candidatesToRefresh: { id: string; extracted: ExtractedCandidate }[];
  candidatesToDrop: string[];
};

/**
 * A pending candidate holds nothing but the extractor's reading of its message:
 * the operator's edits live in the confirm form, never in this row. So a better
 * extractor can re-read it, which is the only way the queue stops carrying the
 * titles that an older version wrote.
 */
function candidateDiffers(
  stored: {
    name: string | null;
    url: string | null;
    lotLabel: string | null;
    officialPrice: number | null;
    eventAt: Date | null;
    platform: string;
  },
  next: ExtractedCandidate,
): boolean {
  return (
    stored.name !== next.name ||
    stored.url !== next.url ||
    stored.lotLabel !== next.lotLabel ||
    stored.officialPrice !== next.officialPrice ||
    stored.eventAt?.getTime() !== next.eventAt?.getTime() ||
    stored.platform !== next.platform
  );
}

const PISTA: MessageClass[] = ["pista_oferta", "pista_procura"];

function isPista(value: MessageClass | null): boolean {
  return value != null && PISTA.includes(value);
}

function signalType(value: MessageClass): SignalType {
  return value === "pista_procura" ? "demand" : "offer";
}

/**
 * Replays the classifier over stored messages. The raw text was always kept, so
 * widening the vocabulary recovers history instead of only helping from now on.
 *
 * Signals already attached to a message that stopped being pista are reported
 * and left in place: nothing here can tell an operator's manual link apart from
 * one the ingest made, and unlinking by hand is one click on the party page.
 */
export async function reclassifyMessages(
  db: PrismaClient,
  options: { apply: boolean },
): Promise<ReclassifyReport> {
  const plan = await planReclassify(db);
  if (options.apply) await applyPlan(db, plan);
  return plan.report;
}

async function planReclassify(db: PrismaClient): Promise<Plan> {
  const [messages, upcoming] = await Promise.all([
    db.message.findMany({
      orderBy: { sentAt: "asc" },
      select: {
        id: true,
        text: true,
        class: true,
        senderId: true,
        partyId: true,
        duplicateOfId: true,
        sentAt: true,
        sender: { select: { role: true, muted: true } },
        signals: { select: { id: true, type: true } },
        candidates: {
          select: {
            id: true,
            status: true,
            name: true,
            url: true,
            lotLabel: true,
            officialPrice: true,
            eventAt: true,
            platform: true,
            excerpt: true,
          },
        },
      },
    }),
    db.party.findMany({ where: { status: "upcoming" } }),
  ]);

  const parties = upcoming.map((party) => ({
    id: party.id,
    name: party.name,
    aliases: party.aliases,
    status: party.status,
  }));

  const plan: Plan = {
    report: {
      messages: messages.length,
      changed: 0,
      becamePista: 0,
      becamePromo: 0,
      lostPista: 0,
      flipped: 0,
      signalsCreated: 0,
      signalsRetyped: 0,
      signalsToReview: 0,
      candidatesCreated: 0,
      candidatesToReview: 0,
      candidatesRefreshed: 0,
      candidatesDropped: 0,
    },
    classes: [],
    signalsToCreate: [],
    signalsToRetype: [],
    candidatesToCreate: [],
    candidatesToRefresh: [],
    candidatesToDrop: [],
  };

  for (const message of messages) {
    const next = classifyMessage({
      text: message.text,
      senderRole: message.sender.role,
    });
    const [signal] = message.signals;

    if (next !== message.class) {
      plan.report.changed += 1;
      plan.classes.push({ id: message.id, next });

      if (isPista(next) && !isPista(message.class)) plan.report.becamePista += 1;
      if (!isPista(next) && isPista(message.class)) plan.report.lostPista += 1;
      if (isPista(next) && isPista(message.class)) plan.report.flipped += 1;
      if (next === "admin_promo") plan.report.becamePromo += 1;
    }

    // Waiting candidates get re-read whatever the class says now, because the
    // extractor moved too, and a stale title is what the operator sees first.
    for (const candidate of message.candidates) {
      if (candidate.status !== "pending") continue;
      // A blast's rows each own a slice of the message, and re-reading the whole
      // text for every one of them would collapse three festas into one.
      const source = candidate.excerpt ?? message.text;
      if (candidate.excerpt == null && message.candidates.length > 1) continue;

      const extracted = extractCandidate(source, message.sentAt);
      if (!isActionableCandidate(extracted)) {
        plan.candidatesToDrop.push(candidate.id);
        plan.report.candidatesDropped += 1;
      } else if (candidateDiffers(candidate, extracted)) {
        plan.candidatesToRefresh.push({ id: candidate.id, extracted });
        plan.report.candidatesRefreshed += 1;
      }
    }

    if (next === "admin_promo") {
      if (signal) plan.report.signalsToReview += 1;
      // A copy has no candidate of its own; the canonical message carries it.
      if (
        message.candidates.length === 0 &&
        !message.duplicateOfId &&
        !message.sender.muted
      ) {
        for (const extracted of extractCandidates(message.text, message.sentAt)) {
          plan.candidatesToCreate.push({ messageId: message.id, extracted });
          plan.report.candidatesCreated += 1;
        }
      }
      continue;
    }

    if (!isPista(next)) {
      if (signal) plan.report.signalsToReview += 1;
      plan.report.candidatesToReview += message.candidates.length;
      continue;
    }

    plan.report.candidatesToReview += message.candidates.length;

    if (signal) {
      if (signal.type !== signalType(next)) {
        plan.signalsToRetype.push({ id: signal.id, type: signalType(next) });
        plan.report.signalsRetyped += 1;
      }
      continue;
    }

    // A copy never produced a signal of its own; the canonical message carries
    // it, and a silenced sender never produced one at all.
    if (message.duplicateOfId || message.sender.muted) continue;

    const matched = matchParty(message.text, parties);
    if (!matched) continue;

    plan.signalsToCreate.push({
      messageId: message.id,
      partyId: matched.id,
      senderId: message.senderId,
      type: signalType(next),
    });
    plan.report.signalsCreated += 1;
  }

  return plan;
}

async function applyPlan(db: PrismaClient, plan: Plan): Promise<void> {
  const byClass = new Map<MessageClass, string[]>();
  for (const { id, next } of plan.classes) {
    byClass.set(next, [...(byClass.get(next) ?? []), id]);
  }
  for (const [next, ids] of byClass) {
    await db.message.updateMany({ where: { id: { in: ids } }, data: { class: next } });
  }

  for (const retype of plan.signalsToRetype) {
    await db.signal.update({
      where: { id: retype.id },
      data: { type: retype.type },
    });
  }

  for (const signal of plan.signalsToCreate) {
    await db.signal.create({ data: signal });
    await db.message.update({
      where: { id: signal.messageId },
      data: { partyId: signal.partyId },
    });
  }

  if (plan.candidatesToDrop.length > 0) {
    await db.partyCandidate.deleteMany({
      where: { id: { in: plan.candidatesToDrop } },
    });
  }

  for (const { id, extracted } of plan.candidatesToRefresh) {
    await db.partyCandidate.update({
      where: { id },
      data: {
        name: extracted.name,
        url: extracted.url,
        lotLabel: extracted.lotLabel,
        officialPrice: extracted.officialPrice,
        eventAt: extracted.eventAt,
        platform: extracted.platform,
      },
    });
  }

  for (const { messageId, extracted } of plan.candidatesToCreate) {
    await db.partyCandidate.create({
      data: {
        status: "pending",
        name: extracted.name,
        url: extracted.url,
        lotLabel: extracted.lotLabel,
        officialPrice: extracted.officialPrice,
        eventAt: extracted.eventAt,
        platform: extracted.platform,
        excerpt: extracted.excerpt,
        sourceMessageId: messageId,
      },
    });
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await prisma.$connect();
  try {
    const report = await reclassifyMessages(prisma, { apply });
    console.log(apply ? "reclassify applied" : "reclassify dry run (use --apply)");
    console.table(report);
    if (apply) {
      console.table(await refreshHeat(prisma, new Date()));
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
