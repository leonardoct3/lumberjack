# Lumberjack

Single-operator board for WhatsApp ticket-group messages. Confirm parties into a human-ordered first-lot watchlist and rank upcoming parties by pista heat.

Timezone is **America/Sao_Paulo**. Listener days are Tuesday–Saturday.

## Warnings

- The WhatsApp connector uses **Baileys**, an unofficial client. It violates WhatsApp ToS and can get the number banned.
- Week 1 is meant to run on a **personal number** only to prove the pipe. A number used for bank/email 2FA is a real risk even for seven days.
- `AUTH_DISABLED=1` skips login (intended for localhost). Production refuses to boot with that flag or with a weak/default `AUTH_PASSWORD`.
- The session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, and carries a signed 7-day expiry. "Sair" on `/setup` clears it.
- There is no server-side session store: logout drops the cookie from that browser, but a token already copied elsewhere keeps working until its expiry. Rotate `AUTH_PASSWORD` to invalidate every outstanding session.
- **Never run the connector locally while the Railway connector is up.** Two Baileys clients on the same auth credentials cause `conflict: replaced` and break Signal decryption. Local development uses the Docker Postgres; production ingestion belongs only to the hosted connector.

## Setup

Copy `.env.example` to `.env`. Default database URL:

```
DATABASE_URL=postgresql://lumberjack:lumberjack@localhost:5433/lumberjack
```

Host port **5433**, not the Postgres default, so this project never fights another
local Postgres for 5432. Compose keeps the data in the named volume `pgdata`.

Node **24 LTS** (`nvm use` reads `.nvmrc`).

```bash
nvm use
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run db:test:setup
```

`db:up` starts Postgres 16 via Docker Compose (does not stop other containers). `db:seed` **wipes the catalog tables of the database in `DATABASE_URL`** and reloads the smoke fixture through real ingest + confirm + `refreshHeat`.

`db:test:setup` creates and migrates `lumberjack_test`. The suite truncates every table, so it runs only against a database whose name ends in `_test` (`DATABASE_URL_TEST` overrides the default) and refuses to start otherwise.

## Run

Three processes, one Postgres:

```bash
npm run dev        # web board (Next.js)
npm run worker     # batch: mark past parties, refresh heat
npm run connector  # unofficial WhatsApp listener (QR on first run)
```

- `/` routes to `/inbox` when candidates or orphan pista signals are pending, otherwise `/watchlist` if the queue has an open lot, else `/heat`.
- After seed, home should be `/watchlist`. Heat shows a score for the upcoming party. The past edition of the same name is a badge only — it stays off heat and has no buy CTA.
- WhatsApp auth lives in `WA_AUTH_DIR` (`data/wa-auth/` locally, `/data/wa-auth` on Railway). Session state (`connected` / `qr` / heartbeat) lives in the Postgres `WaSession` row, so the web board and connector can run as separate services. Pairing QR is rendered on `/setup`.
- Swap number = swap the auth folder. Disconnect does not wipe messages or parties; the worker still runs on what is already in the database.

## Hosting (Railway)

Production layout: managed Postgres + `web` (`next start`) + `connector` (1 replica, volume on `/data`) + `worker` (hourly cron). Set `TZ=America/Sao_Paulo` and a strong `AUTH_PASSWORD` on every service. After the first deploy, open `/setup`, scan the QR, then mark the groups to listen — `listen` flags start empty on a fresh database.

## Scripts

| Script | What it does |
|---|---|
| `npm run db:up` | `docker compose up -d` |
| `npm run db:migrate` | Prisma migrate |
| `npm run db:seed` | Fixture: 1 listen group, 1 admin, 1 pista, ~20 classified messages (destructive) |
| `npm run db:test:setup` | Create + migrate `lumberjack_test` |
| `npm run db:dedupe` | Retrofit cross-post collapsing on old rows (dry run; add `-- --apply`) |
| `npm run db:reclassify` | Replay the classifier over stored messages (dry run; add `-- --apply`) |
| `npm run dev` | Next.js |
| `npm run build` | Production Next.js build |
| `npm run start` | Serve the production build |
| `npm run worker` | One batch pass |
| `npm run connector` | Baileys connector |
| `npm test` | `tsc --noEmit` + Vitest (serial files, against `lumberjack_test`) |

## UI

Professional dark board built with Tailwind CSS and shadcn/ui. Layout switches at a **768px** breakpoint (tables and top nav on desktop; cards and bottom nav on mobile). Feedback uses Sonner toasts. Requires Node **24** (`nvm use` reads `.nvmrc`).

