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
- After seed, home should be `/watchlist`. Heat shows a pressure reading for the upcoming party. The past edition of the same name is a badge only — it stays off heat and has no buy CTA.
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

Those ads are verbose, so extraction reads their conventions: the festa name comes from the first **bold** segment that still says something once the pitch and the filler are removed (`*Araxás*` wins, `*Cupom desconto:*` and `*COM DESCONTO*` are skipped, and a bold date or price carries too few letters to qualify), falling back to the first line with every bold pitch removed. A segment is cleaned rather than discarded, because promoters glue the pitch onto the name: `*MACK BIXOS - VIRADA DE LOTE 23:59*` is cut at the separator and keeps `MACK BIXOS`, while `*CENTRAL 1926 - VOLT MIX*` has no pitch in its tail and stays whole. Dates accept `27/12`, `25.09` and `31-12`, and a pair that cannot be a date is skipped, so `R$1.120` stays a price instead of becoming the 12th of January.

One blast, several festas. Promoters announce a whole Réveillon season in a single message, and reading only the first bold segment catalogued festa one and dropped the rest in silence — the asks for those festas then piled up as orphans nobody could link to anything. Each festa in those messages comes as a block that ends in its own buy link, so `splitAdBlocks` cuts right after each link and `extractCandidates` reads every piece, keeping a name with the date and the link it belongs to. `PartyCandidate.sourceMessageId` stopped being unique for exactly this, and each row keeps the `excerpt` it was read from, so the queue shows four lines about *this* festa and a `festa 2 de 3` badge instead of the same fifteen lines three times. Splitting only wins when the blocks read as two different festas: every block ends with a link by construction, so a date or a price is what proves a festa was announced there — two links to the same festa, or a link plus an Instagram handle, fall back to reading the message as a whole. Confirming one festa out of a blast links the message to that party, and later confirmations leave the link alone rather than stealing it.

A candidate only opens when the extraction produced a name **and** one of a date, a price or a link. `temos sem taxa e com desconto!` reads as an ad and extracts into nothing, and confirming it would mean typing the festa from scratch — which the orphan queue already does better. The message stays stored and classified; only the queue row is skipped.

Some senders are only ever noise on this board: promoters whose posts are weekly agendas and guest lists. **Silenciar** lives on the candidate card and on the undecided drawer row, because that is where the noise is seen — a silenced sender's messages are stored and classified but never open a candidate or a signal, and never show up in the orphan or undecided queues. It is about what the messages do, not about the sender, so rows already in the queue stay where they are.

Setup used to ask the operator to declare a role — `admin`, `pista` or `unknown` — on every contact, which bought nothing: the classifier takes the same path for the last two, and sets the first one itself from the WhatsApp group flag. Worse, declaring `admin` by hand silences a real reseller, since an admin never produces a pista signal. So the role is no longer editable and the section answers the question a mute decision actually asks: **who moves this board**, ordered by messages in the last 30 days, with signals, candidates and last seen, plus a search for the rest. The role shown next to a name is read off their own messages — *anuncia*, *negocia*, *anuncia e negocia*, *só conversa* — and `admin` stays as a badge, since WhatsApp says so and it changes how the classifier reads them.

Because raw text is always stored, widening the vocabulary recovers history instead of only helping from now on: `npm run db:reclassify` replays the rules over stored messages, reports what moves, recreates the missing signals for messages that match a party, retypes signals whose side flipped, and opens candidates for messages that turn out to be ads. It also re-reads every **pending** candidate with the current extractor and drops the ones that no longer have a name and a way to buy — a pending candidate holds nothing but the extractor's reading, since operator edits live in the confirm form. It never resurrects a rejected candidate, never gives a cross-posted copy its own candidate, and reports rather than deletes signals or candidates whose message stopped qualifying, since nothing distinguishes an operator's manual work from an automatic row.

A seller blasting one offer into eight groups is one intent, not eight. Ingest fingerprints the message body (accents, case, punctuation and emoji stripped) and links every copy from the same sender within **24h** to the first occurrence via `Message.duplicateOf`. Copies are stored for the audit trail but produce no `Signal` and no `PartyCandidate`, so heat counts stop being multiplied by how widely someone spams. The Inbox hides copies and shows a `N grupos` badge on the canonical entry, since spreading wide is itself a sign of urgency. A repost the next day starts a fresh intent.

Heat used to publish one number, a weighted sum of message counts in nested windows. It could not rank: offers *added* to it, so ten sellers and no buyer scored 20 while a party with one real buyer scored 9, and a single message counted three times because `1d` also sits inside `3d` and `7d`. The snapshot now counts **people per window** — unique demand and offer senders at 1d, 3d and 7d — and the board reads **pressão**, unique buyers ÷ (unique sellers + 1), because what decides a buy is scarcity. Counting people is also what makes cross-posting harmless on the pista side, where fingerprints cannot help: one person restating the same intent in different words is still one buyer. Colour on that number says **buy**, not "believe this number". Tying it to confidence looked reasonable and read backwards on real data: the brightest row on the board was `0,4×` with seventeen buyers against forty-two sellers, the single worst row to buy, while the `1×` rows sat in grey. So `heatVerdict` decides the accent instead — **escassez** (1,5× or more with at least three buyers) is the only state that gets the primary colour, because ratios under that keep coming from silence: `1 procurando, 0 vendendo` is also 1×. Everything else stays grey, and the icon carries what grey cannot: a **snowflake** when at least three people are selling into almost no demand, a flame otherwise. A room full of sellers and an empty room both go quiet on a ratio, and they are opposite states — the market answered, versus nobody spoke.

The trend compares a party against its own snapshot from three days back, and each row spells itself out — `9 procurando, 2 vendendo, faltam 12 dias`. The clock is deliberately not folded into pressão: three separate numbers are what let the operator tell "hot but distant" from "quiet and tomorrow".

WhatsApp syncs every group the account belongs to (hundreds), so group lists never render the whole set: Setup lists only the groups being listened to and reaches the rest through accent-insensitive search, and the Heat filter offers only listened groups plus the one currently in the query string.

## Out of v1

No official-platform scrape, capital allocation, purchase ledger, chat digest, or LLM classification.
