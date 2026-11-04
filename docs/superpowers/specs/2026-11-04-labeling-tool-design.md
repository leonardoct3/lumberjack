# Labeling tool design

Date: 2026-11-04. Status: approved in conversation.

## Purpose

PR 3 of the agentic evolution plan (the interpreter) is accepted on per-intent and per-field metrics against human gold labels. The pilot sample from PR 1 (364 duplicate families, seed `pilot-2026-11-04`) has no labels yet. This tool lets one person label it quickly and blindly. Every saved label passes the same evidence checks that model output will face.

One annotator for now. Labels are stored per annotator, so a second reviewer can be added later without changing the format. A second reviewer, adjudication and model drafts are out of scope.

## Command

```
npm run bench -- label --export DIR --sample DIR --annotator ID [--port 4319]
```

- `--export` is a PR 1 export directory, loaded through `loadExport`, which verifies the checksums.
- `--sample` is a sample directory inside it, containing `sample.jsonl` and `sample-manifest.json`.
- `--annotator` must match `^[a-z0-9_-]{2,32}$`. It is a pseudonym, because the schema forbids real names.
- Labels go to `<sample>/labels/<annotator>.jsonl`, created with mode 600. Every path must be outside the repository (`assertOutsideRepo`).
- The command prints `http://127.0.0.1:<port>/?t=<token>` and serves until interrupted.

## Server

- Uses `node:http` only and binds to `127.0.0.1`. No new dependencies.
- The session token is 32 random bytes in hex, created at start. Every request must carry it, either as the `t` query parameter or the `x-label-token` header. A request without it gets 403.
- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`; anything else gets 403. This blocks DNS rebinding.
- Responses send `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'`, `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.
- Routes:
  - `GET /` serves the page.
  - `GET /app.js` serves the script.
  - `GET /api/queue` returns the ordered item ids with set, split, excluded flag and labeled flag, plus progress.
  - `GET /api/item/:messageId` returns the item view below.
  - `POST /api/label` validates a label and appends it.
  - Anything else gets 404.

## Item view

Built by a pure function from the loaded export and the sample item:

- **The message:** its redacted `text`, `sentAt` with a São Paulo rendering, `senderRoleNow`, `senderMutedNow`, and the number of members in its duplicate family.
- **Context, limited to what existed when the message was sent.** Every entry has `sentAt` strictly before the message.
  - Group window: messages from the same `group` in the previous 24 hours, newest first, at most 30.
  - Sender window: messages from the same `sender` in any group in the previous 7 days, newest first, at most 30.
  - Messages in both windows appear once.
  - Context messages carry their pseudonymized id, `sentAt`, text and group-or-sender marker. They never carry `storedClass` or `partyId`.
- **Catalog:** `catalogAsOf(parties, sentAt, "as_of_message")`. Each party shows its name, aliases, `eventAt`, and its lots opened at or before `sentAt` (label, official price, platform).
- **`availableContext`:** the ids of every context message and every offered party. Annotation validation checks against this list.
- **Never shown:** the rules' class, the stored party link, candidates and signals. That keeps labels blind to the baseline.

## Labeling page

- Plain HTML with vanilla JavaScript, and no external resources. Text is always inserted as text nodes, never as HTML, and URLs are not turned into links.
- **Message panel.** Selecting text and pressing "Add span" attaches `{start, end, text}` to the current observation. Offsets come from the selection within the message element.
- **Observation editor.** Each message has one or more observations, each covering:
  - intent;
  - event mention, `partyId` (chosen from the offered catalog) and resolution;
  - ticket category and quantity;
  - price amount, currency and meaning;
  - event date year, month and day, plus basis;
  - spans;
  - relationship kind, with the related message chosen from the context list;
  - ambiguities, one per line.
- Picking a party or a related message adds its id to `contextUsed`. Context items can also be ticked by hand.
- Message-level fields: `needsReview` and `notes`.
- **Shortcuts.** "Unrelated" saves a single unrelated observation with no spans and moves on. Keys: `j`/`k` for next and previous, `u` for unrelated, `s` to save. Keys are ignored while typing in a field.
- Validation errors from the server are listed above the form, and nothing is saved.

## Storage and order

- **Server-built records.** The server sets `schemaVersion`, `messageId`, `annotator`, `annotatedAt` (server time) and `source: "human"`. The client sends only `observations`, `needsReview`, `contextUsed` and `notes`.
- **Validation.** `validateAnnotation(record, { text, availableContext })` must return no errors before anything is written.
- **Append-only file.** The latest record for a message wins (the last line, because lines are appended in time order). One shared reader, `latestAnnotations`, is used by both the tool and `bench baseline --gold`. Today the baseline would score a re-saved label twice.
- **Queue order.** HMAC-SHA256 of the message id, keyed by the sample seed, ascending, with excluded items last. The order is the same on every launch and isn't chronological.
- **Progress.** Labeled and total counts, by set and by split.

## Testing

- **Context builder:** no message at or after `sentAt`, no other group's message outside the sender window, the 24-hour and 7-day bounds, deduplication, caps, the catalog as of the message, lots filtered by `openedAt`, and no `storedClass` or `partyId` in the output.
- **Label store:**
  - it appends with mode 600;
  - the latest record wins;
  - an invalid label writes nothing;
  - context that wasn't offered is rejected;
  - the server-set fields can't be overridden by the client.
- **Server:** missing token returns 403, a wrong `Host` returns 403, an unknown route returns 404, a valid label returns 200 and is persisted, and an invalid one returns 422 with errors. Tested against a synthetic fixture export in a temporary directory.
- **Baseline:** `--gold` scores only the latest label per message.
- **Page:** checked by hand in the browser against synthetic fixture data only, never the real export.
