# Lumberjack UI Professional v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 CSS kit with Tailwind + shadcn so the six existing routes look and operate like a professional dark tool — in-place actions, toasts, desktop sidebar + mobile cards — without changing product rules.

**Architecture:** Server pages keep Prisma queries, gates, and sort. They pass serializable props into client `*Board` components. Boards call the existing server actions via `useTransition` + `runAction` (toast + `router.refresh()`). Shell is a new client/server pair that wraps every route.

**Tech Stack:** Next.js 16 App Router, React 19, Node 24, Tailwind CSS v4, shadcn/ui New York (dark only), Sonner, lucide-react, Geist via `next/font/google`. No RTL, no Playwright, no MUI.

## Global Constraints

- Background `#0C0A0F`, surface `#16131C`, line `#2A2633`, text `#F4F1EA`, muted `#9A93A5`, accent lime `#C8F542`, danger `#F0718B`, radius `10px`.
- Lime only on: active nav, heat score, heat/“esquentou” badge, focus, primary button.
- Danger only on reject / disconnect / unlink. Fechar lote is ghost, not danger.
- Single breakpoint: Tailwind `md` = **768px**. Sidebar + tables above; bottom nav + cards below.
- Session strip when WhatsApp ≠ `connected`; boards stay clickable; hidden on `/login`.
- Empty states: Watchlist/Heat = one sentence + link(s). Inbox/Setup/lots/timeline = sentence only.
- Do not change classify, ingest, watchlist order, heat formula, date gates, or Baileys.
- UI copy in Portuguese. Toast fail: `Não deu. Tenta de novo.`
- `npm test` stays `tsc --noEmit && vitest run --fileParallelism false`.
- `sessionBanner()` in `src/components/ui/session-banner.ts` stays; do not rewrite it.
- Server actions stay; do not add routes.
- Node 24 (`nvm use` / `.nvmrc`). `DATABASE_URL=postgresql://lumberjack:lumberjack@localhost:5432/lumberjack` for tests.
- Do not commit `.cursor/` or `.superpowers/`. Do not stop other Docker containers.

## File map

```
src/app/globals.css                         # Tailwind v4 + shadcn tokens (replaces v1 rules)
src/app/layout.tsx                          # Geist, dark, AppShell, Toaster
src/lib/utils.ts                            # cn()
src/lib/toast-copy.ts                       # FAIL_TOAST + TOAST
src/lib/run-action.ts                       # try/catch toast + refresh
src/lib/datetime.ts                         # formatWhen / toDatetimeLocal
src/lib/nav.ts                              # isNavActive
src/components/ui/session-banner.ts         # KEEP
src/components/ui/{button,badge,card,...}   # shadcn primitives (CLI)
src/components/shell/app-nav.tsx
src/components/shell/session-strip.tsx
src/components/shell/app-shell.tsx
src/components/watchlist/watchlist-board.tsx
src/components/heat/heat-board.tsx
src/components/inbox/inbox-board.tsx
src/components/party/party-board.tsx
src/components/setup/setup-board.tsx
src/app/{watchlist,heat,inbox,setup,login}/page.tsx
src/app/parties/[id]/page.tsx
tests/ui/toast-copy.test.ts
tests/ui/nav.test.ts
tests/lib/datetime.test.ts
```

Delete after Task 8: `src/components/ui/{shell,shell-nav,hide-on-login,banner,data-table}.tsx` if unused (button/badge/card become shadcn).

---

### Task 1: Tailwind, tokens, toast copy, datetime

**Files:**
- Create: `postcss.config.mjs`, `components.json`, `src/lib/utils.ts`, `src/lib/toast-copy.ts`, `src/lib/datetime.ts`, `src/lib/run-action.ts`, `tests/ui/toast-copy.test.ts`, `tests/lib/datetime.test.ts`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `package.json` (via npm)
- Test: `tests/ui/toast-copy.test.ts`, `tests/lib/datetime.test.ts`, `tests/ui/session-banner.test.ts`

