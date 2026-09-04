import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import makeWASocket, {
  DisconnectReason,
  isJidGroup,
  useMultiFileAuthState,
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
const statusPath = resolve(process.env.WA_STATUS_PATH ?? "./data/wa-status.json");
let skippedListenDay = false;

function persistStatus(
  state: "connected" | "qr" | "disconnected",
  detail?: string,
): void {
  writeWaStatus(statusPath, {
    state,
    updatedAt: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  });
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

    const meta = await sock.groupMetadata(jid).catch(() => null);
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
    await ingestRawMessage(prisma, {
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
  } catch (err) {
    console.error("message ingest failed", msg.key.id, err);
  }
}

async function connectSocket(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      persistStatus("qr");
    }
    if (connection === "open") {
      persistStatus("connected");
      void syncGroups(sock);
    }
    if (connection === "close") {
      const code = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;
      persistStatus(
        "disconnected",
        String(code ?? lastDisconnect?.error ?? "closed"),
      );
      if (code !== DisconnectReason.loggedOut) {
        void connectSocket();
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages }) => {
    void (async () => {
      for (const msg of messages) {
        await handleMessage(sock, msg);
      }
    })();
  });
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
    await upsertGroup(id, meta.subject ?? id);
  }
}

async function main(): Promise<void> {
  if (!existsSync(join(authDir, "creds.json"))) {
    persistStatus("qr");
  }
  const db = await tryConnectDatabase(() => prisma.$connect());
  if (!db.ok) {
    console.error("database unavailable", db.detail);
    persistStatus("disconnected", db.detail);
    return;
  }
  await connectSocket();
}

main().catch((err) => {
  console.error(err);
  persistStatus("disconnected", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
