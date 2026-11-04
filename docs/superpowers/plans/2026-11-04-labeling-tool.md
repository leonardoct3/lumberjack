# Labeling Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, blind labeling page that turns the PR 1 pilot sample into validated gold labels for PR 3.

**Architecture:** Pure modules in `src/benchmark/label/` build each item's view and queue order. A shared label store in `src/benchmark/labels.ts` appends and reads labels, keeping the latest per message. A `node:http` server bound to 127.0.0.1 serves one static page and a small JSON API. The `bench label` subcommand wires these together.

**Tech Stack:** Node 24 `node:http` and `node:crypto`, zod 4, Vitest. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-04-labeling-tool-design.md`.
- Every data path is checked with `assertOutsideRepo`. The label file is mode 600.
- The server binds to `127.0.0.1` only, requires the session token and checks `Host`.
- Never expose `storedClass`, the stored `partyId`, candidates or signals in an item view.
- Context is strictly earlier than the message: a 24-hour group window and a 7-day sender window, each capped at 30.
- The page loads no external resources and inserts text as text nodes only.
- Tests and manual checks use synthetic fixtures, never the real export.
- Add the new paths to `format:check`. `npm run verify` must pass.

---

### Task 1: Label store, plus latest-wins scoring in the baseline

**Files:** create `src/benchmark/labels.ts` and `tests/benchmark/labels.test.ts`. Modify `src/benchmark/dataset.ts` (load `lots.jsonl` as `ExportedLot`) and the `--gold` branch of `src/jobs/benchmark.ts`.

**Produces:**
- `latestAnnotations<T extends { messageId?: unknown }>(records: T[]): T[]` keeps the last record per `messageId`, in first-seen order.
- `createLabelStore(file: string): { append(record: Annotation): void; all(): Annotation[]; latest(): Map<string, Annotation> }` creates the parent directory with mode 700 and the file with mode 600.
- `buildLabel(body: unknown, at: { messageId; annotator; now: Date }, context: { text; availableContext }): { annotation: Annotation | null; errors: string[] }`.
  - The server-set fields always win over whatever the client sends.
  - The client body may contain only `observations`, `needsReview`, `contextUsed` and `notes`.
- `ExportedLot` type, and `LoadedExport.lots`.

- [ ] Write the failing tests:
  - Latest wins and the original order is kept.
  - Append creates the file with mode 600, and a reload sees every line.
  - `buildLabel` rejects missing spans and context that wasn't offered.
  - `buildLabel` ignores a client-sent `source`, `annotator` or `messageId`.
- [ ] Run `npx vitest run tests/benchmark/labels.test.ts`. Expect failures (module missing).
- [ ] Implement. In the baseline, pass the gold records through `latestAnnotations` before validating.
- [ ] Run the tests again, plus `tests/benchmark`. Expect them to pass.

### Task 2: Item view and queue order

**Files:** create `src/benchmark/label/item.ts` and `tests/benchmark/label-item.test.ts`.

**Consumes:** `LoadedExport`, `SampleItem & SplitAssignment`, `catalogAsOf`.

**Produces:**
- `buildItemView(data: LoadedExport, item: LabelItem): ItemView`.
- `labelQueue(items: LabelItem[], seed: string): LabelItem[]`.
- Types:
  - `LabelItem = SampleItem & SplitAssignment`.
  - `ItemView = { messageId, text, sentAt, sentAtLocal, senderRole, senderMuted, familySize, set, split, excluded, context: ContextMessage[], catalog: CatalogParty[], availableContext: string[] }`.
  - `ContextMessage = { id, sentAt, sentAtLocal, text, sameGroup: boolean, sameSender: boolean }`.
  - `CatalogParty = { id, name, aliases, eventAt, lots: { label, officialPrice, platform }[] }`.

- [ ] Write the failing tests against a synthetic fixture:
  - Messages at or after `sentAt` are never offered.
  - The group window is 24 hours and the sender window is 7 days, with a message in both appearing once.
  - The cap is 30 and the newest messages come first.
  - The catalog is as of the message, and lots are filtered by `openedAt`.
  - The view's JSON has no `storedClass` or `partyId` key.
  - The queue is deterministic for a seed, differs across seeds, and puts excluded items last.
- [ ] Run and expect failures. Implement. Run and expect passes.

### Task 3: Server and page

**Files:** create `src/benchmark/label/server.ts`, `src/benchmark/label/page.ts` and `tests/benchmark/label-server.test.ts`.

**Consumes:** Tasks 1 and 2.

**Produces:** `startLabelServer(options: { data: LoadedExport; items: LabelItem[]; seed: string; store: LabelStore; annotator: string; port: number; token?: string; now?: () => Date }): Promise<{ url: string; port: number; close(): Promise<void> }>`. Port 0 picks a free port, for tests.

- [ ] Write the failing tests:
  - A request without a token gets 403; one with a wrong `Host` gets 403; an unknown path gets 404.
  - `/api/queue` reports progress.
  - `/api/item/:id` returns the view; an unknown id gets 404.
  - A valid label POST returns 200 and is persisted.
  - An invalid label POST returns 422 with errors and writes nothing.
  - A body over 1 MB gets 413.
  - Security headers are present.
- [ ] Run and expect failures. Implement the server, then the page (HTML and the `app.js` string). Run and expect passes.

### Task 4: CLI, docs, verification

**Files:** modify `src/jobs/benchmark.ts` (add the `label` command and usage), `README.md` (benchmark section) and `package.json` (`format:check` paths).

- [ ] Add `label --export DIR --sample DIR --annotator ID [--port 4319]`:
  - validate the annotator id;
  - load the export and the sample;
  - open the store at `<sample>/labels/<annotator>.jsonl`;
  - start the server and print the URL to stderr;
  - close cleanly on SIGINT.
- [ ] Check by hand: build a synthetic export in `/tmp`, launch, then label, edit and save in the browser and confirm the JSONL holds the latest record.
- [ ] Run `npm run verify` and expect it to pass. Commit, push and open a PR.
