import { Prisma } from "@prisma/client";
import { TZ } from "@/domain/timezone";
import type { Pseudonymizer } from "./pseudonymize";
import { describeRole, type RoleInfo, type SnapshotInfo } from "./read-only";

export const INVENTORY_VERSION = 1;

type Counts = Record<string, number>;

export type Inventory = {
  inventoryVersion: number;
  snapshotAt: string;
  database: { serverVersion: string; timeZone: string; role: RoleInfo };
  schema: {
    missingColumns: string[];
    unexpectedColumns: string[];
    appliedMigrations: string[];
    migrationsNotApplied: string[];
    migrationsUnknownLocally: string[];
    failedMigrations: string[];
  };
  messages: {
    total: number;
    firstSentAt: string | null;
    lastSentAt: string | null;
    firstCreatedAt: string | null;
    lastCreatedAt: string | null;
    byClass: Counts;
    bySenderRole: Counts;
    fromMutedSenders: number;
    duplicates: number;
    dismissed: number;
    withoutFingerprint: number;
    emptyText: number;
    sentAfterSnapshot: number;
    ingestionDelay: {
      p50Seconds: number | null;
      p95Seconds: number | null;
      maxSeconds: number | null;
      overOneHour: number;
      overOneDay: number;
      negative: number;
    };
  };
  coverage: {
    timeZone: string;
    daily: { day: string; weekday: number; messages: number; groups: number }[];
    byWeekday: Record<number, number>;
    daysWithoutMessages: string[];
    /** Nothing records connector uptime, so a silent day is a gap we infer, never one we verified. */
    gapEvidence: "inferred";
  };
  groups: {
    group: string;
    listen: boolean;
    messages: number;
    firstSentAt: string | null;
    lastSentAt: string | null;
  }[];
  senders: { total: number; byRole: Counts; muted: number };
  candidates: {
    byStatus: Counts;
    messagesWithCandidates: number;
    messagesWithMultiple: number;
  };
  links: {
    pistaMessages: number;
    pistaCanonical: number;
    pistaCanonicalLinked: number;
    pistaCanonicalUnlinked: number;
    signalsByType: Counts;
  };
  catalog: {
    partiesByStatus: Counts;
    partiesWithAliases: number;
    firstEventAt: string | null;
    lastEventAt: string | null;
    lots: number;
    lotsWithPrice: number;
  };
  heatSnapshots: {
    total: number;
    parties: number;
    firstComputedAt: string | null;
    lastComputedAt: string | null;
  };
  contextAvailability: {
    replyGraph: boolean;
    quotedMessages: boolean;
    media: boolean;
    operatorAuditLog: boolean;
    historicalUptime: boolean;
  };
  waSession: {
    state: string;
    lastMessageAt: string | null;
    heartbeatAt: string | null;
  } | null;
};

type Db = Prisma.TransactionClient;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

function toCounts(
  rows: { key: string | null; n: number }[],
  nullKey = "unset",
): Counts {
  const out: Counts = {};
  for (const row of rows) out[row.key ?? nullKey] = row.n;
  return out;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function silentDays(days: string[]): string[] {
  if (days.length === 0) return [];
  const seen = new Set(days);
  const out: string[] = [];
  for (let day = days[0]; day <= days[days.length - 1]; day = addDays(day, 1)) {
    if (!seen.has(day)) out.push(day);
  }
  return out;
}

/** Columns the reviewed Prisma model expects, as `Table.column`. */
function expectedColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const model of Prisma.dmmf.datamodel.models) {
    const columns = model.fields
      .filter((field) => field.kind === "scalar" || field.kind === "enum")
      .map((field) => field.dbName ?? field.name);
    tables.set(model.dbName ?? model.name, new Set(columns));
  }
  return tables;
}

