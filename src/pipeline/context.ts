import type { PrismaClient } from "@prisma/client";
import type { ContextMessage } from "./interpreter";

const HOUR_MS = 3_600_000;

/** What an interpreter and a labeller both get to read before a message. */
export const CONTEXT_WINDOWS = {
  groupMs: 24 * HOUR_MS,
  senderMs: 7 * 24 * HOUR_MS,
  cap: 30,
} as const;

/**
 * The same group's last day and the same sender's last week, newest first.
 * Strictly earlier: a message sent the same instant was not there to read.
 */
export async function loadContext(
  db: PrismaClient,
  message: { id: string; groupId: string; senderId: string; sentAt: Date },
): Promise<ContextMessage[]> {
  const before = (ms: number) => ({
    lt: message.sentAt,
    gte: new Date(message.sentAt.getTime() - ms),
  });
  const select = { id: true, text: true, sentAt: true, groupId: true, senderId: true };
  const [group, sender] = await Promise.all([
    db.message.findMany({
      where: { groupId: message.groupId, sentAt: before(CONTEXT_WINDOWS.groupMs) },
      orderBy: { sentAt: "desc" },
      take: CONTEXT_WINDOWS.cap,
      select,
    }),
    db.message.findMany({
      where: { senderId: message.senderId, sentAt: before(CONTEXT_WINDOWS.senderMs) },
      orderBy: { sentAt: "desc" },
      take: CONTEXT_WINDOWS.cap,
      select,
    }),
  ]);
  const byId = new Map([...group, ...sender].map((m) => [m.id, m]));
  return [...byId.values()]
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime() || a.id.localeCompare(b.id))
    .map((m) => ({
      id: m.id,
      sentAt: m.sentAt,
      text: m.text,
      sameGroup: m.groupId === message.groupId,
      sameSender: m.senderId === message.senderId,
    }));
}
