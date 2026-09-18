import type { PrismaClient, SenderRole, SignalType } from "@prisma/client";
import { classifyMessage } from "@/domain/classify";
import {
  DEDUPE_WINDOW_MS,
  fingerprintText,
  withinDedupeWindow,
} from "@/domain/dedupe";
import { extractCandidates } from "@/domain/extract";
import { matchParty } from "@/domain/match";

export type RawMessageInput = {
  waMessageId: string;
  groupWaId: string;
  groupName: string;
  senderWaId: string;
  senderName: string | null;
  sentAt: Date;
  text: string;
  senderIsGroupAdmin?: boolean;
};

export async function ingestRawMessage(
  db: PrismaClient,
  input: RawMessageInput,
): Promise<{ created: boolean; messageId: string; duplicateOfId?: string }> {
  const group = await db.group.upsert({
    where: { waId: input.groupWaId },
    create: {
      waId: input.groupWaId,
      name: input.groupName,
      listen: false,
    },
    update: {
      name: input.groupName,
    },
  });

  const currentSender = await db.sender.findUnique({
    where: { waId: input.senderWaId },
  });
  const nextRole = nextSenderRole(currentSender?.role, input.senderIsGroupAdmin);

  const sender = await db.sender.upsert({
    where: { waId: input.senderWaId },
    create: {
      waId: input.senderWaId,
      name: input.senderName,
      role: nextRole,
    },
    update: {
      name: input.senderName,
      role: nextRole,
    },
  });

  const existing = await db.message.findUnique({
    where: { waMessageId: input.waMessageId },
  });
  if (existing) {
    return {
      created: false,
      messageId: existing.id,
      ...(existing.duplicateOfId
        ? { duplicateOfId: existing.duplicateOfId }
        : {}),
    };
  }

  const fingerprint = fingerprintText(input.text);
  const duplicateOfId = fingerprint
    ? await findCanonicalCopy(db, sender.id, fingerprint, input.sentAt)
    : null;

  const message = await db.message.create({
    data: {
      waMessageId: input.waMessageId,
      groupId: group.id,
      senderId: sender.id,
      sentAt: input.sentAt,
      text: input.text,
      class: null,
      fingerprint,
      duplicateOfId,
    },
  });

  const messageClass = classifyMessage({
    text: input.text,
    senderRole: sender.role,
  });

  await db.message.update({
    where: { id: message.id },
    data: { class: messageClass },
  });

  // A copy is kept for the audit trail and the reach badge, but the canonical
  // message already produced the candidate or signal this text is worth.
  if (duplicateOfId) {
    return { created: true, messageId: message.id, duplicateOfId };
  }

  // Silenced sender: the message is stored and classified, and that is all it
  // does. Weekly agendas and guest lists never became a festa worth having.
  if (sender.muted) {
    return { created: true, messageId: message.id };
  }

  // A season blast announces several festas at once, and each one earns its own
  // row: reading only the first used to catalogue one and drop the rest.
  if (messageClass === "admin_promo") {
    const extracted = extractCandidates(input.text, input.sentAt);
    if (extracted.length > 0) {
      await db.partyCandidate.createMany({
        data: extracted.map((candidate) => ({
          status: "pending" as const,
          name: candidate.name,
          url: candidate.url,
          lotLabel: candidate.lotLabel,
          officialPrice: candidate.officialPrice,
          eventAt: candidate.eventAt,
          platform: candidate.platform,
          excerpt: candidate.excerpt,
          sourceMessageId: message.id,
        })),
      });
    }
  }

  if (messageClass === "pista_oferta" || messageClass === "pista_procura") {
    const upcoming = await db.party.findMany({
      where: { status: "upcoming" },
    });
    const matched = matchParty(
      input.text,
      upcoming.map((party) => ({
        id: party.id,
        name: party.name,
        aliases: party.aliases,
        status: party.status,
      })),
    );

    if (matched) {
      const type: SignalType =
        messageClass === "pista_oferta" ? "offer" : "demand";
      await db.signal.create({
        data: {
          type,
          partyId: matched.id,
          messageId: message.id,
          senderId: sender.id,
        },
      });
      await db.message.update({
        where: { id: message.id },
        data: { partyId: matched.id },
      });
    }
  }

  return { created: true, messageId: message.id };
}

/**
 * Earliest copy of this text from this sender still inside the window, following
 * the chain so copies never point at each other. The window is measured from the
 * canonical message, so reposts day after day each start a fresh intent.
 */
async function findCanonicalCopy(
  db: PrismaClient,
  senderId: string,
  fingerprint: string,
  sentAt: Date,
): Promise<string | null> {
  const prior = await db.message.findFirst({
    where: {
      senderId,
      fingerprint,
      sentAt: {
        gte: new Date(sentAt.getTime() - DEDUPE_WINDOW_MS),
        lte: new Date(sentAt.getTime() + DEDUPE_WINDOW_MS),
      },
    },
    orderBy: { sentAt: "asc" },
    select: {
      id: true,
      sentAt: true,
      duplicateOf: { select: { id: true, sentAt: true } },
    },
  });
  if (!prior) return null;

  const canonical = prior.duplicateOf ?? prior;
  return withinDedupeWindow(canonical.sentAt, sentAt) ? canonical.id : null;
}

function nextSenderRole(
  current: SenderRole | undefined,
  senderIsGroupAdmin: boolean | undefined,
): SenderRole {
  if (current === "pista" || current === "admin") {
    return current;
  }
  if (senderIsGroupAdmin) {
    return "admin";
  }
  return "unknown";
}
