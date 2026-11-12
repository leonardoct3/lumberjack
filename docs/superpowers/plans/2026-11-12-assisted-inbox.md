# Assisted Inbox Implementation Plan

> Executed inline in the session that wrote it. Spec: `docs/superpowers/specs/2026-11-12-assisted-inbox-design.md`.

**Goal:** Show shadow resolution proposals as reviewable suggestions in the Inbox, with clustered bulk linking, undo and recorded feedback.

**Architecture:** A pure suggestion module turns stored proposals into per-message suggestions and clusters; a loader reads the accepted resolve run per message. Server actions keep calling the existing catalog functions and record a `ProposalReview` afterwards. The page reads the flag and passes suggestions to the client components.

**Tech stack:** Next.js 16 server actions, Prisma 6 on Postgres, zod 4, Vitest, sonner toasts.

## Global constraints

- `PIPELINE_INBOX` defaults to `off`; with `off`, rendering and writes are unchanged.
- Nothing links without an operator click.
- Migration is additive only.
- Production migrations apply on deploy; no manual production writes.

---

### Task 1: Flag

- Modify `src/pipeline/config.ts`: `PIPELINE_INBOX: z.enum(["off", "suggest"]).default("off")`, exposed as `config.inbox`. Add `inboxMode(env)`, which returns `off` when the configuration does not parse.
- Test `tests/pipeline/config.test.ts`: default off, suggest accepted, junk rejected, `inboxMode` falls back to off.

### Task 2: Schema

- Modify `prisma/schema.prisma`: enums `ReviewAction` (`linked`, `created`, `dismissed`, `undone`) and `SuggestionKind` (`link`, `new_event`, `doubt`); model `ProposalReview` with an index on `messageId` and on `createdAt`; back-relation `Message.reviews`.
- Create a migration via `prisma migrate diff` from the previous schema.
- Modify `tests/helpers/db.ts` and `prisma/seed.ts` to delete `proposalReview` first.

### Task 3: Suggestions (pure)

- Create `src/features/inbox/suggestions.ts`:
  - `suggestionFrom(rows: ProposalRow[], upcoming: Map<string, string>, runId: string): Suggestion | null`
  - `clusterSuggestions(orphans: { id: string; groupReach: number; suggestion: Suggestion | null }[]): Cluster[]`
  - `highlight(text: string, spans: Span[]): { text: string; mark: boolean }[]`
- Test `tests/inbox/suggestions.test.ts`.

### Task 4: Loader

- Add `loadSuggestions(db, messageIds): Promise<Map<string, Suggestion>>` to the same module.
  - Latest succeeded `resolve` job per message, by `completedAt`, then `resultRunId`.
  - Proposals of that run, with their observation.
  - The current upcoming parties, read by the ids that appear.
- Test `tests/inbox/suggestions-db.test.ts`.

### Task 5: Review and undo

- Create `src/catalog/review.ts`:
  - `recordReviews(db, { messageIds, action, chosenPartyId }, now)`
  - `undoLinks(db, { partyId, messageIds }): Promise<number>`
  - `reviewCounts(db)`
- Modify `linkOrphans` to return `linkedIds`.
- Modify `src/app/actions/catalog.ts`: link, bulk link, create and dismiss record a review when the flag is `suggest`; new `actionUndoLinks`. The bulk action returns `{ linkedIds }`.
- Modify `src/pipeline/status.ts`: add `reviews`.
- Tests: `tests/catalog/review.test.ts` and `tests/pipeline/status.test.ts`.

### Task 6: UI

- `src/lib/run-action.ts` and `use-row-actions.ts`: pass the action's return value to `onSuccess`, and allow a toast action.
- `src/app/inbox/page.tsx`: read `inboxMode()`, load suggestions, attach them to orphans, build clusters.
- Create `src/components/inbox/suggestion-clusters.tsx`, covering clusters, evidence, ticking, bulk link and the undo toast.
- `orphan-list.tsx`: exclude clustered ids, show notes for `doubt` and `new_event`, and prefill creation.
- `src/lib/toast-copy.ts`: undo copy.

### Task 7: Docs and verify

- README: the flag, where to set it (web service), and what the status counts mean.
- `npm run verify`, then the PR.
