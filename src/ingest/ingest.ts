import type { PrismaClient, SenderRole, SignalType } from "@prisma/client";
import { classifyMessage } from "@/domain/classify";
import { extractCandidate } from "@/domain/extract";
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
): Promise<{ created: boolean; messageId: string }> {
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
    return { created: false, messageId: existing.id };
  }

  const message = await db.message.create({
    data: {
      waMessageId: input.waMessageId,
      groupId: group.id,
      senderId: sender.id,
      sentAt: input.sentAt,
      text: input.text,
      class: null,
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

  if (messageClass === "admin_promo") {
    const extracted = extractCandidate(input.text, input.sentAt);
    await db.partyCandidate.create({
      data: {
        status: "pending",
        name: extracted.name,
        url: extracted.url,
        lotLabel: extracted.lotLabel,
        officialPrice: extracted.officialPrice,
        eventAt: extracted.eventAt,
        platform: extracted.platform,
        sourceMessageId: message.id,
      },
    });
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