**Interfaces:**
- Consumes: `TZ` from `@/domain/timezone` (`"America/Sao_Paulo"`)
- Produces: `cn(...)`; `FAIL_TOAST`; `TOAST` object below; `formatWhen(iso: string): string`; `toDatetimeLocal(iso: string): string`; `runAction(action, data, success, refresh): Promise<void>`

`TOAST` exact keys and values:

```ts
export const FAIL_TOAST = "Não deu. Tenta de novo.";
export const TOAST = {
  up: "Subiu",
  down: "Desceu",
  leftQueue: "Saiu da fila",
  lotClosed: "Lote fechado",
  confirmed: "Festa confirmada",
  rejected: "Candidato rejeitado",
  linked: "Mensagem vinculada",
  unlinked: "Desvinculado",
  saved: "Salvo",
  listening: "Ouvindo",
  paused: "Pausado",
  enrolled: "Entrou na fila",
  lotOpened: "Lote aberto",
} as const;
```

- [ ] **Step 1: Write failing tests**

`tests/ui/toast-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FAIL_TOAST, TOAST } from "@/lib/toast-copy";

describe("toast copy", () => {
  it("fail message is the locked sentence", () => {
    expect(FAIL_TOAST).toBe("Não deu. Tenta de novo.");
  });

  it("success verbs match the spec", () => {
    expect(TOAST.up).toBe("Subiu");
    expect(TOAST.confirmed).toBe("Festa confirmada");
    expect(TOAST.unlinked).toBe("Desvinculado");
  });
});
```

`tests/lib/datetime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatWhen, toDatetimeLocal } from "@/lib/datetime";

describe("datetime", () => {
  it("formats an ISO instant in America/Sao_Paulo", () => {
    const iso = "2026-10-04T03:00:00.000Z";
    expect(formatWhen(iso)).toMatch(/04\/10\/2026/);
    expect(toDatetimeLocal(iso)).toBe("2026-10-04T00:00");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
DATABASE_URL=postgresql://lumberjack:lumberjack@localhost:5432/lumberjack \
  npx vitest run tests/ui/toast-copy.test.ts tests/lib/datetime.test.ts --fileParallelism false
```

Expected: FAIL — cannot resolve `@/lib/toast-copy` / `@/lib/datetime`.

- [ ] **Step 3: Install Tailwind v4 + shadcn primitives**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
npm install tailwindcss @tailwindcss/postcss class-variance-authority clsx tailwind-merge lucide-react sonner tw-animate-css
```

Write `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

Write `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

Write `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Replace `src/app/globals.css` entirely with:

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --background: #0c0a0f;
  --foreground: #f4f1ea;
  --card: #16131c;
  --card-foreground: #f4f1ea;
  --popover: #16131c;
  --popover-foreground: #f4f1ea;
  --primary: #c8f542;
  --primary-foreground: #0c0a0f;
  --secondary: #16131c;
  --secondary-foreground: #f4f1ea;
  --muted: #16131c;
  --muted-foreground: #9a93a5;
  --accent: #16131c;
  --accent-foreground: #f4f1ea;
  --destructive: #f0718b;
  --border: #2a2633;
  --input: #2a2633;
  --ring: #c8f542;
  --radius: 10px;
  --sidebar: #0c0a0f;
  --sidebar-foreground: #f4f1ea;
  --sidebar-border: #2a2633;
  --sidebar-accent: #16131c;
  --sidebar-accent-foreground: #c8f542;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --font-sans: var(--font-geist);
}

html { color-scheme: dark; }

body {
  @apply bg-background text-foreground antialiased;
}

