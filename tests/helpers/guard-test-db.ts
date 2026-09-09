const url = process.env.DATABASE_URL ?? "";
const database = url.split("/").pop()?.split("?")[0] ?? "";

if (!database.endsWith("_test")) {
  throw new Error(
    `Refusing to run tests against "${database || "an unset DATABASE_URL"}". ` +
      "The suite truncates every table, so it only accepts a database whose name ends in _test. " +
      "Run `npm run db:test:setup` and keep DATABASE_URL_TEST pointed at that database.",
  );
}
