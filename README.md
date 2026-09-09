# Lumberjack

Single-operator board for WhatsApp ticket-group messages. Confirm parties into a human-ordered first-lot watchlist and rank upcoming parties by pista heat.

Timezone is **America/Sao_Paulo**. Listener days are Tuesday–Saturday.

## Warnings

- The WhatsApp connector uses **Baileys**, an unofficial client. It violates WhatsApp ToS and can get the number banned.
- Week 1 is meant to run on a **personal number** only to prove the pipe. A number used for bank/email 2FA is a real risk even for seven days.
- `AUTH_DISABLED=1` skips login (intended for localhost). Do not expose that mode on a public host.
- The session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, and carries a signed 7-day expiry. "Sair" on `/setup` clears it.
- There is no server-side session store: logout drops the cookie from that browser, but a token already copied elsewhere keeps working until its expiry. Rotate `AUTH_PASSWORD` to invalidate every outstanding session.

## Setup

Copy `.env.example` to `.env`. Default database URL:

```
DATABASE_URL=postgresql://lumberjack:lumberjack@localhost:5432/lumberjack
```

Node **24 LTS** (`nvm use` reads `.nvmrc`).

```bash
nvm use
npm install
npm run db:up
npm run db:migrate
npm run db:seed
```

`db:up` starts Postgres 16 via Docker Compose (does not stop other containers). `db:seed` wipes catalog tables and reloads the smoke fixture through real ingest + confirm + `refreshHeat`.

## Run

Three processes, one Postgres:

```bash
npm run dev        # web board (Next.js)
npm run worker     # batch: mark past parties, refresh heat
npm run connector  # unofficial WhatsApp listener (QR on first run)
```

- `/` routes to `/inbox` when candidates or orphan pista signals are pending, otherwise `/watchlist` if the queue has an open lot, else `/heat`.
- After seed, home should be `/watchlist`. Heat shows a score for the upcoming party. The past edition of the same name is a badge only — it stays off heat and has no buy CTA.
- WhatsApp session lives in `data/wa-auth/` (not Postgres). Swap number = swap that folder. Disconnect does not wipe messages or parties; the worker still runs on what is already in the database.

## Scripts

| Script | What it does |
|---|---|
| `npm run db:up` | `docker compose up -d` |
| `npm run db:migrate` | Prisma migrate |
| `npm run db:seed` | Fixture: 1 listen group, 1 admin, 1 pista, ~20 classified messages |
| `npm run dev` | Next.js |
| `npm run worker` | One batch pass |
| `npm run connector` | Baileys connector |
| `npm test` | Vitest (serial file execution — tests share one Postgres) |

## UI

Professional dark board built with Tailwind CSS and shadcn/ui. Layout switches at a **768px** breakpoint (tables and top nav on desktop; cards and bottom nav on mobile). Feedback uses Sonner toasts. Requires Node **24** (`nvm use` reads `.nvmrc`).

## Out of v1

No official-platform scrape, capital allocation, purchase ledger, chat digest, or LLM classification.