a { @apply underline decoration-border underline-offset-2; }
nav a { @apply no-underline; }
```

Then generate primitives (non-interactive):

```bash
npx shadcn@latest add button badge card table input select label alert sonner separator textarea --yes
```

If the CLI asks anything, pass `--overwrite` and `--yes`. After add, confirm `src/components/ui/button.tsx` exists and uses `cn`. Do **not** delete `session-banner.ts`. Old `shell.tsx` / `data-table.tsx` may break visually until later tasks; keep them compiling.

Write `src/lib/toast-copy.ts` with the exact `FAIL_TOAST` / `TOAST` block above.

Write `src/lib/datetime.ts`:

```ts
import { TZ } from "@/domain/timezone";

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function toDatetimeLocal(iso: string): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date(iso)).replace(" ", "T");
}
```

Write `src/lib/run-action.ts`:

```ts
"use client";

import { toast } from "sonner";
import { FAIL_TOAST } from "@/lib/toast-copy";

export async function runAction(
  action: (data: FormData) => Promise<void>,
  data: FormData,
  success: string,
  refresh: () => void,
): Promise<void> {
  try {
    await action(data);
    toast.success(success);
    refresh();
  } catch {
    toast.error(FAIL_TOAST);
  }
}
```

Update `src/app/layout.tsx` — add Geist + `dark` class + Toaster. Keep existing `Shell` import so the app still boots:

```tsx
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Shell } from "@/components/ui/shell";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`dark ${geist.variable}`}>
      <body className="font-sans">
        <Shell>{children}</Shell>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
```

If `next/font/google` has no `Geist` export, use:

```ts
import { GeistSans } from "geist/font/sans";
```

and `npm install geist`, then `className={GeistSans.variable}` with `--font-geist` mapped in the geist package docs. Prefer `next/font/google` Geist first.

- [ ] **Step 4: Run tests**

```bash
DATABASE_URL=postgresql://lumberjack:lumberjack@localhost:5432/lumberjack npm test
```

Expected: `tsc` PASS, all previous tests PASS, new toast-copy + datetime PASS. `session-banner` still 3/3.

- [ ] **Step 5: Commit**

```bash
git add postcss.config.mjs components.json src/lib src/app/globals.css src/app/layout.tsx src/components/ui package.json package-lock.json tests/ui/toast-copy.test.ts tests/lib/datetime.test.ts
git commit -m "feat: add Tailwind, shadcn tokens, and toast copy"
```

Do not add leftover `shell.tsx` deletions yet.

---

### Task 2: AppShell, nav, session strip

**Files:**
- Create: `src/lib/nav.ts`, `tests/ui/nav.test.ts`, `src/components/shell/app-nav.tsx`, `src/components/shell/session-strip.tsx`, `src/components/shell/app-shell.tsx`
- Modify: `src/app/layout.tsx`
- Delete: `src/components/ui/shell.tsx`, `src/components/ui/shell-nav.tsx`, `src/components/ui/hide-on-login.tsx`

**Interfaces:**
- Consumes: `sessionBanner(state)` → `{ tone: "accent" | "muted" | "danger"; text: string } | null`; `readWaStatus(path)` from `@/connector/status`
- Produces: `isNavActive(pathname: string, href: string): boolean`; `AppShell({ children })`

`isNavActive` rule: `pathname === href` OR (`href !== "/"` AND `pathname.startsWith(href + "/")`) OR (`pathname.startsWith(href)` AND href is not a prefix of another live route). Locked implementation:

```ts
export const NAV_LINKS = [
  { href: "/watchlist", label: "Watchlist" },
  { href: "/heat", label: "Calor" },
  { href: "/inbox", label: "Inbox" },
  { href: "/setup", label: "Setup" },
] as const;

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

`/parties/x` matches none of the four hrefs.

- [ ] **Step 1: Write failing nav tests**

`tests/ui/nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isNavActive } from "@/lib/nav";

describe("isNavActive", () => {
  it("marks the exact route", () => {
    expect(isNavActive("/watchlist", "/watchlist")).toBe(true);
  });

  it("does not mark heat when on watchlist", () => {
    expect(isNavActive("/watchlist", "/heat")).toBe(false);
  });

  it("does not mark any tab on party detail", () => {
    expect(isNavActive("/parties/abc", "/watchlist")).toBe(false);
    expect(isNavActive("/parties/abc", "/heat")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run tests/ui/nav.test.ts --fileParallelism false
```

