import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import makeWASocket, {
  DisconnectReason,
  isJidGroup,
  useMultiFileAuthState as getMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { tryConnectDatabase } from "@/connector/database";
import { writeWaStatus } from "@/connector/status";
import { prisma } from "@/db/client";
import { isListenDay } from "@/domain/timezone";
import { ingestRawMessage } from "@/ingest/ingest";

try {
  process.loadEnvFile();
} catch {
  // .env is optional when the shell already exports vars
}

const authDir = resolve(process.env.WA_AUTH_DIR ?? "./data/wa-auth");
const MAX_RECONNECT_ATTEMPTS = 8;
const RECONNECT_BASE_DELAY_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const STATUS_WRITE_THROTTLE_MS = 30_000;
const SHUTDOWN_FLUSH_MS = 2_000;

let skippedListenDay = false;
let reconnectAttempts = 0;
const groupMetaCache = new Map<
  string,
  Awaited<ReturnType<WASocket["groupMetadata"]>>
>();

let statusState: "connected" | "qr" | "disconnected" = "disconnected";
let statusDetail: string | undefined;
let statusQr: string | undefined;
let lastMessageAt: string | undefined;
let heartbeatAt: string | undefined;
let statusWrittenAt = 0;

async function flushStatus(): Promise<void> {
  statusWrittenAt = Date.now();
  heartbeatAt = new Date().toISOString();
  try {
    await writeWaStatus(prisma, {
      state: statusState,
      ...(lastMessageAt ? { lastMessageAt } : {}),
      ...(heartbeatAt ? { heartbeatAt } : {}),
      ...(statusDetail ? { detail: statusDetail } : {}),
      ...(statusQr ? { qr: statusQr } : {}),
    });
  } catch (err) {
    console.error("wa status write failed", err);
  }
}

async function persistStatus(
  state: "connected" | "qr" | "disconnected",
  detail?: string,
  qr?: string | null,
): Promise<void> {
  statusState = state;
  statusDetail = detail;
  if (qr === null) {
    statusQr = undefined;
  } else if (qr !== undefined) {
    statusQr = qr;
  } else if (state !== "qr") {
    statusQr = undefined;
  }
  await flushStatus();
}

async function flushStatusBeforeExit(): Promise<void> {
  await Promise.race([
    flushStatus(),
    new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_FLUSH_MS)),
  ]);
}

/**
 * Baileys rejects promises from inside its own socket handlers — an init query timing
 * out is enough — and Node turns that into a process exit. A transient WhatsApp hiccup
 * must not stop ingestion: log it and stay up. `connection.update` still drives
 * reconnects, and `lastMessageAt` exposes a socket that went quiet for real.
 */
process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection; staying up", reason);
});

/** A synchronous throw leaves unknown state: record it and let the supervisor restart. */
process.on("uncaughtException", (err) => {
  console.error("uncaught exception; exiting", err);
  void (async () => {
    statusState = "disconnected";
    statusDetail = "crash";
    statusQr = undefined;
    await flushStatusBeforeExit();
    process.exit(1);
  })();
});

/** Ctrl+C or a platform stop, so the board stops claiming the monitor is connected. */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      statusState = "disconnected";
      statusDetail = "stopped";
      statusQr = undefined;
      await flushStatusBeforeExit();
      process.exit(0);
    })();
  });
}

setInterval(() => {
  void flushStatus();
}, HEARTBEAT_INTERVAL_MS).unref();

/**
 * Raw socket liveness, before any group or listen-day filter: an open connection that
 * stops delivering messages is otherwise indistinguishable from a healthy one.
 */
function markMessageSeen(): void {
  const now = Date.now();
  lastMessageAt = new Date(now).toISOString();
  if (now - statusWrittenAt < STATUS_WRITE_THROTTLE_MS) return;
  void flushStatus();
}

function extractText(msg: WAMessage): string {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    ""
  );
}

