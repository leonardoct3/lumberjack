# Lumberjack v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-operator web board that ingests WhatsApp ticket-group messages in batch, lets the operator confirm parties/lots into a human-ordered first-lot watchlist, and ranks upcoming parties by pista heat.

**Architecture:** One TypeScript repo. Pure domain functions first (classify, extract, match, heat, date gates). Postgres via Prisma is the product. A Baileys connector only writes raw messages. A worker classifies, extracts candidates, attaches signals, snapshots heat, and marks past parties. Next.js is the source of truth UI.

**Tech Stack:** Node 22, TypeScript 5.7, Next.js 15 (App Router), React 19, Prisma 6, PostgreSQL 16, Vitest 3, `@whiskeysockets/baileys`, `tsx`.

## Global Constraints

- Timezone is exactly `America/Sao_Paulo`.
- Listener days are Tuesday–Saturday only.
- Heat is batch, never realtime push.
- Classification is rules only — no LLM in v1.
- Pista messages never create a `Party`.
- A party needs confirmed `eventAt` before it appears on Watchlist or Heat.
- Watchlist order is operator-defined (`watchlistPosition`); heat score does not sort it.
- `daysToEvent` is display-only and must not enter `computeHeatScore`.
- Heat formula is `4*demand1d + 2*demand3d + 1*demand7d + 2*uniqueDemandSenders7d + 1*offer1d + 1*offer3d`.
- Duplicate `waMessageId` is ignored (idempotent insert).
- WhatsApp session lives in `data/wa-auth/` files, not in Postgres. Swap number = swap that folder.
- Single user: cookie session from `AUTH_PASSWORD`, or skip auth when `AUTH_DISABLED=1`.
- UI copy in Portuguese.
- Do not implement: capital allocation, purchase ledger, official-platform scrape, chat digest, auto-rank of lote 1, multi-user.

## File map

```
package.json
tsconfig.json
next.config.ts
vitest.config.ts
docker-compose.yml
.env.example
.gitignore
prisma/schema.prisma
src/domain/normalize.ts
src/domain/timezone.ts
src/domain/classify.ts
src/domain/extract.ts
src/domain/match.ts
src/domain/heat.ts
src/domain/gates.ts
src/db/client.ts
src/catalog/confirm.ts
src/catalog/reject.ts
src/catalog/unlink.ts
src/catalog/mark-past.ts
src/catalog/watchlist.ts
src/ingest/ingest.ts
src/jobs/process-unclassified.ts
src/jobs/refresh-heat.ts
src/jobs/mark-past.ts
src/jobs/main.ts
src/connector/status.ts
src/connector/main.ts
src/auth/cookie.ts
src/middleware.ts
src/app/layout.tsx
src/app/login/page.tsx
src/app/page.tsx
src/app/watchlist/page.tsx
src/app/heat/page.tsx
src/app/inbox/page.tsx
src/app/parties/[id]/page.tsx
src/app/setup/page.tsx
src/app/actions/catalog.ts
src/app/actions/watchlist.ts
src/app/actions/party.ts
src/app/actions/setup.ts
src/components/nav.tsx
tests/domain/*.test.ts
tests/catalog/catalog.test.ts
tests/ingest/ingest.test.ts
tests/jobs/*.test.ts
tests/connector/status.test.ts
tests/auth/cookie.test.ts
tests/helpers/db.ts
```

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `docker-compose.yml`, `.env.example`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`, `tests/domain/sanity.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: npm scripts `dev`, `test`, `worker`, `connector`; Postgres on `localhost:5432`

- [ ] **Step 1: Write the failing sanity test**

```ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(3);
  });
});
```

- [ ] **Step 2: Add project files**

`package.json`:

```json
{
  "name": "lumberjack",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run",
    "test:watch": "vitest",
    "worker": "tsx src/jobs/main.ts",
    "connector": "tsx src/connector/main.ts",
    "db:up": "docker compose up -d",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate"
  }
}
```

Install: `npm install next@15 react@19 react-dom@19 @prisma/client` and `npm install -D typescript vitest @types/node @types/react @types/react-dom prisma tsx`.

`tsconfig.json` — Next + `"strict": true`, paths `@/*` → `src/*`.
`vitest.config.ts` — `globals: false`, `environment: "node"`, `include: ["tests/**/*.test.ts"]`.
`docker-compose.yml` — `postgres:16`, user/password/db `lumberjack`, port `5432`.
`.env.example`:

```
DATABASE_URL=postgresql://lumberjack:lumberjack@localhost:5432/lumberjack
AUTH_PASSWORD=changeme
AUTH_DISABLED=1
WA_AUTH_DIR=./data/wa-auth
WA_STATUS_PATH=./data/wa-status.json
```

`.gitignore`: `node_modules`, `.next`, `.env`, `data/`, `prisma/dev.db`.

Minimal `src/app/layout.tsx` (`<html lang="pt-BR">`) and `src/app/page.tsx` returning `<p>Lumberjack</p>`.

- [ ] **Step 3: Run sanity test — expect FAIL**

Run: `npx vitest run tests/domain/sanity.test.ts`
Expected: FAIL (`expected 2 to be 3`) — proves the runner works.

- [ ] **Step 4: Fix assertion to `toBe(2)`, run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts vitest.config.ts docker-compose.yml .env.example .gitignore src/app/layout.tsx src/app/page.tsx tests/domain/sanity.test.ts
git commit -m "chore: scaffold Next.js, Vitest, and Postgres compose"
```

---

### Task 2: Normalize and timezone

**Files:**
- Create: `src/domain/normalize.ts`, `src/domain/timezone.ts`, `tests/domain/normalize.test.ts`, `tests/domain/timezone.test.ts`
- Delete: `tests/domain/sanity.test.ts` after this task’s tests pass (optional; or leave it)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalizeText(text: string): string` — lowercase, NFD, strip combining marks, collapse whitespace
  - `TZ` constant `"America/Sao_Paulo"`
  - `zonedParts(now: Date): { year: number; month: number; day: number; weekday: number }` — `weekday` Monday=1 … Sunday=7 (ISO)
  - `isListenDay(now: Date): boolean` — weekday 2–6 (Tue–Sat)
  - `startOfDaySp(now: Date): Date` — 00:00 in SP as UTC Date
  - `daysUntil(eventAt: Date, now: Date): number` — calendar days in SP, can be negative

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { normalizeText } from "@/domain/normalize";

