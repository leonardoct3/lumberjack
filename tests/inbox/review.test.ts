import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ResolutionDecision } from "@prisma/client";
import { recordReviews, reviewCounts, undoLinks } from "@/catalog/review";
import { linkOrphans } from "@/catalog/link-orphan";
import { prisma } from "@/db/client";
import { loadSuggestions } from "@/features/inbox/suggestions";
import { resetDb } from "../helpers/db";

const now = new Date("2026-11-12T20:00:00Z");
const eventAt = new Date("2026-12-05T23:00:00Z");
let seq = 0;

async function orphan(text = "vendo pista rodeio sábado") {
  const group = await prisma.group.upsert({
    where: { waId: "g-1" },
    create: { waId: "g-1", name: "um", listen: true },
    update: {},
  });
  const sender = await prisma.sender.upsert({
    where: { waId: "s-1" },
    create: { waId: "s-1", name: "Guilherme" },
    update: {},
  });
  seq += 1;
  return prisma.message.create({
    data: {
      waMessageId: `m-${seq}`,
      groupId: group.id,
      senderId: sender.id,
      sentAt: now,
      text,
      class: "pista_oferta",
    },
  });
}

function party(name: string, status: "upcoming" | "past" = "upcoming") {
  return prisma.party.create({ data: { name, aliases: [], eventAt, status } });
}

/** A resolve job that accepted a run proposing `decision` for one observation. */
async function resolved(
  messageId: string,
  decision: ResolutionDecision,
  opts: { partyId?: string; completedAt?: Date; status?: "succeeded" | "dead" } = {},
) {
  seq += 1;
  const run = await prisma.interpretationRun.create({
    data: {
      messageId,
      stage: "resolve",
      pipelineVersion: "1",
      interpreter: "model",
      interpreterVersion: "resolve-1",
      schemaVersion: 1,
      inputHash: `in-${seq}`,
      contextHash: `ctx-${seq}`,
      status: "succeeded",
      latencyMs: 10,
    },
  });
  const observation = await prisma.observation.create({
    data: {
      runId: run.id,
      messageId,
      position: 0,
      intent: "offer",
      eventMention: "rodeio",
      spans: [{ start: 12, end: 18, text: "rodeio" }],
      ambiguities: [],
    },
  });
  await prisma.resolutionProposal.create({
    data: {
      runId: run.id,
      observationId: observation.id,
      messageId,
      decision,
      partyId: opts.partyId ?? null,
      candidates: opts.partyId ? [{ partyId: opts.partyId, score: 6 }] : [],
    },
  });
  await prisma.processingJob.create({
    data: {
      stage: "resolve",
      messageId,
      idempotencyKey: `resolve:${messageId}:${seq}`,
      pipelineVersion: "1",
      status: opts.status ?? "succeeded",
      resultRunId: opts.status === "dead" ? null : run.id,
      completedAt: opts.completedAt ?? now,
    },
  });
  return run;
}

describe("Inbox suggestions and their reviews", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reads the run of the latest succeeded resolve job, ignoring dead ones", async () => {
    const message = await orphan();
    const villa = await party("Villa Mix");
    const rodeio = await party("Rodeio Jaguariúna");
    await resolved(message.id, "link", {
      partyId: villa.id,
      completedAt: new Date("2026-11-12T10:00:00Z"),
    });
    const latest = await resolved(message.id, "link", { partyId: rodeio.id });
    await resolved(message.id, "abstain", { status: "dead" });
    const untouched = await orphan();

    const suggestions = await loadSuggestions(prisma, [message.id, untouched.id]);

    expect(suggestions.get(message.id)).toEqual({
      kind: "link",
      runId: latest.id,
      party: { id: rodeio.id, name: "Rodeio Jaguariúna" },
      spans: [{ start: 12, end: 18, text: "rodeio" }],
    });
    expect(suggestions.has(untouched.id)).toBe(false);
  });

  it("never suggests a festa that has passed since the run", async () => {
    const message = await orphan();
    const gone = await party("Rodeio 2025", "past");
    await resolved(message.id, "link", { partyId: gone.id });

    expect((await loadSuggestions(prisma, [message.id])).size).toBe(0);
  });

  it("records each action beside the suggestion, and counts acceptance", async () => {
    const rodeio = await party("Rodeio Jaguariúna");
    const villa = await party("Villa Mix");
    const accepted = await orphan();
    const changed = await orphan();
    const fresh = await orphan();
    const run = await resolved(accepted.id, "link", { partyId: rodeio.id });
    await resolved(changed.id, "link", { partyId: rodeio.id });

    await recordReviews(
      prisma,
      { messageIds: [accepted.id], action: "linked", chosenPartyId: rodeio.id },
      now,
    );
    await recordReviews(
      prisma,
      { messageIds: [changed.id], action: "linked", chosenPartyId: villa.id },
      now,
    );
    await recordReviews(prisma, { messageIds: [fresh.id], action: "dismissed" }, now);

    const row = await prisma.proposalReview.findFirstOrThrow({
      where: { messageId: accepted.id },
    });
    expect(row).toMatchObject({
      action: "linked",
      chosenPartyId: rodeio.id,
      suggestion: "link",
      suggestedPartyId: rodeio.id,
      runId: run.id,
    });
    expect(await reviewCounts(prisma)).toEqual({
      bySuggestion: {
        link: { linked: 2 },
        new_event: {},
        doubt: {},
        none: { dismissed: 1 },
      },
      linkAccepted: 1,
    });
  });

  it("undoes exactly one bulk link, leaving links made elsewhere alone", async () => {
    const rodeio = await party("Rodeio Jaguariúna");
    const villa = await party("Villa Mix");
    const a = await orphan();
    const b = await orphan();
    const c = await orphan();
    const { linkedIds } = await linkOrphans(prisma, {
      messageIds: [a.id, b.id],
      partyId: rodeio.id,
    });
    await linkOrphans(prisma, { messageIds: [c.id], partyId: villa.id });

    const undone = await undoLinks(prisma, {
      partyId: rodeio.id,
      messageIds: [...linkedIds, c.id],
    });

    expect(undone.sort()).toEqual([a.id, b.id].sort());
    const signals = await prisma.signal.findMany();
    expect(signals.map((s) => s.messageId)).toEqual([c.id]);
    const message = await prisma.message.findUniqueOrThrow({ where: { id: a.id } });
    expect(message.partyId).toBeNull();
  });
});