The Inbox has to be drainable, so an orphan signal has three exits: link it to an active party, **create the party from the message itself** (no lot, so `canAppearOnWatchlist` keeps it out of the buy queue until an official lot exists — it only ranks on Heat), or dismiss it (`Message.dismissedAt`, reversible from a collapsed list at the bottom). Multi-select links a whole batch at once, and when every selected message points at the same suggestion the bar preselects it: create the party once, tick the rest, confirm.

Confirming two promos of the same festa used to be the easy way to duplicate the catalog, since nothing ever looked for a party that already existed. The Inbox now warns when the name being typed resembles a catalogued party (`findSimilarParties`), and the party dossier carries the cure: **fundir** folds a duplicate into the survivor — signals, messages and lots move over, the duplicate's name becomes an alias so the next message matches without a second cleanup, and the survivor inherits the queue slot — while **descartar** deletes a party that should never have been catalogued and returns the evidence to the Inbox, pista messages as orphans and admin promos as pending candidates again. Leaving the watchlist is not a delete: it only clears `watchlistPosition`, which is what keeps a lot-less party ranking on Heat.

Demand was invisible for a while, and the cause was vocabulary. The classifier recognised five phrasings of asking (`procuro`, `preciso`, `quero comprar`, `alguem tem/com`) against an offer side that happened to own `vendo`, the word most sellers open with — so `compro 2 pista`, `quem tem?` and `pago acima` all fell into `ruido`, which no screen renders. The lexicon now reads **strong markers** that carry direction on their own, then **weak markers** (`quero`, `pago`, `sobrou`, `tenho`) that only count next to a ticket noun or a small count, on word boundaries so `comprovante` is not someone buying. Strong beats weak on purpose: `vendo 2 pista, alguem interessado?` is a seller. Whatever the rules still cannot read but mentions a ticket lands in the Inbox's **Não classificadas** drawer, where marking it procura or oferta drops it into the orphan queue — and every entry there is a phrasing the lexicon owes.

The people who announce festas are rarely group admins, so gating the candidate path on the WhatsApp admin flag left every promoter blast in `ruido` too. An ad is now recognised by its shape, from any sender: **two marks, one of which has to be a way to buy** — a platform link, a shortener, a `wa.me` channel or a price table — plus ad language (`lote`, `sem taxa`, `lista vip`, `cupom`, `vendas abertas`). One lonely link is not an ad, and a pista verb always wins, so `vendo 1 pista R$150 https://sympla…` stays an offer while `ÚLTIMOS INGRESSOS DO LOTE … R$2.750 | R$3.150` opens a candidate. A guest list on an unknown host (`coloque seu nome na lista VIP`) has one mark and no way to buy, so it stays undecided. Being a group admin is still evidence on its own — one mark is enough there — and an admin never produces a pista signal. `MessageClass.admin_promo` keeps its name because it is a stored enum; it now means "an announced festa".

Those ads are verbose, so extraction reads their conventions: the festa name comes from the first **bold** segment that is not a sales pitch (`*Araxás*` wins, `*Cupom desconto:*` and `*COM DESCONTO*` are skipped, and a bold date or price carries too few letters to qualify), falling back to the first line with every bold pitch removed. Dates accept `27/12`, `25.09` and `31-12`, and a pair that cannot be a date is skipped, so `R$1.120` stays a price instead of becoming the 12th of January.

Because raw text is always stored, widening the vocabulary recovers history instead of only helping from now on: `npm run db:reclassify` replays the rules over stored messages, reports what moves, recreates the missing signals for messages that match a party, retypes signals whose side flipped, and opens candidates for messages that turn out to be ads. It never resurrects a rejected candidate, never gives a cross-posted copy its own candidate, and reports rather than deletes signals or candidates whose message stopped qualifying, since nothing distinguishes an operator's manual work from an automatic row.

A seller blasting one offer into eight groups is one intent, not eight. Ingest fingerprints the message body (accents, case, punctuation and emoji stripped) and links every copy from the same sender within **24h** to the first occurrence via `Message.duplicateOf`. Copies are stored for the audit trail but produce no `Signal` and no `PartyCandidate`, so heat counts stop being multiplied by how widely someone spams. The Inbox hides copies and shows a `N grupos` badge on the canonical entry, since spreading wide is itself a sign of urgency. A repost the next day starts a fresh intent.

WhatsApp syncs every group the account belongs to (hundreds), so group lists never render the whole set: Setup lists only the groups being listened to and reaches the rest through accent-insensitive search, and the Heat filter offers only listened groups plus the one currently in the query string.

## Out of v1

No official-platform scrape, capital allocation, purchase ledger, chat digest, or LLM classification.
