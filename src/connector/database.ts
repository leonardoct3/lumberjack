export type DatabaseConnectResult =
  | { ok: true }
  | { ok: false; detail: string };

export async function tryConnectDatabase(
  connect: () => Promise<void>,
): Promise<DatabaseConnectResult> {
  try {
    await connect();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "database-unavailable",
    };
  }
}
