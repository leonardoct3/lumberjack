import type { Prisma } from "@prisma/client";
import { TZ } from "@/domain/timezone";
import type { Pseudonymizer } from "./pseudonymize";
import { describeRole, type RoleInfo, type SnapshotInfo } from "./read-only";
import {
  addCounts,
  emptyRedactionCounts,
  REDACTION_VERSION,
  redactText,
  type RedactionCounts,
} from "./redact";
import type { DatasetSink, FileSummary } from "./sink";

export const EXPORT_VERSION = 1;

const PAGE = 500;
const DAY_MS = 86_400_000;

export type ExportSource = {
  /** Host, port and database name; never the credentials. */
  target: string;
  repoRevision: string;
  /** What Railway reports as deployed, or "unverified" when it could not be read. */
  deployedRevision: string;
};

export type ExportOptions = {
  snapshot: SnapshotInfo;
  pseudonymizer: Pseudonymizer;
  interval: { start: Date; end: Date };
  /** Earlier days exported alongside the interval, so its messages can be read in context. */
  contextDays: number;
  sink: DatasetSink;
  source: ExportSource;
};

export type ExportManifest = {
  exportVersion: number;
  redactionVersion: number;
  createdAt: string;
  snapshotAt: string;
  consistency: string;
  timeZone: string;
  interval: { start: string; end: string };
  contextStart: string;
  source: ExportSource;
  serverVersion: string;
  appliedMigrations: string[];
  role: RoleInfo;
  keyFingerprint: string;
  files: FileSummary[];
  redaction: RedactionCounts;
  excluded: string[];
  limitations: string[];
};

export type ExportedMessage = {
  id: string;
  group: string;
  sender: string;
  sentAt: string;
  createdAt: string;
  text: string;
  storedClass: string | null;
  partyId: string | null;
  duplicateOf: string | null;
  dismissed: boolean;
  inInterval: boolean;
  senderRoleNow: string;
  senderMutedNow: boolean;
};

const EXCLUDED = [
  "WaSession",
  "Message.waMessageId",
  "Message.fingerprint",
  "Group.waId",
  "Group.name",
  "Sender.waId",
  "Sender.name",
  "Party.notes",
];

const LIMITATIONS = [
  "Sender role and muted state are current values (senderRoleNow, senderMutedNow), not the values at message time.",
  "Group listen state is current (listenNow); it does not prove which groups were monitored historically.",
  "Party names, aliases and status come from the current catalog and may hold knowledge added after a message was sent; there is no audit log to replay it.",
  "Stored classes, party links, candidates and signals are the existing rules' predictions and operator decisions, not gold labels.",
  "Signals do not record whether a link was automatic or manual.",
  "Reply/quoted context and media are not captured by the schema.",
  "Name redaction is best-effort: it removes the WhatsApp push names of exported senders and groups, not every name a message may contain.",
  "Days with no messages are inferred capture gaps or policy gaps; connector uptime is not recorded.",
];

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * Writes the benchmark interval, the context before it and the catalog it is
 * read against, all from one snapshot. Every identity is pseudonymised and every
 * free-text field redacted on the way out; nothing raw is written anywhere.
 */