function sentAtOf(msg: WAMessage): Date {
  const raw = Number(msg.messageTimestamp ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return new Date();
  return new Date(raw > 1e12 ? raw : raw * 1000);
}

async function upsertGroup(waId: string, name: string) {
  try {
    return await prisma.group.upsert({
      where: { waId },
      create: { waId, name, listen: false },
      update: { name },
    });
  } catch (err) {
    console.error("group upsert failed", waId, err);
    return null;
  }
}

async function handleMessage(sock: WASocket, msg: WAMessage): Promise<void> {
  try {
    const jid = msg.key.remoteJid;
    if (!jid || !isJidGroup(jid)) return;

    const meta = await cachedGroupMetadata(sock, jid);
    const groupName = meta?.subject ?? jid;
    const group = await upsertGroup(jid, groupName);
    if (!group?.listen) return;

    const now = new Date();
    if (!isListenDay(now)) {
      if (!skippedListenDay) {
        console.log("not a listen day; staying connected without ingest");
        skippedListenDay = true;
      }
      return;
    }
    skippedListenDay = false;

    const text = extractText(msg);
    if (!text) return;

    const senderWaId = msg.key.participant ?? jid;
    const participant = meta?.participants.find((p) => p.id === senderWaId);
    const ingested = await ingestRawMessage(prisma, {
      waMessageId: msg.key.id ?? `${jid}:${sentAtOf(msg).toISOString()}`,
      groupWaId: jid,
      groupName,
      senderWaId,
      senderName: msg.pushName ?? null,
      sentAt: sentAtOf(msg),
      text,
      senderIsGroupAdmin:
        participant?.admin === "admin" || participant?.admin === "superadmin",
    });
    if (ingested.duplicateOfId) {
      console.log("cross-post collapsed", groupName, msg.pushName ?? senderWaId);
    }
  } catch (err) {
    console.error("message ingest failed", msg.key.id, err);
  }
}

async function connectSocket(): Promise<void> {
  const { state, saveCreds } = await getMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      void persistStatus("qr", undefined, qr);
    }
    if (connection === "open") {
      reconnectAttempts = 0;
      void persistStatus("connected", undefined, null);
      void syncGroups(sock);
    }
    if (connection === "close") {
      const code = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;
      void persistStatus(
        "disconnected",
        String(code ?? lastDisconnect?.error ?? "closed"),
        null,
      );
      if (code !== DisconnectReason.loggedOut) {
        scheduleReconnect();
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages }) => {
    markMessageSeen();
    void (async () => {
      for (const msg of messages) {
        await handleMessage(sock, msg);
      }
    })();
  });
}

async function cachedGroupMetadata(sock: WASocket, jid: string) {
  const cached = groupMetaCache.get(jid);
  if (cached) return cached;
  const meta = await sock.groupMetadata(jid).catch(() => null);
  if (meta) groupMetaCache.set(jid, meta);
  return meta;
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    void persistStatus("disconnected", "reconnect-exhausted", null);
    return;
  }
  const delayMs = RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts;
  reconnectAttempts += 1;
  setTimeout(() => {
    void connectSocket();
  }, delayMs);
}

async function syncGroups(sock: WASocket): Promise<void> {
  let groups: Awaited<ReturnType<WASocket["groupFetchAllParticipating"]>>;
  try {
    groups = await sock.groupFetchAllParticipating();
  } catch (err) {
    console.error("group listing failed", err);
    return;
  }
  for (const [id, meta] of Object.entries(groups)) {
    groupMetaCache.set(id, meta);
    await upsertGroup(id, meta.subject ?? id);
  }
}

async function main(): Promise<void> {
  const db = await tryConnectDatabase(() => prisma.$connect());
  if (!db.ok) {
    console.error("database unavailable", db.detail);
    await persistStatus("disconnected", db.detail, null);
    return;
  }
  if (!existsSync(join(authDir, "creds.json"))) {
    await persistStatus("qr");
  }
  await connectSocket();
}

main().catch((err) => {
  console.error(err);
  void persistStatus(
    "disconnected",
    err instanceof Error ? err.message : String(err),
    null,
  ).finally(() => {
    process.exitCode = 1;
  });
});