Expected: FAIL — `@/lib/nav` missing.

- [ ] **Step 3: Implement nav + shell**

Write `src/lib/nav.ts` with the exact `NAV_LINKS` + `isNavActive` above.

`src/components/shell/app-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavActive, NAV_LINKS } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function AppNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <nav
      className={cn(
        "border-border bg-sidebar z-20 flex items-center gap-4 border-b px-4 py-3",
        "md:fixed md:inset-y-0 md:h-full md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0",
        "fixed right-0 bottom-0 left-0 justify-around border-t border-b-0 md:justify-start",
      )}
    >
      <span className="text-foreground hidden font-semibold md:block">
        Lumberjack
      </span>
      {NAV_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "text-muted-foreground hover:text-foreground text-sm no-underline",
            isNavActive(pathname, l.href) && "text-primary font-medium",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
```

`src/components/shell/session-strip.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sessionBanner } from "@/components/ui/session-banner";

export function SessionStrip({
  state,
}: {
  state: "connected" | "qr" | "disconnected";
}) {
  const pathname = usePathname();
  const banner = sessionBanner(state);
  if (!banner || pathname === "/login") return null;
  const cls =
    banner.tone === "danger"
      ? "border-destructive text-destructive"
      : "border-primary text-primary";
  return (
    <Link
      href="/setup"
      className={`mb-4 block rounded-[10px] border px-3 py-2 text-sm no-underline ${cls}`}
    >
      {banner.text}
    </Link>
  );
}
```

`src/components/shell/app-shell.tsx` (server):

```tsx
import { readWaStatus } from "@/connector/status";
import { AppNav } from "./app-nav";
import { SessionStrip } from "./session-strip";

export function AppShell({ children }: { children: React.ReactNode }) {
  const status = readWaStatus(
    process.env.WA_STATUS_PATH ?? "./data/wa-status.json",
  );
  return (
    <>
      <AppNav />
      <div className="md:pl-56">
        <div className="mx-auto max-w-[1100px] px-4 pt-4 pb-24 md:pb-8">
          <SessionStrip state={status.state} />
          {children}
        </div>
      </div>
    </>
  );
}
```

`layout.tsx`: replace `<Shell>` with `<AppShell>`. Keep Toaster. Delete the three old shell files. Grep `src/` for `from "@/components/ui/shell"` — zero hits.

- [ ] **Step 4: Tests**

```bash
DATABASE_URL=postgresql://lumberjack:lumberjack@localhost:5432/lumberjack npm test
```

Expected: PASS including `tests/ui/nav.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav.ts tests/ui/nav.test.ts src/components/shell src/app/layout.tsx
git rm src/components/ui/shell.tsx src/components/ui/shell-nav.tsx src/components/ui/hide-on-login.tsx
git commit -m "feat: add AppShell with sidebar and session strip"
```

---

### Task 3: Watchlist board

**Files:**
- Create: `src/components/watchlist/watchlist-board.tsx`
- Modify: `src/app/watchlist/page.tsx`

**Interfaces:**
- Consumes: `actionMoveWatchlist`, `actionRemoveFromWatchlist`, `actionCloseLot` from `@/app/actions/watchlist` (FormData: `partyId` + `direction` `up`|`down`; `partyId`; `lotId`). `runAction`, `TOAST`, `formatWhen`, shadcn `Button` `Card` `Badge`.
- Produces: `WatchlistItem` type and `WatchlistBoard({ items }: { items: WatchlistItem[] })`

```ts
export type WatchlistItem = {
  id: string;
  name: string;
  eventAt: string;
  lotLabels: string;
  lotUrl: string | null;
  heat: number | null;
  previousEdition: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  openLotIds: string[];
};
```

- [ ] **Step 1: No RTL — typecheck is the gate.** Implement `WatchlistBoard` as a client component.

Exact board (write this file):

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  actionCloseLot,
  actionMoveWatchlist,
  actionRemoveFromWatchlist,
} from "@/app/actions/watchlist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatWhen } from "@/lib/datetime";
import { runAction } from "@/lib/run-action";
import { TOAST } from "@/lib/toast-copy";