export async function exportDataset(
  db: Prisma.TransactionClient,
  options: ExportOptions,
): Promise<ExportManifest> {
  const { snapshot, pseudonymizer, interval, sink } = options;
  if (!snapshot.readOnly || snapshot.isolation !== "repeatable read") {
    throw new Error(
      "exportDataset must run inside withReadOnlySnapshot (a read-only snapshot).",
    );
  }

  const contextStart = new Date(
    interval.start.getTime() - options.contextDays * DAY_MS,
  );
  const window = { gte: contextStart, lt: interval.end };
  const redaction = emptyRedactionCounts();

  const [senders, groups, parties, candidateNames] = await Promise.all([
    db.sender.findMany({
      where: { messages: { some: { sentAt: window } } },
      select: { waId: true, name: true, role: true, muted: true },
      orderBy: { waId: "asc" },
    }),
    db.group.findMany({
      where: { messages: { some: { sentAt: window } } },
      select: { waId: true, name: true, listen: true },
      orderBy: { waId: "asc" },
    }),
    db.party.findMany({
      orderBy: [{ eventAt: "asc" }, { id: "asc" }],
      include: { lots: true },
    }),
    db.partyCandidate.findMany({
      where: { source: { sentAt: window } },
      select: { name: true },
    }),
  ]);

  const redactOptions = {
    knownNames: [...senders.map((s) => s.name ?? ""), ...groups.map((g) => g.name)],
    protectedTerms: [
      ...parties.flatMap((p) => [p.name, ...p.aliases]),
      ...candidateNames.map((c) => c.name ?? ""),
    ],
  };
  const redact = (text: string | null) => {
    if (text == null) return null;
    const result = redactText(text, redactOptions);
    addCounts(redaction, result.counts);
    return result.text;
  };

  const files: FileSummary[] = [];

  const messageFile = sink.file("messages.jsonl");
  const exportedIds: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await db.message.findMany({
      where: { sentAt: window },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        group: { select: { waId: true } },
        sender: { select: { waId: true, role: true, muted: true } },
      },
    });
    for (const m of page) {
      const record: ExportedMessage = {
        id: pseudonymizer.id("message", m.id),
        group: pseudonymizer.id("group", m.group.waId),
        sender: pseudonymizer.id("sender", m.sender.waId),
        sentAt: m.sentAt.toISOString(),
        createdAt: m.createdAt.toISOString(),
        text: redact(m.text)!,
        storedClass: m.class,
        partyId: m.partyId,
        duplicateOf: pseudonymizer.optionalId("message", m.duplicateOfId),
        dismissed: m.dismissedAt != null,
        inInterval: m.sentAt >= interval.start,
        senderRoleNow: m.sender.role,
        senderMutedNow: m.sender.muted,
      };
      messageFile.write(record);
      exportedIds.push(m.id);
    }
    if (page.length < PAGE) break;
    cursor = page[page.length - 1].id;
  }
  files.push(await messageFile.close());

  const groupFile = sink.file("groups.jsonl");
  for (const g of groups)
    groupFile.write({ id: pseudonymizer.id("group", g.waId), listenNow: g.listen });
  files.push(await groupFile.close());

  const senderFile = sink.file("senders.jsonl");
  for (const s of senders) {
    senderFile.write({
      id: pseudonymizer.id("sender", s.waId),
      roleNow: s.role,
      mutedNow: s.muted,
    });
  }
  files.push(await senderFile.close());

  const partyFile = sink.file("parties.jsonl");
  const lotFile = sink.file("lots.jsonl");
  for (const p of parties) {
    partyFile.write({
      id: p.id,
      name: p.name,
      aliases: p.aliases,
      eventAt: iso(p.eventAt),
      statusNow: p.status,
      createdAt: iso(p.createdAt),
    });
    for (const lot of p.lots) {
      lotFile.write({
        id: lot.id,
        partyId: lot.partyId,
        label: lot.label,
        openedAt: iso(lot.openedAt),
        closedAt: iso(lot.closedAt),
        officialPrice: lot.officialPrice,
        url: redact(lot.url),
        platform: lot.platform,
      });
    }
  }
  files.push(await partyFile.close(), await lotFile.close());

  const [candidates, signals, heat] = await Promise.all([
    db.partyCandidate.findMany({
      where: { sourceMessageId: { in: exportedIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.signal.findMany({
      where: { messageId: { in: exportedIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { sender: { select: { waId: true } } },
    }),
    db.heatSnapshot.findMany({
      where: { computedAt: window },
      orderBy: [{ computedAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const candidateFile = sink.file("candidates.jsonl");
  for (const c of candidates) {
    candidateFile.write({
      id: c.id,
      sourceMessage: pseudonymizer.id("message", c.sourceMessageId),
      status: c.status,
      name: c.name,
      url: redact(c.url),
      lotLabel: c.lotLabel,
      officialPrice: c.officialPrice,
      eventAt: iso(c.eventAt),
      platform: c.platform,
      excerpt: redact(c.excerpt),
      createdAt: iso(c.createdAt),
    });
  }
  files.push(await candidateFile.close());

  const signalFile = sink.file("signals.jsonl");
  for (const s of signals) {
    signalFile.write({
      id: s.id,
      type: s.type,
      partyId: s.partyId,
      message: pseudonymizer.id("message", s.messageId),
      sender: pseudonymizer.id("sender", s.sender.waId),
      createdAt: iso(s.createdAt),
    });
  }
  files.push(await signalFile.close());

  const heatFile = sink.file("heat-snapshots.jsonl");
  for (const { id, ...snapshotRow } of heat) {
    heatFile.write({ id, ...snapshotRow, computedAt: iso(snapshotRow.computedAt) });
  }
  files.push(await heatFile.close());

  const [[{ server_version }], migrations, role] = await Promise.all([
    db.$queryRaw<
      { server_version: string }[]
    >`SELECT current_setting('server_version') AS server_version`,
    db.$queryRaw<{ name: string }[]>`
      SELECT migration_name AS name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    describeRole(db),
  ]);

  return {
    exportVersion: EXPORT_VERSION,
    redactionVersion: REDACTION_VERSION,
    createdAt: new Date().toISOString(),
    snapshotAt: snapshot.startedAt.toISOString(),
    consistency: "single read-only repeatable-read snapshot",
    timeZone: TZ,
    interval: { start: interval.start.toISOString(), end: interval.end.toISOString() },
    contextStart: contextStart.toISOString(),
    source: options.source,
    serverVersion: server_version,
    appliedMigrations: migrations.map((m) => m.name),
    role,
    keyFingerprint: pseudonymizer.keyFingerprint,
    files,
    redaction,
    excluded: EXCLUDED,
    limitations: role.canWrite
      ? [
          ...LIMITATIONS,
          `The export role (${role.user}) can write; only the read-only transaction prevented writes.`,
        ]
      : LIMITATIONS,
  };
}
