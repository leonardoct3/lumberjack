import type { PrismaClient } from "@prisma/client";

export type WaStatus = {
  state: "connected" | "qr" | "disconnected";
  updatedAt: string;
  /** Last message event Baileys delivered, whatever group it came from. */
  lastMessageAt?: string;
  /** Periodic connector pulse so a dead process cannot stay "connected" forever. */
  heartbeatAt?: string;
  detail?: string;
  /** Raw Baileys QR payload; present only while `state === "qr"`. */
  qr?: string;
};

const MISSING_SESSION: WaStatus = {
  state: "disconnected",
  updatedAt: new Date(0).toISOString(),
  detail: "missing-session",
};

export async function readWaStatus(db: PrismaClient): Promise<WaStatus> {
  const row = await db.waSession.findUnique({ where: { id: "wa" } });
  if (!row) return MISSING_SESSION;

  return {
    state: row.state,
    updatedAt: row.updatedAt.toISOString(),
    ...(row.lastMessageAt
      ? { lastMessageAt: row.lastMessageAt.toISOString() }
      : {}),
    ...(row.heartbeatAt ? { heartbeatAt: row.heartbeatAt.toISOString() } : {}),
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.qr ? { qr: row.qr } : {}),
  };
}

export async function writeWaStatus(
  db: PrismaClient,
  status: Omit<WaStatus, "updatedAt">,
): Promise<void> {
  const data = {
    state: status.state,
    detail: status.detail ?? null,
    qr: status.qr ?? null,
    lastMessageAt: status.lastMessageAt
      ? new Date(status.lastMessageAt)
      : null,
    heartbeatAt: status.heartbeatAt ? new Date(status.heartbeatAt) : null,
  };

  await db.waSession.upsert({
    where: { id: "wa" },
    create: { id: "wa", ...data },
    update: data,
  });
}