export type WatchlistItem = {
  id: string;
  name: string;
  eventAt: string;
  lotLabels: string;
  lotUrl: string | null;
  heat: number | null;
  previousEdition: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  openLotIds: string[];
};

export function WatchlistBoard({ items }: { items: WatchlistItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const refresh = () => router.refresh();

  function submit(
    action: (fd: FormData) => Promise<void>,
    fd: FormData,
    success: string,
  ) {
    start(() => runAction(action, fd, success, refresh));
  }

  if (items.length === 0) {
    return (
      <Card className="p-6">
        <p>Nenhuma festa na fila</p>
        <p className="text-muted-foreground mt-2 text-sm">
          <Link href="/inbox">Inbox</Link> · <Link href="/heat">Calor</Link>
        </p>
      </Card>
    );
  }

  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={item.id}>
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-muted-foreground w-6 tabular-nums">
                {index + 1}.
              </span>
              <strong>{item.name}</strong>
              {item.previousEdition ? (
                <Badge variant="outline">edição anterior</Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-2 text-sm">
              Data {formatWhen(item.eventAt)}
            </p>
            <p className="text-sm">Lote {item.lotLabels || "—"}</p>
            <p className="text-sm">
              Link{" "}
              {item.lotUrl ? (
                <a href={item.lotUrl} rel="noreferrer">
                  {item.lotUrl}
                </a>
              ) : (
                "—"
              )}
            </p>
            <p className="text-sm">
              Calor{" "}
              <span className="text-primary font-semibold tabular-nums">
                {item.heat ?? "—"}
              </span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/parties/${item.id}`}>Detalhe</Link>
              </Button>
              {item.canMoveUp ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("partyId", item.id);
                    fd.set("direction", "up");
                    submit(actionMoveWatchlist, fd, TOAST.up);
                  }}
                >
                  Subir
                </Button>
              ) : null}
              {item.canMoveDown ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("partyId", item.id);
                    fd.set("direction", "down");
                    submit(actionMoveWatchlist, fd, TOAST.down);
                  }}
                >
                  Descer
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("partyId", item.id);
                  submit(actionRemoveFromWatchlist, fd, TOAST.leftQueue);
                }}
              >
                Sair da fila
              </Button>
              {item.openLotIds.map((lotId) => (
                <Button
                  key={lotId}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("lotId", lotId);
                    submit(actionCloseLot, fd, TOAST.lotClosed);
                  }}
                >
                  Fechar lote
                </Button>
              ))}
            </div>
          </Card>
        </li>
      ))}
    </ol>
  );
}
```

If shadcn `Button` has no `asChild`, use `<Button variant="ghost" size="sm"><Link href={...}>Detalhe</Link></Button>` or a ghost `Link` with button classes via `cn`.

- [ ] **Step 2: Thin the server page**

`src/app/watchlist/page.tsx` keeps `listWatchlist` + `hasPreviousEdition` + `latestSnapshot`. Map to `WatchlistItem[]` (`eventAt: party.eventAt.toISOString()`). Render:

```tsx
<main className="space-y-6">
  <h1 className="text-2xl font-semibold">Watchlist</h1>
  <WatchlistBoard items={items} />
</main>
```

Do not change `listWatchlist` or action files.

- [ ] **Step 3: `npx tsc --noEmit`** — PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/watchlist/watchlist-board.tsx src/app/watchlist/page.tsx
git commit -m "feat: professional watchlist board with in-place actions"
```

---

### Task 4: Heat board

**Files:**
- Create: `src/components/heat/heat-board.tsx`
- Modify: `src/app/heat/page.tsx`

**Interfaces:**
- Consumes: existing heat query/sort on the server (`canRankOnHeat`, null score last). Query params `janela`, `grupo` unchanged.
- Produces: `HeatBoard` props:

```ts
export type HeatRow = {
  id: string;
  name: string;
  score: number | null;
  procura1: number | null;
  procura3: number | null;
  procura7: number | null;
  oferta1: number | null;
  oferta3: number | null;
  autores7d: number | null;
  days: number | null;
};

export type HeatGroup = { id: string; name: string };

export function HeatBoard(props: {
  janela: 1 | 3 | 7 | null;
  grupo: string;
  groups: HeatGroup[];
  rows: HeatRow[];
  updatedAt: string | null;
}): JSX.Element;
```

- [ ] **Step 1: Implement HeatBoard**

Client or server is fine for Heat (filters are GET). Use **server-compatible** (no `"use client"`) unless you need one. Chips = `Link` to `/heat?janela=1` etc preserving `grupo`. Active chip = `<Badge>` with lima (`className="bg-primary text-primary-foreground"`).

Desktop: `Table` / `TableHeader` / `TableBody` from `@/components/ui/table` with `hidden md:table` (or `className="hidden md:table"` on table and a `md:hidden` card list).

Column order: Nome, Score, Procura 1, 3, 7, Oferta 1, 3, Autores 7d, Dias. Score: `<span className="text-primary font-semibold tabular-nums">{n}</span>` or `—`. No “Atualizado em” column.

Header: `h1` Calor + if `updatedAt` then `<p className="text-muted-foreground text-sm">Atualizado em {formatWhen(updatedAt)}</p>`.

Grupo form: `<form method="GET" action="/heat">` with hidden `janela` if set, `Select` or native `<select name="grupo">` + ghost Filtrar. Empty: Card “Nenhuma festa no calor” + `<Link href="/inbox">Inbox</Link>`.

Janela headers: the Procura/Oferta column matching `janela` is `font-semibold`.

- [ ] **Step 2: Map in `heat/page.tsx`**

Keep the existing fetch + `sort`. Map `demand1d` → `procura1`, etc. `updatedAt: latestComputedAt?.toISOString() ?? null`. Remove old Banner/DataTable markup.

- [ ] **Step 3: `npx tsc --noEmit`** — PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/heat/heat-board.tsx src/app/heat/page.tsx
git commit -m "feat: professional heat table and cards"
```

---

### Task 5: Inbox board

**Files:**
- Create: `src/components/inbox/inbox-board.tsx`
- Modify: `src/app/inbox/page.tsx`

**Interfaces:**
- Consumes: `actionConfirmCandidate` (fields `candidateId`, `name`, `eventAt`, `lot`, `url`, `price`, `nota`), `actionRejectCandidate` (`candidateId`), `actionLinkOrphan` (`messageId`, `partyId` required). `matchParty` stays on the **server page** to set `defaultPartyId`.
- Produces:

```ts
export type InboxCandidate = {
  id: string;
  sourceText: string;
  name: string;
  eventAtLocal: string;
  lot: string;
  url: string;
  price: string;
};

export type InboxOrphan = {
  id: string;
  text: string;
  sender: string;
  defaultPartyId: string;
};

export function InboxBoard(props: {
  candidates: InboxCandidate[];
  orphans: InboxOrphan[];
  upcoming: { id: string; name: string }[];
}): JSX.Element;
```

`eventAtLocal` is already `toDatetimeLocal(iso)` from the server (or empty string).

- [ ] **Step 1: Implement InboxBoard** (`"use client"`)

Layout: `grid gap-8 md:grid-cols-2`. Left `h2` Candidatos, right Órfãos.

Each candidate: `Card`, source `<p className="text-muted-foreground text-sm">`, form with shadcn `Input`/`Label`, `required` on name + `eventAt`. Confirm via `runAction(..., TOAST.confirmed)`. Reject separate `Button variant="destructive"` + `TOAST.rejected`. `disabled={pending}`.

Each orphan: `Card`, text, `select name="partyId"` required, defaultValue `defaultPartyId`, options from `upcoming`, Vincular → `TOAST.linked`.

Empty: `<p>Nenhum candidato</p>` / `<p>Nenhum órfão</p>` — no links.

- [ ] **Step 2: Thin inbox page**

Keep the three Prisma queries. Map candidates/orphans/upcoming. `matchParty(message.text, matchInputs)` for `defaultPartyId`. `eventAtLocal` from `toDatetimeLocal(candidate.eventAt.toISOString())` when `eventAt` is set.

```tsx
<main className="space-y-6">
  <h1 className="text-2xl font-semibold">Inbox</h1>
  <InboxBoard candidates={...} orphans={...} upcoming={...} />
</main>
```

- [ ] **Step 3: `npx tsc --noEmit`** — PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/inbox/inbox-board.tsx src/app/inbox/page.tsx
git commit -m "feat: professional inbox columns with toasts"
```

---

### Task 6: Party board

**Files:**
- Create: `src/components/party/party-board.tsx`
- Modify: `src/app/parties/[id]/page.tsx`

**Interfaces:**
- Consumes: `actionUpdateParty`, `actionAddLot`, `actionUnlinkSignal`, `actionCloseLot`, `actionEnqueueWatchlist` from `@/app/actions/party`. Gates computed on the server: `noBuy`, `upcoming`, `watchlistEligible` via `canAppearOnWatchlist` (same as today).
- Produces: `PartyBoard` props with serializable party:

```ts
export type PartyLot = {
  id: string;
  label: string;
  url: string | null;
  price: string;
  platform: string;
  openedAt: string;
  closedAt: string | null;
};

export type PartyTimelineItem = {
  id: string;
  sentAt: string;
  groupName: string;
  sender: string;
  text: string;
  isCandidateSource: boolean;
  signals: { id: string; kind: "procura" | "oferta" }[];
};

export function PartyBoard(props: {
  party: {
    id: string;
    name: string;
    eventAt: string;
    status: "upcoming" | "past" | "cancelled";
    aliases: string;
    nota: string;
    notes: string;
    watchlistPosition: number | null;
  };
  noBuy: boolean;
  upcoming: boolean;
  watchlistEligible: boolean;
  lots: PartyLot[];
  timeline: PartyTimelineItem[];
}): JSX.Element;
```

Status labels: `upcoming` → Futura, `past` → Passada, `cancelled` → Cancelada.

- [ ] **Step 1: Implement PartyBoard** (`"use client"`)

Header `Card`: `h1` name, Data `formatWhen(eventAt)`, Status label. If `noBuy`: `<Alert className="border-destructive text-destructive">sem compra</Alert>`. Do **not** render Entrar na fila or Abrir lote when `noBuy` / not `upcoming`. If `watchlistEligible` and `watchlistPosition == null`: button Entrar na fila → `actionEnqueueWatchlist` + `TOAST.enrolled`. If position set: `Na watchlist (posição {n})`.

Lots: `Table` `hidden md:table`; `md:hidden` cards. Fechar lote ghost → `TOAST.lotClosed`. Empty: `Nenhum lote`. If `upcoming`: add-lot form (`label`, `url`, `price`, `platform` select, same platform list as today) → `TOAST.lotOpened`.

Edit form: same fields/names as today (`partyId`, `name`, `eventAt`, `status`, `aliases`, `nota`, `notes`) → `TOAST.saved`.

Timeline: list; Desvincular `variant="destructive"` → `TOAST.unlinked`. Empty: `Nenhuma mensagem`.

- [ ] **Step 2: Thin party page**

Keep `findUnique` + `notFound` + `canAppearOnWatchlist`. Flatten messages/signals into `PartyTimelineItem[]` (same merge as today: messages first, then leftover signals). Pass ISO strings.

- [ ] **Step 3: `npx tsc --noEmit`** — PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/party/party-board.tsx src/app/parties/[id]/page.tsx
git commit -m "feat: professional party detail board"
```

---

### Task 7: Setup and Login

**Files:**
- Create: `src/components/setup/setup-board.tsx`
- Modify: `src/app/setup/page.tsx`, `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `actionSetGroupListen` (`id`, `listen` `"0"` if currently listening else `"1"`), `actionSetSenderRole` (`id`, `role`). `sessionBanner` + `readWaStatus` on the **page**.
- Produces:

```ts
export function SetupBoard(props: {
  connected: boolean;
  banner: { tone: "accent" | "danger"; text: string } | null;
  groups: { id: string; name: string; listen: boolean }[];
  senders: { id: string; name: string; role: "admin" | "pista" | "unknown" }[];
}): JSX.Element;
```

- [ ] **Step 1: SetupBoard**

`h1` Setup. If `connected`: `<Badge variant="outline">Conectado</Badge>`. Else show the same strip styling as SessionStrip (text from `banner`, not a link — shell already links).

Groups table desktop / cards mobile: name + muted Badge Ouvindo/Pausado + ghost button Pausar/Ouvir → `TOAST.paused` / `TOAST.listening`. Empty: `Nenhum grupo`.

Senders: Select role + ghost Salvar → `TOAST.saved`. Empty: `Nenhum remetente`.

- [ ] **Step 2: setup/page.tsx** maps `sessionBanner(status.state)` to `{ connected: banner === null, banner: banner && banner.tone !== "muted" ? banner : null }`. `sessionBanner` never returns muted today; if null, connected.

- [ ] **Step 3: Login**

Replace inline style. Use shadcn Card/Input/Button. Keep the **same** inline `login` server action in the file (do not extract unless needed). Center with `min-h-[80vh] grid place-items-center`. No nav (AppNav already hides `/login`).

```tsx
<main className="grid min-h-[80vh] place-items-center">
  <Card className="w-full max-w-sm p-6">
    <h1 className="mb-4 text-2xl font-semibold">Lumberjack</h1>
    <form action={login} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" />
      </div>
      <Button type="submit" className="w-full">Entrar</Button>
    </form>
  </Card>
</main>
```

- [ ] **Step 4: `npx tsc --noEmit`** — PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/setup-board.tsx src/app/setup/page.tsx src/app/login/page.tsx
git commit -m "feat: professional setup and login"
```

---

### Task 8: Remove v1 leftovers, README, full suite

**Files:**
- Delete if unused: `src/components/ui/banner.tsx`, `src/components/ui/data-table.tsx`, and any leftover v1 button/badge/card **only if** shadcn already replaced those paths (do not delete shadcn files).
- Modify: `README.md`

**Interfaces:**
- Consumes: all boards from Tasks 3–7
- Produces: clean `src/` with no v1 DataTable/Banner imports

- [ ] **Step 1: Grep and delete**

```bash
rg "from \"@/components/ui/(banner|data-table|shell|shell-nav|hide-on-login)\"" src
```

Expected: no matches. Then `git rm` leftover unused files.

- [ ] **Step 2: README**

Replace the UI paragraph with: professional dark board, Tailwind + shadcn, 768px breakpoint, toasts (Sonner), Node 24 (`nvm use`).

- [ ] **Step 3: Full suite**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
DATABASE_URL=postgresql://lumberjack:lumberjack@localhost:5432/lumberjack npm test
```

Expected: tsc + all Vitest files PASS (session-banner, toast-copy, nav, datetime, catalog, seed).

- [ ] **Step 4: Commit**

```bash
git add README.md src
git commit -m "chore: drop v1 UI kit and document shadcn board"
```

---

## Self-review

Spec coverage: tokens/stack → Task 1; shell/strip/nav → Task 2; Watchlist → 3; Calor → 4; Inbox → 5; Festa → 6; Setup+Login → 7; cleanup/README/full test → 8. In-place + toast → `runAction` Task 1, used 3–7. Gates/actions/sort untouched. `sessionBanner` kept.

No TBD. Types (`WatchlistItem`, `HeatRow`, `InboxCandidate`, `PartyBoard` props, `TOAST` keys) are named once and reused.

Celular toast `bottom-center` is optional polish in Task 1 Toaster (`position="bottom-right"` is the locked default; do not add a second Toaster).