describe("normalizeText", () => {
  it("lowercases, strips accents, collapses space", () => {
    expect(normalizeText("  Pista ÔNIX  ")).toBe("pista onix");
  });
});
```

```ts
import { describe, it, expect } from "vitest";
import { TZ, isListenDay, daysUntil } from "@/domain/timezone";

describe("timezone", () => {
  it("uses America/Sao_Paulo", () => {
    expect(TZ).toBe("America/Sao_Paulo");
  });

  it("listens Tuesday through Saturday only", () => {
    // 2026-09-07 15:00Z = Monday 12:00 in SP (UTC-3)
    expect(isListenDay(new Date("2026-09-07T15:00:00Z"))).toBe(false);
    // 2026-09-08 15:00Z = Tuesday
    expect(isListenDay(new Date("2026-09-08T15:00:00Z"))).toBe(true);
    // 2026-09-12 15:00Z = Saturday
    expect(isListenDay(new Date("2026-09-12T15:00:00Z"))).toBe(true);
    // 2026-09-13 15:00Z = Sunday
    expect(isListenDay(new Date("2026-09-13T15:00:00Z"))).toBe(false);
  });

  it("counts calendar days in SP", () => {
    const now = new Date("2026-09-03T15:00:00Z");
    const event = new Date("2026-09-05T03:00:00Z"); // 2026-09-05 00:00 SP
    expect(daysUntil(event, now)).toBe(2);
  });
});
```

Configure Vitest alias `@` → `src` so these imports resolve (`vite-tsconfig-paths` or `resolve.alias` in `vitest.config.ts`).

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/domain/normalize.test.ts tests/domain/timezone.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement**

```ts
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
```

```ts
export const TZ = "America/Sao_Paulo";

export function zonedParts(now: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday],
  };
}

export function isListenDay(now: Date): boolean {
  const wd = zonedParts(now).weekday;
  return wd >= 2 && wd <= 6;
}

