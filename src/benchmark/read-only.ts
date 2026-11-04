import type { Prisma, PrismaClient } from "@prisma/client";

export type SnapshotInfo = {
  isolation: string;
  readOnly: boolean;
  /** Database clock at the snapshot, the cutoff every exported row is consistent with. */
  startedAt: Date;
};

export type SnapshotOptions = {
  /** Whole-transaction budget: a long repeatable read pins old row versions in production. */
  timeoutMs?: number;
  statementTimeoutMs?: number;
};

/**
 * Everything the benchmark reads goes through here. The transaction is made
 * read-only by Postgres itself, not by convention, so a bug in an export can
 * fail but cannot write.
 */
export async function withReadOnlySnapshot<T>(
  db: PrismaClient,
  fn: (tx: Prisma.TransactionClient, snapshot: SnapshotInfo) => Promise<T>,
  options: SnapshotOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const statementTimeoutMs = options.statementTimeoutMs ?? 30_000;

  return db.$transaction(
    async (tx) => {
      // Has to be the first statement of the transaction, or Postgres rejects it.
      await tx.$executeRawUnsafe(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`;

      const [state] = await tx.$queryRaw<
        { isolation: string; read_only: string; started_at: Date }[]
      >`SELECT current_setting('transaction_isolation') AS isolation,
               current_setting('transaction_read_only') AS read_only,
               transaction_timestamp() AS started_at`;
      if (state.read_only !== "on") {
        throw new Error(
          "Refusing to continue: the snapshot transaction is not read-only.",
        );
      }

      return fn(tx, {
        isolation: state.isolation,
        readOnly: true,
        startedAt: state.started_at,
      });
    },
    { timeout: timeoutMs, maxWait: 10_000 },
  );
}

export type RoleInfo = {
  user: string;
  superuser: boolean;
  /** True means the read-only transaction is the only thing standing between an export and a write. */
  canWrite: boolean;
};

export async function describeRole(
  db: PrismaClient | Prisma.TransactionClient,
): Promise<RoleInfo> {
  const [row] = await db.$queryRaw<
    { user: string; superuser: boolean; can_write: boolean }[]
  >`SELECT current_user AS user,
           r.rolsuper AS superuser,
           r.rolsuper OR EXISTS (
             SELECT 1 FROM information_schema.tables t
             WHERE t.table_schema = 'public'
               AND (has_table_privilege(current_user, format('%I.%I', t.table_schema, t.table_name), 'INSERT')
                 OR has_table_privilege(current_user, format('%I.%I', t.table_schema, t.table_name), 'UPDATE')
                 OR has_table_privilege(current_user, format('%I.%I', t.table_schema, t.table_name), 'DELETE'))
           ) AS can_write
    FROM pg_roles r WHERE r.rolname = current_user`;
  return { user: row.user, superuser: row.superuser, canWrite: row.can_write };
}