async function schemaDrift(
  db: Db,
  localMigrations: string[],
): Promise<Inventory["schema"]> {
  const expected = expectedColumns();
  const actualRows = await db.$queryRaw<{ table: string; column: string }[]>`
    SELECT table_name AS table, column_name AS column
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name IN (${Prisma.join([...expected.keys()])})`;

  const actual = new Map<string, Set<string>>();
  for (const { table, column } of actualRows) {
    if (!actual.has(table)) actual.set(table, new Set());
    actual.get(table)!.add(column);
  }

  const missingColumns: string[] = [];
  const unexpectedColumns: string[] = [];
  for (const [table, columns] of expected) {
    const present = actual.get(table) ?? new Set<string>();
    for (const column of columns)
      if (!present.has(column)) missingColumns.push(`${table}.${column}`);
    for (const column of present)
      if (!columns.has(column)) unexpectedColumns.push(`${table}.${column}`);
  }

  const [{ exists }] = await db.$queryRaw<{ exists: boolean }[]>`
    SELECT to_regclass('_prisma_migrations') IS NOT NULL AS exists`;
  const migrations = exists
    ? await db.$queryRaw<{ name: string; finished: boolean; rolled_back: boolean }[]>`
        SELECT migration_name AS name,
               finished_at IS NOT NULL AS finished,
               rolled_back_at IS NOT NULL AS rolled_back
        FROM _prisma_migrations`
    : [];

  const applied = migrations
    .filter((m) => m.finished && !m.rolled_back)
    .map((m) => m.name)
    .sort();
  const appliedSet = new Set(applied);
  const local = new Set(localMigrations);

  return {
    missingColumns: missingColumns.sort(),
    unexpectedColumns: unexpectedColumns.sort(),
    appliedMigrations: applied,
    migrationsNotApplied: [...local].filter((m) => !appliedSet.has(m)).sort(),
    migrationsUnknownLocally: applied.filter((m) => !local.has(m)),
    failedMigrations: migrations
      .filter((m) => !m.finished && !m.rolled_back)
      .map((m) => m.name)
      .sort(),
  };
}

/**
 * The compact picture of what production actually holds, taken before anyone
 * decides what to export. Aggregates only: no message text, names or WhatsApp
 * ids leave the database, and groups appear by pseudonym.
 */
