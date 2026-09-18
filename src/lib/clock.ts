/** Kept behind a seam so request-time values are explicit and testable. */
export function now(): number {
  return Date.now();
}
