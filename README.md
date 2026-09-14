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
| `npm run dev` | Next.js |
| `npm run build` | Production Next.js build |
| `npm run start` | Serve the production build |
| `npm run worker` | One batch pass |
| `npm run connector` | Baileys connector |
| `npm test` | `tsc --noEmit` + Vitest (serial files, against `lumberjack_test`) |

## UI

Professional dark board built with Tailwind CSS and shadcn/ui. Layout switches at a **768px** breakpoint (tables and top nav on desktop; cards and bottom nav on mobile). Feedback uses Sonner toasts. Requires Node **24** (`nvm use` reads `.nvmrc`).

WhatsApp syncs every group the account belongs to (hundreds), so group lists never render the whole set: Setup lists only the groups being listened to and reaches the rest through accent-insensitive search, and the Heat filter offers only listened groups plus the one currently in the query string.

## Out of v1

No official-platform scrape, capital allocation, purchase ledger, chat digest, or LLM classification.