export async function buildInventory(
  db: Db,
  options: {
    snapshot: SnapshotInfo;
    pseudonymizer: Pseudonymizer;
    localMigrations: string[];
  },
): Promise<Inventory> {
  const { snapshot, pseudonymizer } = options;

  const [[{ server_version, time_zone }], role, schema] = await Promise.all([
    db.$queryRaw<{ server_version: string; time_zone: string }[]>`
      SELECT current_setting('server_version') AS server_version,
             current_setting('TimeZone') AS time_zone`,
    describeRole(db),
    schemaDrift(db, options.localMigrations),
  ]);

  const [totals] = await db.$queryRaw<
    {
      total: number;
      first_sent: Date | null;
      last_sent: Date | null;
      first_created: Date | null;
      last_created: Date | null;
      muted: number;
      duplicates: number;
      dismissed: number;
      no_fingerprint: number;
      empty_text: number;
      future: number;
      p50: number | null;
      p95: number | null;
      max_delay: number | null;
      over_hour: number;
      over_day: number;
      negative: number;
    }[]
  >`
    SELECT count(*)::int AS total,
           min(m."sentAt") AS first_sent, max(m."sentAt") AS last_sent,
           min(m."createdAt") AS first_created, max(m."createdAt") AS last_created,
           count(*) FILTER (WHERE s.muted)::int AS muted,
           count(m."duplicateOfId")::int AS duplicates,
           count(m."dismissedAt")::int AS dismissed,
           count(*) FILTER (WHERE m.fingerprint IS NULL)::int AS no_fingerprint,
           count(*) FILTER (WHERE btrim(m.text) = '')::int AS empty_text,
           count(*) FILTER (WHERE m."sentAt" > ${snapshot.startedAt})::int AS future,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM m."createdAt" - m."sentAt"))::float8 AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM m."createdAt" - m."sentAt"))::float8 AS p95,
           max(extract(epoch FROM m."createdAt" - m."sentAt"))::float8 AS max_delay,
           count(*) FILTER (WHERE m."createdAt" - m."sentAt" > interval '1 hour')::int AS over_hour,
           count(*) FILTER (WHERE m."createdAt" - m."sentAt" > interval '1 day')::int AS over_day,
           count(*) FILTER (WHERE m."createdAt" < m."sentAt")::int AS negative
    FROM "Message" m JOIN "Sender" s ON s.id = m."senderId"`;

  const [byClass, bySenderRole, daily, groups, senderRoles, senderTotals] =
    await Promise.all([
      db.$queryRaw<{ key: string | null; n: number }[]>`
      SELECT class::text AS key, count(*)::int AS n FROM "Message" GROUP BY 1`,
      db.$queryRaw<{ key: string; n: number }[]>`
      SELECT s.role::text AS key, count(*)::int AS n
      FROM "Message" m JOIN "Sender" s ON s.id = m."senderId" GROUP BY 1`,
      db.$queryRaw<
        { day: string; weekday: number; messages: number; groups: number }[]
      >`
      SELECT to_char(local_day, 'YYYY-MM-DD') AS day,
             extract(isodow FROM local_day)::int AS weekday,
             count(*)::int AS messages,
             count(DISTINCT "groupId")::int AS groups
      FROM (
        SELECT date_trunc('day', ("sentAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}) AS local_day, "groupId"
        FROM "Message"
      ) d
      GROUP BY local_day ORDER BY local_day`,
      db.$queryRaw<
        {
          wa_id: string;
          listen: boolean;
          messages: number;
          first_sent: Date | null;
          last_sent: Date | null;
        }[]
      >`
      SELECT g."waId" AS wa_id, g.listen, count(m.id)::int AS messages,
             min(m."sentAt") AS first_sent, max(m."sentAt") AS last_sent
      FROM "Group" g LEFT JOIN "Message" m ON m."groupId" = g.id
      GROUP BY g.id ORDER BY messages DESC`,
      db.$queryRaw<{ key: string; n: number }[]>`
      SELECT role::text AS key, count(*)::int AS n FROM "Sender" GROUP BY 1`,
      db.$queryRaw<{ total: number; muted: number }[]>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE muted)::int AS muted FROM "Sender"`,
    ]);

  const [candidateStatus, [candidateMessages], [links], signalTypes] =
    await Promise.all([
      db.$queryRaw<{ key: string; n: number }[]>`
      SELECT status::text AS key, count(*)::int AS n FROM "PartyCandidate" GROUP BY 1`,
      db.$queryRaw<{ with_any: number; with_many: number }[]>`
      SELECT count(*)::int AS with_any, count(*) FILTER (WHERE n > 1)::int AS with_many
      FROM (SELECT count(*) AS n FROM "PartyCandidate" GROUP BY "sourceMessageId") c`,
      db.$queryRaw<{ pista: number; canonical: number; linked: number }[]>`
      SELECT count(*)::int AS pista,
             count(*) FILTER (WHERE "duplicateOfId" IS NULL)::int AS canonical,
             count(*) FILTER (WHERE "duplicateOfId" IS NULL AND "partyId" IS NOT NULL)::int AS linked
      FROM "Message" WHERE class IN ('pista_oferta', 'pista_procura')`,
      db.$queryRaw<{ key: string; n: number }[]>`
      SELECT type::text AS key, count(*)::int AS n FROM "Signal" GROUP BY 1`,
    ]);

  const [partyStatus, [parties], [lots], [heat], sessions] = await Promise.all([
    db.$queryRaw<{ key: string; n: number }[]>`
      SELECT status::text AS key, count(*)::int AS n FROM "Party" GROUP BY 1`,
    db.$queryRaw<
      { with_aliases: number; first_event: Date | null; last_event: Date | null }[]
    >`
      SELECT count(*) FILTER (WHERE cardinality(aliases) > 0)::int AS with_aliases,
             min("eventAt") AS first_event, max("eventAt") AS last_event
      FROM "Party"`,
    db.$queryRaw<{ total: number; priced: number }[]>`
      SELECT count(*)::int AS total, count("officialPrice")::int AS priced FROM "Lot"`,
    db.$queryRaw<
      { total: number; parties: number; first: Date | null; last: Date | null }[]
    >`
      SELECT count(*)::int AS total, count(DISTINCT "partyId")::int AS parties,
             min("computedAt") AS first, max("computedAt") AS last
      FROM "HeatSnapshot"`,
    db.$queryRaw<
      { state: string; last_message_at: Date | null; heartbeat_at: Date | null }[]
    >`
      SELECT state::text AS state, "lastMessageAt" AS last_message_at, "heartbeatAt" AS heartbeat_at
      FROM "WaSession" WHERE id = 'wa'`,
  ]);

  const byWeekday: Record<number, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    7: 0,
  };
  for (const row of daily) byWeekday[row.weekday] += row.messages;

  const [session] = sessions;

  return {
    inventoryVersion: INVENTORY_VERSION,
    snapshotAt: snapshot.startedAt.toISOString(),
    database: { serverVersion: server_version, timeZone: time_zone, role },
    schema,
    messages: {
      total: totals.total,
      firstSentAt: iso(totals.first_sent),
      lastSentAt: iso(totals.last_sent),
      firstCreatedAt: iso(totals.first_created),
      lastCreatedAt: iso(totals.last_created),
      byClass: toCounts(byClass, "unclassified"),
      bySenderRole: toCounts(bySenderRole),
      fromMutedSenders: totals.muted,
      duplicates: totals.duplicates,
      dismissed: totals.dismissed,
      withoutFingerprint: totals.no_fingerprint,
      emptyText: totals.empty_text,
      sentAfterSnapshot: totals.future,
      ingestionDelay: {
        p50Seconds: totals.p50,
        p95Seconds: totals.p95,
        maxSeconds: totals.max_delay,
        overOneHour: totals.over_hour,
        overOneDay: totals.over_day,
        negative: totals.negative,
      },
    },
    coverage: {
      timeZone: TZ,
      daily,
      byWeekday,
      daysWithoutMessages: silentDays(daily.map((row) => row.day)),
      gapEvidence: "inferred",
    },
    groups: groups.map((g) => ({
      group: pseudonymizer.id("group", g.wa_id),
      listen: g.listen,
      messages: g.messages,
      firstSentAt: iso(g.first_sent),
      lastSentAt: iso(g.last_sent),
    })),
    senders: {
      total: senderTotals[0].total,
      byRole: toCounts(senderRoles),
      muted: senderTotals[0].muted,
    },
    candidates: {
      byStatus: toCounts(candidateStatus),
      messagesWithCandidates: candidateMessages.with_any,
      messagesWithMultiple: candidateMessages.with_many,
    },
    links: {
      pistaMessages: links.pista,
      pistaCanonical: links.canonical,
      pistaCanonicalLinked: links.linked,
      pistaCanonicalUnlinked: links.canonical - links.linked,
      signalsByType: toCounts(signalTypes),
    },
    catalog: {
      partiesByStatus: toCounts(partyStatus),
      partiesWithAliases: parties.with_aliases,
      firstEventAt: iso(parties.first_event),
      lastEventAt: iso(parties.last_event),
      lots: lots.total,
      lotsWithPrice: lots.priced,
    },
    heatSnapshots: {
      total: heat.total,
      parties: heat.parties,
      firstComputedAt: iso(heat.first),
      lastComputedAt: iso(heat.last),
    },
    // The reviewed schema stores none of these; the export has to say so rather than imply them.
    contextAvailability: {
      replyGraph: false,
      quotedMessages: false,
      media: false,
      operatorAuditLog: false,
      historicalUptime: false,
    },
    waSession: session
      ? {
          state: session.state,
          lastMessageAt: iso(session.last_message_at),
          heartbeatAt: iso(session.heartbeat_at),
        }
      : null,
  };
}
