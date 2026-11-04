import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "../..");

/** Resolves symlinks through the deepest part of the path that already exists. */
function realish(target: string): string {
  let existing = path.resolve(target);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    rest.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  return path.join(realpathSync(existing), ...rest);
}

/**
 * Exports hold real messages, and the key undoes the pseudonyms, so neither may
 * live where a `git add .` could pick them up.
 */
export function assertOutsideRepo(
  target: string,
  repoRoot: string = REPO_ROOT,
): string {
  const resolved = realish(target);
  const root = realish(repoRoot);
  const relative = path.relative(root, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(
      `Refusing ${resolved}: benchmark data and keys must live outside the repository.`,
    );
  }
  return resolved;
}

export function loadPseudonymKey(
  env: Record<string, string | undefined> = process.env,
  repoRoot: string = REPO_ROOT,
): string {
  const file = env.BENCH_PSEUDONYM_KEY_FILE;
  if (!file) {
    throw new Error(
      "Set BENCH_PSEUDONYM_KEY_FILE to a file outside the repository holding a random key, " +
        "for example one written by `openssl rand -hex 32`.",
    );
  }
  return readFileSync(assertOutsideRepo(file, repoRoot), "utf8").trim();
}
