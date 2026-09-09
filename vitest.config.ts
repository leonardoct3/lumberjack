import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests truncate every table, so they must never reach the dev database.
const DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://lumberjack:lumberjack@localhost:5432/lumberjack_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { DATABASE_URL },
    setupFiles: ["tests/helpers/guard-test-db.ts"],
    // Files share a single Postgres schema and truncate it between cases.
    fileParallelism: false,
  },
});