export function startOfDaySp(now: Date): Date {
  const { year, month, day } = zonedParts(now);
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T03:00:00Z`);
}

export function daysUntil(eventAt: Date, now: Date): number {
  const a = startOfDaySp(eventAt).getTime();
  const b = startOfDaySp(now).getTime();
  return Math.round((a - b) / 86_400_000);
}
```

`startOfDaySp` uses `T03:00:00Z` because SP is UTC−3 year-round in 2026 (no DST). Do not use the system local zone.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/domain/normalize.test.ts tests/domain/timezone.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/normalize.ts src/domain/timezone.ts tests/domain/normalize.test.ts tests/domain/timezone.test.ts vitest.config.ts
git commit -m "feat: add text normalize and Sao Paulo timezone helpers"
```

---

### Task 3: Classifier

**Files:**
- Create: `src/domain/classify.ts`, `tests/domain/classify.test.ts`

**Interfaces:**
- Consumes: `normalizeText`
- Produces:
  - `export type SenderRole = "admin" | "pista" | "unknown"`
  - `export type MessageClass = "admin_promo" | "pista_oferta" | "pista_procura" | "ruido"`
  - `export function classifyMessage(input: { text: string; senderRole: SenderRole }): MessageClass`

Rules (lock these):
- `senderRole === "admin"` never returns `pista_*`. It returns `admin_promo` if the text has a known ticket host, a shortener, or a lot keyword; otherwise `ruido`.
- `senderRole !== "admin"` never returns `admin_promo`.
- Demand keywords win over offer if both appear.
- Else offer keywords.
- Else `ruido`.

Ticket hosts: `sympla.com`, `gandaya.com`, `blacktag`, `ingresse.com`.
Shorteners: `bit.ly`, `tinyurl.com`.
Lot keywords (normalized): `lote`, `primeiro lote`, `1o lote`, `2o lote`, `camarote`.
Demand: `procuro`, `preciso`, `quero comprar`, `alguem tem`, `alguem com`.
Offer: `vendo`, `tenho extra`, `saida`, `revendo`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { classifyMessage } from "@/domain/classify";

describe("classifyMessage", () => {
  it("marks admin lot/link as admin_promo", () => {
    expect(
      classifyMessage({
        senderRole: "admin",
        text: "Abriu o 1º lote da ONIX https://www.sympla.com.br/onix",
      }),
    ).toBe("admin_promo");
  });

  it("does not treat admin hello as promo", () => {
    expect(classifyMessage({ senderRole: "admin", text: "bom dia galera" })).toBe("ruido");
  });

  it("never classifies admin as pista", () => {
    expect(classifyMessage({ senderRole: "admin", text: "vendo extra onix" })).toBe("ruido");
  });

  it("classifies demand", () => {
    expect(
      classifyMessage({ senderRole: "pista", text: "procuro pista onix sexta" }),
    ).toBe("pista_procura");
  });

  it("classifies offer", () => {
    expect(classifyMessage({ senderRole: "unknown", text: "vendo camarote" })).toBe(
      "pista_oferta",
    );
  });

  it("prefers demand when both appear", () => {
    expect(
      classifyMessage({ senderRole: "pista", text: "vendo nao, procuro onix" }),
    ).toBe("pista_procura");
  });

  it("never classifies pista as admin_promo even with a link", () => {
    expect(
      classifyMessage({
        senderRole: "pista",
        text: "olha o link https://www.sympla.com.br/x",
      }),
    ).toBe("ruido");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/domain/classify.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `classifyMessage`**

```ts
import { normalizeText } from "./normalize";

export type SenderRole = "admin" | "pista" | "unknown";
export type MessageClass =
  | "admin_promo"
  | "pista_oferta"
  | "pista_procura"
  | "ruido";

const TICKET_HOSTS = ["sympla.com", "gandaya.com", "blacktag", "ingresse.com"];
const SHORTENERS = ["bit.ly", "tinyurl.com"];
const LOT = ["lote", "primeiro lote", "1o lote", "2o lote", "camarote"];
const DEMAND = ["procuro", "preciso", "quero comprar", "alguem tem", "alguem com"];
const OFFER = ["vendo", "tenho extra", "saida", "revendo"];

function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

export function classifyMessage(input: {
  text: string;
  senderRole: SenderRole;
}): MessageClass {
  const n = normalizeText(input.text);
  const hasPromo =
    hasAny(n, TICKET_HOSTS) || hasAny(n, SHORTENERS) || hasAny(n, LOT);

  if (input.senderRole === "admin") {
    return hasPromo ? "admin_promo" : "ruido";
  }
  if (hasAny(n, DEMAND)) return "pista_procura";
  if (hasAny(n, OFFER)) return "pista_oferta";
  return "ruido";
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/domain/classify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/classify.ts tests/domain/classify.test.ts
git commit -m "feat: classify admin promo vs pista offer/demand"
```

---

### Task 4: Extractor

**Files:**
- Create: `src/domain/extract.ts`, `tests/domain/extract.test.ts`

**Interfaces:**
- Consumes: `normalizeText`
- Produces:
  - `export type Platform = "sympla" | "gandaya" | "blacktag" | "ingresse" | "other" | "unknown"`
  - `export type ExtractedCandidate = { name: string | null; url: string | null; lotLabel: string | null; officialPrice: number | null; eventAt: Date | null; platform: Platform }`
  - `export function extractCandidate(text: string, now?: Date): ExtractedCandidate`

Extraction rules:
- First `https?://\S+` is `url`. Host maps to `platform` (`sympla.com` → `sympla`, etc). Unknown host → `other`. No url → `platform: "unknown"`.
- Price: first `/r\$\s?(\d+(?:[.,]\d{2})?)/i` → number (comma or dot).
- Lot label: first match of `(\d+º?\s*lote|primeiro lote|camarote|pista vip)` (original casing collapsed to a short label).
- Date: first `(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?`. If year missing, use year of `now` in SP (default `now = new Date()`). Build `Date` at 00:00 SP (`T03:00:00Z`).
- Name: strip URLs from text, take the first non-empty line, trim to 80 chars. If empty, `null`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { extractCandidate } from "@/domain/extract";

const now = new Date("2026-09-03T15:00:00Z");

describe("extractCandidate", () => {
  it("pulls url, platform, lot, price, date, name", () => {
    const r = extractCandidate(
      "ONIX\n1º lote R$ 80 05/09 https://www.sympla.com.br/onix",
      now,
    );
    expect(r.platform).toBe("sympla");
    expect(r.url).toContain("sympla.com.br/onix");
    expect(r.officialPrice).toBe(80);
    expect(r.lotLabel?.toLowerCase()).toContain("lote");
    expect(r.eventAt?.toISOString().startsWith("2026-09-05")).toBe(true);
    expect(r.name?.toLowerCase()).toContain("onix");
  });

  it("returns nulls when nothing is present", () => {
    const r = extractCandidate("bom dia", now);
    expect(r).toEqual({
      name: "bom dia",
      url: null,
      lotLabel: null,
      officialPrice: null,
      eventAt: null,
      platform: "unknown",
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/domain/extract.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `extractCandidate`** following the rules above. Use `zonedParts` from `timezone.ts` when inferring year.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/domain/extract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/extract.ts tests/domain/extract.test.ts
git commit -m "feat: extract party candidate fields from admin text"
```

---

### Task 5: Fuzzy match and gates

**Files:**
- Create: `src/domain/match.ts`, `src/domain/gates.ts`, `tests/domain/match.test.ts`, `tests/domain/gates.test.ts`

**Interfaces:**
- Consumes: `normalizeText`
- Produces:
  - `export type PartyStatus = "upcoming" | "past" | "cancelled"`
  - `export type PartyMatchInput = { id: string; name: string; aliases: string[]; status: PartyStatus }`
  - `export function matchParty(messageText: string, parties: PartyMatchInput[]): PartyMatchInput | null` — skip `past` and `cancelled`; match if normalized name or alias is a substring of the normalized message; if several match, pick the longest needle
  - `export function canAppearOnWatchlist(input: { status: PartyStatus; hasOpenLot: boolean }): boolean` — `upcoming && hasOpenLot`
  - `export function canRankOnHeat(status: PartyStatus): boolean` — `status === "upcoming"`
  - `export function isPastEvent(eventAt: Date, now: Date): boolean` — `daysUntil(eventAt, now) < 0`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { matchParty } from "@/domain/match";

const onix = { id: "1", name: "ONIX", aliases: ["onix"], status: "upcoming" as const };
const past = { id: "2", name: "ONIX", aliases: ["onix"], status: "past" as const };

describe("matchParty", () => {
  it("matches upcoming name in text", () => {
    expect(matchParty("procuro pista onix", [onix])?.id).toBe("1");
  });

  it("does not attach buy/heat signals to past parties", () => {
    expect(matchParty("procuro onix", [past])).toBeNull();
  });
});
```

```ts
import { describe, it, expect } from "vitest";
import { canAppearOnWatchlist, canRankOnHeat, isPastEvent } from "@/domain/gates";

describe("gates", () => {
  it("keeps past parties off watchlist and heat rank", () => {
    expect(canAppearOnWatchlist({ status: "past", hasOpenLot: true })).toBe(false);
    expect(canRankOnHeat("past")).toBe(false);
    expect(canRankOnHeat("upcoming")).toBe(true);
    expect(canAppearOnWatchlist({ status: "upcoming", hasOpenLot: true })).toBe(true);
    expect(canAppearOnWatchlist({ status: "upcoming", hasOpenLot: false })).toBe(false);
  });

  it("treats yesterday in SP as past", () => {
    expect(isPastEvent(new Date("2026-09-02T03:00:00Z"), new Date("2026-09-03T15:00:00Z"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/domain/match.test.ts tests/domain/gates.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `matchParty`, `canAppearOnWatchlist`, `canRankOnHeat`, `isPastEvent`**

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/domain/match.test.ts tests/domain/gates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/match.ts src/domain/gates.ts tests/domain/match.test.ts tests/domain/gates.test.ts
git commit -m "feat: fuzzy-match parties and enforce date gates"
```

---

### Task 6: Heat score

**Files:**
- Create: `src/domain/heat.ts`, `tests/domain/heat.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type HeatCounts = { demand1d: number; demand3d: number; demand7d: number; uniqueDemandSenders7d: number; offer1d: number; offer3d: number }`
  - `export function computeHeatScore(c: HeatCounts): number`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeHeatScore } from "@/domain/heat";

describe("computeHeatScore", () => {
  it("is the locked linear combination", () => {
    expect(
      computeHeatScore({
        demand1d: 1,
        demand3d: 2,
        demand7d: 3,
        uniqueDemandSenders7d: 4,
        offer1d: 5,
        offer3d: 6,
      }),
    ).toBe(4 * 1 + 2 * 2 + 1 * 3 + 2 * 4 + 1 * 5 + 1 * 6);
  });

  it("does not take daysToEvent", () => {
    expect(computeHeatScore.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/domain/heat.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
export type HeatCounts = {
  demand1d: number;
  demand3d: number;
  demand7d: number;
  uniqueDemandSenders7d: number;
  offer1d: number;
  offer3d: number;
};

export function computeHeatScore(c: HeatCounts): number {
  return (
    4 * c.demand1d +
    2 * c.demand3d +
    1 * c.demand7d +
    2 * c.uniqueDemandSenders7d +
    1 * c.offer1d +
    1 * c.offer3d
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/domain/heat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/heat.ts tests/domain/heat.test.ts
git commit -m "feat: lock deterministic heat score formula"
```

---

### Task 7: Prisma schema

**Files:**
- Create: `prisma/schema.prisma`, `src/db/client.ts`
- Modify: `.env.example` if needed

**Interfaces:**
- Consumes: domain unions (`SenderRole`, `MessageClass`, `PartyStatus`, `Platform`)
- Produces: Prisma models named exactly: `Group`, `Sender`, `Message`, `PartyCandidate`, `Party`, `Lot`, `Signal`, `HeatSnapshot`

- [ ] **Step 1: Write schema** (no failing test first — this is the contract the next task’s tests import)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SenderRole {
  admin
  pista
  unknown
}

enum MessageClass {
  admin_promo
  pista_oferta
  pista_procura
  ruido
}

enum CandidateStatus {
  pending
  confirmed
  rejected
}

enum PartyStatus {
  upcoming
  past
  cancelled
}

enum Platform {
  sympla
  gandaya
  blacktag
  ingresse
  other
  unknown
}

enum SignalType {
  offer
  demand
}

model Group {
  id        String    @id @default(cuid())
  waId      String    @unique
  name      String
  listen    Boolean   @default(false)
  messages  Message[]
  createdAt DateTime  @default(now())
}

model Sender {
  id        String     @id @default(cuid())
  waId      String     @unique
  name      String?
  role      SenderRole @default(unknown)
  messages  Message[]
  signals   Signal[]
  createdAt DateTime   @default(now())
}

model Message {
  id           String         @id @default(cuid())
  waMessageId  String         @unique
  group        Group          @relation(fields: [groupId], references: [id])
  groupId      String
  sender       Sender         @relation(fields: [senderId], references: [id])
  senderId     String
  sentAt       DateTime
  text         String
  class        MessageClass?
  party        Party?   @relation(fields: [partyId], references: [id])
  partyId      String?
  candidate    PartyCandidate?
  signals      Signal[]
  createdAt    DateTime @default(now())
}

model PartyCandidate {
  id              String          @id @default(cuid())
  status          CandidateStatus @default(pending)
  name            String?
  url             String?
  lotLabel        String?
  officialPrice   Float?
  eventAt         DateTime?
  platform        Platform        @default(unknown)
  source          Message         @relation(fields: [sourceMessageId], references: [id])
  sourceMessageId String          @unique
  createdAt       DateTime        @default(now())
}

model Party {
  id                 String         @id @default(cuid())
  name               String
  aliases            String[]
  eventAt            DateTime
  status             PartyStatus    @default(upcoming)
  qualitativeScore   Int?
  watchlistPosition  Int?
  notes              String?
  lots               Lot[]
  messages           Message[]
  signals            Signal[]
  heatSnapshots      HeatSnapshot[]
  createdAt          DateTime       @default(now())
}

model Lot {
  id            String    @id @default(cuid())
  party         Party     @relation(fields: [partyId], references: [id])
  partyId       String
  label         String
  openedAt      DateTime
  closedAt      DateTime?
  officialPrice Float?
  url           String?
  platform      Platform  @default(unknown)
}

model Signal {
  id        String     @id @default(cuid())
  type      SignalType
  party     Party      @relation(fields: [partyId], references: [id])
  partyId   String
  message   Message    @relation(fields: [messageId], references: [id])
  messageId String     @unique
  sender    Sender     @relation(fields: [senderId], references: [id])
  senderId  String
  createdAt DateTime   @default(now())
}

model HeatSnapshot {
  id                      String   @id @default(cuid())
  party                   Party    @relation(fields: [partyId], references: [id])
  partyId                 String
  computedAt              DateTime
  demand1d                Int
  demand3d                Int
  demand7d                Int
  offer1d                 Int
  offer3d                 Int
  offer7d                 Int
  uniqueDemandSenders7d   Int
  daysToEvent             Int
  score                   Int
}
```

`src/db/client.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

`PartyCandidate.source` is a 1:1 on `sourceMessageId`. There is no `Message.candidateId`. Later tasks use `PartyCandidate.sourceMessageId` as the source of truth.

- [ ] **Step 2: Start Postgres and migrate**

Run: `cp .env.example .env && npm run db:up && npx prisma migrate dev --name init`
Expected: migration applied, client generated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/db/client.ts
git commit -m "feat: add Postgres schema for catalog, signals, and heat"
```

---

### Task 8: Catalog commands

**Files:**
- Create: `src/catalog/confirm.ts`, `src/catalog/reject.ts`, `src/catalog/unlink.ts`, `src/catalog/mark-past.ts`, `tests/helpers/db.ts`, `tests/catalog/catalog.test.ts`

**Interfaces:**
- Consumes: Prisma client; `isPastEvent`
- Produces:
  - `confirmCandidate(db, input: { candidateId: string; name: string; eventAt: Date; lotLabel?: string; url?: string; officialPrice?: number; qualitativeScore?: number; platform?: Platform }): Promise<{ partyId: string; lotId: string | null }>`
    - Requires `name` and `eventAt`. Sets candidate `confirmed`. Creates `Party` (`upcoming` unless `isPastEvent`). If `lotLabel` or `url` or `officialPrice` present, creates `Lot` with `openedAt = now`. Sets `watchlistPosition` to `max(position)+1` when a lot is created and party is upcoming.
  - `rejectCandidate(db, candidateId: string): Promise<void>` — status `rejected`. No party.
  - `unlinkSignal(db, signalId: string): Promise<void>` — delete signal row; clear `message.partyId` if set. Message stays. Signal is gone so inbox treats the message as orphan (`class` in pista_* and no signal).
  - `markPastParties(db, now: Date): Promise<number>` — every `upcoming` with `isPastEvent(eventAt, now)` → `past`, and `watchlistPosition = null`.

- [ ] **Step 1: Write failing integration tests**

`tests/helpers/db.ts` — create `PrismaClient` from `process.env.DATABASE_URL`. Export `async function resetDb(db)` that `deleteMany` in FK order: HeatSnapshot, Signal, Lot, Message, PartyCandidate, Party, Sender, Group.

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { resetDb } from "../helpers/db";
import { confirmCandidate } from "@/catalog/confirm";
import { rejectCandidate } from "@/catalog/reject";
import { unlinkSignal } from "@/catalog/unlink";
import { markPastParties } from "@/catalog/mark-past";

const now = new Date("2026-09-03T15:00:00Z");

async function seedCandidate() {
  const group = await prisma.group.create({
    data: { waId: "g1", name: "ingressos", listen: true },
  });
  const sender = await prisma.sender.create({
    data: { waId: "s-admin", name: "Admin", role: "admin" },
  });
  const message = await prisma.message.create({
    data: {
      waMessageId: "w1",
      groupId: group.id,
      senderId: sender.id,
      sentAt: now,
      text: "ONIX 1 lote",
      class: "admin_promo",
    },
  });
  const candidate = await prisma.partyCandidate.create({
    data: {
      name: "ONIX",
      sourceMessageId: message.id,
      platform: "unknown",
    },
  });
  return { candidate, message, sender };
}

describe("catalog", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("confirm creates party and lot", async () => {
    const { candidate } = await seedCandidate();
    const r = await confirmCandidate(prisma, {
      candidateId: candidate.id,
      name: "ONIX",
      eventAt: new Date("2026-09-12T03:00:00Z"),
      lotLabel: "1º lote",
    });
    const party = await prisma.party.findUniqueOrThrow({ where: { id: r.partyId } });
    expect(party.name).toBe("ONIX");
    expect(party.watchlistPosition).toBe(1);
    expect(r.lotId).not.toBeNull();
    const c = await prisma.partyCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(c.status).toBe("confirmed");
  });

  it("reject does not create a party", async () => {
    const { candidate } = await seedCandidate();
    await rejectCandidate(prisma, candidate.id);
    expect(await prisma.party.count()).toBe(0);
    expect((await prisma.partyCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe("rejected");
  });

  it("unlink deletes the signal and leaves the message", async () => {
    const { sender } = await seedCandidate();
    const party = await prisma.party.create({
      data: { name: "ONIX", aliases: ["onix"], eventAt: new Date("2026-09-12T03:00:00Z") },
    });
    const group = await prisma.group.findFirstOrThrow();
    const msg = await prisma.message.create({
      data: {
        waMessageId: "w-sig",
        groupId: group.id,
        senderId: sender.id,
        sentAt: now,
        text: "procuro onix",
        class: "pista_procura",
        partyId: party.id,
      },
    });
    const signal = await prisma.signal.create({
      data: { type: "demand", partyId: party.id, messageId: msg.id, senderId: sender.id },
    });
    await unlinkSignal(prisma, signal.id);
    expect(await prisma.signal.count()).toBe(0);
    expect(await prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).toMatchObject({
      partyId: null,
    });
  });

  it("marks past parties in SP and clears watchlist", async () => {
    await prisma.party.create({
      data: {
        name: "VELHA",
        aliases: [],
        eventAt: new Date("2026-09-02T03:00:00Z"),
        watchlistPosition: 1,
      },
    });
    const n = await markPastParties(prisma, now);
    expect(n).toBe(1);
    const p = await prisma.party.findFirstOrThrow();
    expect(p.status).toBe("past");
    expect(p.watchlistPosition).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/catalog/catalog.test.ts`
Expected: FAIL (modules not found). Requires `DATABASE_URL` and Docker up.

- [ ] **Step 3: Implement the four catalog functions** as specified in Interfaces.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/catalog/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/catalog tests/catalog tests/helpers/db.ts
git commit -m "feat: confirm, reject, unlink, and mark-past catalog commands"
```

---

### Task 9: Ingest raw messages

**Files:**
- Create: `src/ingest/ingest.ts`, `tests/ingest/ingest.test.ts`

**Interfaces:**
- Consumes: `classifyMessage`, `extractCandidate`, `matchParty`, Prisma
- Produces:
  - `export type RawMessageInput = { waMessageId: string; groupWaId: string; groupName: string; senderWaId: string; senderName: string | null; sentAt: Date; text: string; senderIsGroupAdmin?: boolean }`
  - `export async function ingestRawMessage(db: PrismaClient, input: RawMessageInput): Promise<{ created: boolean; messageId: string }>`

Behavior:
1. Upsert `Group` on `waId` (do not change `listen` on upsert if the row exists; new groups get `listen: false`).
2. Upsert `Sender` on `waId`. If `senderIsGroupAdmin` and current role is `unknown`, set `role` to `admin`. Never overwrite a manual `pista`/`admin` with unknown.
3. If `waMessageId` exists, return `{ created: false, messageId }` and do not reclassify.
4. Insert `Message` with `class: null` (raw only). Connector and this function must not classify in the same breath if you split jobs — **v1 may classify immediately after insert in the same function** to keep the worker simple. Do that: after insert, set `class = classifyMessage({ text, senderRole: sender.role })`.
5. If `admin_promo`, create `PartyCandidate` pending from `extractCandidate(text, sentAt)` and set `message.candidate` via `sourceMessageId`.
6. If `pista_oferta` or `pista_procura`, `matchParty` against parties with `status: upcoming`. On hit, create `Signal` (`offer`/`demand`) and set `message.partyId`. On miss, leave orphan (no signal).
7. Never create a `Party` here.

- [ ] **Step 1: Write failing tests** for: first insert creates; second same `waMessageId` does not duplicate; admin promo creates pending candidate; pista demand with matching upcoming party creates signal; pista demand with only a past party of same name creates no signal and no party.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/ingest/ingest.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `ingestRawMessage`**

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/ingest/ingest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ingest/ingest.ts tests/ingest/ingest.test.ts
git commit -m "feat: ingest raw WhatsApp messages idempotently"
```

---

### Task 10: Heat snapshot job

**Files:**
- Create: `src/jobs/refresh-heat.ts`, `tests/jobs/heat.test.ts`

**Interfaces:**
- Consumes: `computeHeatScore`, `daysUntil`, `canRankOnHeat`
- Produces: `export async function refreshHeat(db: PrismaClient, now: Date): Promise<{ ok: true; parties: number } | { ok: false; error: string }>`

Behavior:
- Load all parties. For each with `canRankOnHeat(status)`, count signals whose `message.sentAt` is within 1/3/7 days of `now` (use `now - n*864e5`, not SP calendar, for windows — simple and deterministic).
- `uniqueDemandSenders7d` = distinct `senderId` of demand signals in 7d.
- Insert a new `HeatSnapshot` (do not delete old ones). On throw, catch and return `{ ok: false, error }` without deleting the previous snapshot.

- [ ] **Step 1: Write failing tests** — two demand signals (same sender) 2h apart + one offer; assert latest snapshot score equals the formula; assert a second `refreshHeat` that throws (simulate by passing a broken db or spy) is not required — instead test that calling `refreshHeat` twice leaves two snapshots and the UI helper `latestSnapshot` (export from the same file) returns the newest. Also: party `past` gets no new snapshot.

```ts
export function latestSnapshot<T extends { computedAt: Date }>(
  snaps: T[],
): T | null {
  return snaps.slice().sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime())[0] ?? null;
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/jobs/heat.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `refreshHeat` and `latestSnapshot`**

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/jobs/heat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jobs/refresh-heat.ts tests/jobs/heat.test.ts
git commit -m "feat: batch heat snapshots without wiping previous scores"
```

---

### Task 11: Worker entrypoint

**Files:**
- Create: `src/jobs/main.ts`, `src/jobs/mark-past.ts`, `tests/jobs/mark-past.test.ts`, `tests/connector/status.test.ts` (status used here so worker can run disconnected)
- Create: `src/connector/status.ts`

**Interfaces:**
- Consumes: `markPastParties`, `refreshHeat`, `isListenDay`
- Produces:
  - `export type WaStatus = { state: "connected" | "qr" | "disconnected"; updatedAt: string; detail?: string }`
  - `export function readWaStatus(path: string): WaStatus` — if file missing, `{ state: "disconnected", updatedAt: new Date(0).toISOString(), detail: "missing-session" }`
  - `export function writeWaStatus(path: string, status: WaStatus): void`
  - `export async function runWorkerOnce(db: PrismaClient, now: Date): Promise<void>` — always `markPastParties` then `refreshHeat`, regardless of WhatsApp status

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { readWaStatus } from "@/connector/status";
import { runWorkerOnce } from "@/jobs/main";
import { prisma } from "@/db/client";
import { resetDb } from "../helpers/db";

describe("wa status", () => {
  it("missing file is disconnected", () => {
    expect(readWaStatus("/tmp/lumberjack-no-such-status.json").state).toBe("disconnected");
  });
});

describe("runWorkerOnce", () => {
  it("marks past even when wa is disconnected", async () => {
    await resetDb(prisma);
    await prisma.party.create({
      data: { name: "OLD", aliases: [], eventAt: new Date("2026-01-01T03:00:00Z") },
    });
    await runWorkerOnce(prisma, new Date("2026-09-03T15:00:00Z"));
    expect((await prisma.party.findFirstOrThrow()).status).toBe("past");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/connector/status.test.ts tests/jobs/mark-past.test.ts`
If you colocate both tests in the files above, run those paths. Expected: FAIL

- [ ] **Step 3: Implement `readWaStatus` / `writeWaStatus` with `fs` read/write JSON. Implement `runWorkerOnce`. `src/jobs/main.ts` when executed as CLI: connect prisma, `runWorkerOnce(prisma, new Date())`, disconnect.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/connector/status.test.ts tests/jobs/mark-past.test.ts`
Expected: PASS. Also `npx tsx src/jobs/main.ts` should exit 0 with Docker up.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/main.ts src/jobs/mark-past.ts src/connector/status.ts tests/connector/status.test.ts tests/jobs/mark-past.test.ts
git commit -m "feat: worker runs heat and mark-past without WhatsApp"
```

---

### Task 12: Auth cookie

**Files:**
- Create: `src/auth/cookie.ts`, `src/middleware.ts`, `src/app/login/page.tsx`, `tests/auth/cookie.test.ts`

**Interfaces:**
- Consumes: `process.env.AUTH_PASSWORD`, `process.env.AUTH_DISABLED`
- Produces:
  - `COOKIE = "lumberjack_session"`
  - `export function authDisabled(): boolean` — `process.env.AUTH_DISABLED === "1"`
  - `export function makeSessionToken(password: string, secret: string): string` — `sha256(password + ":" + secret)` hex
  - `export function isValidSession(token: string | undefined, password: string, secret: string): boolean`
  - Middleware: if `authDisabled()` allow. Else if path is `/login` or `/_next` allow. Else if cookie valid allow. Else redirect `/login`.
  - Login server action: if password === `AUTH_PASSWORD`, set cookie to `makeSessionToken(password, AUTH_PASSWORD)`, redirect `/`.

Use `AUTH_PASSWORD` as both password and secret in v1 (single operator). Document that in `.env.example`.

- [ ] **Step 1: Write failing tests** for `authDisabled`, `isValidSession` true/false, empty token.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/auth/cookie.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement cookie helpers + middleware + a minimal login form (`Senha`, POST).

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/auth/cookie.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth src/middleware.ts src/app/login/page.tsx tests/auth/cookie.test.ts
git commit -m "feat: single-password session with AUTH_DISABLED escape"
```

---

### Task 13: Inbox

**Files:**
- Create: `src/app/inbox/page.tsx`, `src/app/actions/catalog.ts`, `src/components/nav.tsx`
- Modify: `src/app/layout.tsx` to include `<Nav />` except on `/login`

**Interfaces:**
- Consumes: `confirmCandidate`, `rejectCandidate`, `matchParty` (for “vincular órfão”)
- Produces: server actions `actionConfirmCandidate(formData)`, `actionRejectCandidate(formData)`, `actionLinkOrphan(formData)` — `linkOrphan` takes `messageId` + `partyId`, creates Signal from message class (`pista_procura` → demand, `pista_oferta` → offer), sets `message.partyId`.

Inbox query:
- Candidates `status: pending`
- Orphans: messages where `class` in `pista_oferta`/`pista_procura` and no `signals`

UI (Portuguese): lists both. Confirm form: name, datetime-local `eventAt`, optional lot, url, price, nota 1–5. Reject button. Orphan: select of upcoming parties + Vincular.

- [ ] **Step 1: Write a catalog unit test** `linkOrphan` in `tests/catalog/catalog.test.ts` (add `src/catalog/link-orphan.ts`) — orphan message becomes a demand signal.

- [ ] **Step 2: Run that test — expect FAIL, then implement `linkOrphan`, expect PASS**

- [ ] **Step 3: Build the Inbox page and actions. No Playwright in v1 — visual check: `npm run dev`, open `/inbox` with empty DB (empty states: “Nenhum candidato”, “Nenhum órfão”).

- [ ] **Step 4: Commit**

```bash
git add src/catalog/link-orphan.ts src/app/inbox src/app/actions/catalog.ts src/components/nav.tsx src/app/layout.tsx tests/catalog/catalog.test.ts
git commit -m "feat: inbox to confirm candidates and link orphan signals"
```

---

### Task 14: Watchlist and home routing

**Files:**
- Create: `src/app/watchlist/page.tsx`, `src/app/actions/watchlist.ts`, `src/catalog/watchlist.ts`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `canAppearOnWatchlist`, `latestSnapshot`
- Produces:
  - `listWatchlist(db)` — parties with upcoming + at least one lot `closedAt: null`, order by `watchlistPosition` asc
  - `moveWatchlist(db, partyId, direction: "up" | "down")` — swap positions
  - `removeFromWatchlist(db, partyId)` — `watchlistPosition = null`
  - `closeLot(db, lotId, now)` — set `closedAt`. If party has no remaining open lots, `watchlistPosition = null`
  - `homeDestination(db)` — if pending candidates or orphans exist → `/inbox`; else if watchlist non-empty → `/watchlist`; else → `/heat`

Row UI: nome, data (`eventAt` in SP), lote label, link, nota, badge “edição anterior” if another party exists with same normalized name (or shared alias) and `status: past`, discrete heat `latestSnapshot.score ?? "—"`. Actions: detalhe, sair da fila, fechar lote. Buttons up/down.

- [ ] **Step 1: Tests in `tests/catalog/catalog.test.ts`** for `moveWatchlist` swap, `closeLot` clearing position, `homeDestination` three branches. Write first, expect FAIL.

- [ ] **Step 2: Implement catalog helpers — expect PASS**

- [ ] **Step 3: Implement pages and `src/app/page.tsx` as `redirect(await homeDestination(prisma))`**

- [ ] **Step 4: Commit**

```bash
git add src/catalog/watchlist.ts src/app/watchlist src/app/actions/watchlist.ts src/app/page.tsx tests/catalog/catalog.test.ts
git commit -m "feat: operator-ordered watchlist and home routing"
```

---

### Task 15: Heat board and party detail

**Files:**
- Create: `src/app/heat/page.tsx`, `src/app/parties/[id]/page.tsx`, `src/app/actions/party.ts`

**Interfaces:**
- Consumes: `canRankOnHeat`, `latestSnapshot`, `unlinkSignal`
- Produces:
  - Heat page: upcoming parties, sort by latest snapshot score desc (null score last). Columns: nome, procura 1/3/7, oferta 1/3, autores 7d, dias, score, `atualizado em`. Query `?janela=1|3|7` only changes which procura/oferta numbers are emphasized (bold that window); sort remains the stored `score`. Query `?grupo=` filters parties that have at least one message in that group.
  - If latest snapshot missing: show party at bottom, score `—`.
  - Party detail: edit name, `eventAt`, status (`upcoming|past|cancelled`), aliases (comma-separated), nota, notes. Lots table with close action. Timeline: messages with `partyId` plus candidate source if any, plus signals. `past`/`cancelled`: no “abrir lote” / no watchlist CTA. Action desvincular → `unlinkSignal`.
  - `updateParty` server action. `addLot` (label, url, price, platform) with `openedAt = now` and assign watchlist position if upcoming and position null.

- [ ] **Step 1: No new domain tests required if catalog already covers unlink. Add `tests/catalog/catalog.test.ts` case: `addLot` on upcoming party with null position sets position.

- [ ] **Step 2: Implement pages. Smoke: empty heat table header still renders; fixture party appears after confirm + `refreshHeat`.

- [ ] **Step 3: Commit**

```bash
git add src/app/heat src/app/parties src/app/actions/party.ts tests/catalog/catalog.test.ts
git commit -m "feat: heat board and party detail editor"
```

---

### Task 16: Setup and Baileys connector

**Files:**
- Create: `src/app/setup/page.tsx`, `src/app/actions/setup.ts`, `src/connector/main.ts`
- Modify: `src/components/nav.tsx` (link Setup)

**Interfaces:**
- Consumes: `readWaStatus`, `writeWaStatus`, `ingestRawMessage`, `isListenDay`
- Produces:
  - Setup page: session banner (`Conectado` / `QR pendente` / `WhatsApp desconectado` — never hide catalog). Table of groups with listen toggle. Table of senders with role select (`admin|pista|unknown`).
  - `setGroupListen(id, listen)`, `setSenderRole(id, role)`
  - Connector process:
    1. Read `WA_AUTH_DIR`. If empty, Baileys prints QR and `writeWaStatus({ state: "qr" })`.
    2. On open, `writeWaStatus({ state: "connected" })`.
    3. If `!isListenDay(now)` log and stay connected but do not ingest (or sleep until next listen day). Spec: listener pulls Tue–Sat; being connected on Mon is OK as long as ingest is skipped.
    4. For each chat that is a group: upsert Group name/`waId`. On message upsert, if group.listen, call `ingestRawMessage`. A failed group/message is logged; continue others.
    5. On disconnect, `writeWaStatus({ state: "disconnected", detail })`. Do not delete messages or auth unless the user deletes `WA_AUTH_DIR`.
    6. Changing number = stop process, replace `WA_AUTH_DIR` contents, start again.

Do not add Baileys to unit tests. The missing-file status test in Task 11 covers CI.

Install `@whiskeysockets/baileys` and `qrcode-terminal`.

Keep `src/connector/main.ts` small: connection bootstrap + message handler calling `ingestRawMessage`. No classification in this file.

- [ ] **Step 1: Implement setup actions + page**

- [ ] **Step 2: Implement connector. Manual check: `npm run connector` shows QR or `disconnected` written to `data/wa-status.json`.

- [ ] **Step 3: Commit**

```bash
git add src/app/setup src/app/actions/setup.ts src/connector/main.ts src/components/nav.tsx package.json package-lock.json
git commit -m "feat: setup toggles and Baileys connector writing raw messages"
```

---

### Task 17: Fixture smoke and README

**Files:**
- Create: `prisma/seed.ts`, `README.md`
- Modify: `package.json` (`"db:seed": "tsx prisma/seed.ts"`)

**Interfaces:**
- Consumes: all catalog + ingest
- Produces: seed with 1 listen group, 1 admin sender, 1 pista sender, 1 upcoming party + open lot, 1 past party same name (badge), ~20 messages covering admin promo, procura, oferta, ruido; then `refreshHeat`.

- [ ] **Step 1: Write `prisma/seed.ts` that uses `ingestRawMessage` for the 20 texts (so classification is real), plus `confirmCandidate` for the upcoming party.

- [ ] **Step 2: Run seed**

Run: `npx tsx prisma/seed.ts`
Expected: exit 0. `npm run dev` — `/` routes to `/watchlist` or `/inbox` depending on leftover pending candidates (seed should confirm the main party and reject leftovers so home is `/watchlist`). Heat shows a score. Past party is not on heat. Party detail of past has no buy CTA.

- [ ] **Step 3: README** — how to `db:up`, migrate, seed, `dev`, `worker`, `connector`; warn unofficial WhatsApp / personal-number week / `AUTH_DISABLED`; timezone SP.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts README.md package.json
git commit -m "docs: seed fixture and runbook for the v1 board"
```

---

## Self-review

Spec coverage:
- Jobs A+D, human watchlist, heat batch → Tasks 14–15, 10
- Admin vs pista, candidate ≠ party, pista never creates party → Tasks 3, 9
- Date gate / SP / past off boards → Tasks 2, 5, 8, 11
- Heat formula, daysToEvent display-only → Task 6, 15
- Idempotent waMessageId → Task 9
- WA disconnected does not wipe data; worker still runs → Task 11, 16
- Four screens + setup + home routing → Tasks 13–16, 14
- Auth env → Task 12
- Out of scope left out → no tasks for scrape, allocation, digest, LLM

Type names locked: `SenderRole`, `MessageClass`, `PartyStatus`, `Platform`, `HeatCounts`, `RawMessageInput`, `WaStatus`, `confirmCandidate`, `ingestRawMessage`, `refreshHeat`, `runWorkerOnce`, `computeHeatScore`, `matchParty`.
