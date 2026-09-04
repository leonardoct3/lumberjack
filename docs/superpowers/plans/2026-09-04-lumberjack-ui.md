# Lumberjack UI v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing six routes (Watchlist, Calor, Inbox, Festa, Setup, Login) with a dark nightlife look, lime accent, and a six-block presentational kit — no product-rule changes.

**Architecture:** CSS variables in `globals.css`. Presentational components in `src/components/ui/` (no Prisma, no actions). `Shell` replaces `Nav` and optionally shows a session `Banner`. Pages keep the same server actions and queries; they only change markup/classes.

**Tech Stack:** Next.js 15 App Router, React 19, existing CSS (no Tailwind, no new fonts, no Playwright).

## Global Constraints

- Background `#0C0A0F`, surface `#16131C`, line `#2A2633`, text off-white, muted secondary, accent lime `#C8F542`, danger `#F0718B`, radius `10px`.
- Lime only on: active nav, heat score, heat/“esquentou” badge, focus, primary button.
- Danger only on reject / disconnect / unlink.
- No gradient, no light theme, no web font, no Tailwind, no toast, no new routes.
- Single breakpoint `720px`: tables + top nav above; cards + bottom nav below.
- Session banner on authenticated shells when WhatsApp status ≠ `connected`; boards stay clickable.
- Empty states: one sentence + one link. No illustration.
- Do not change classify, ingest, watchlist order, heat formula, date gates, or Baileys.
- UI copy in Portuguese.
- `npm test` stays `tsc --noEmit && vitest run --fileParallelism false`.

## File map

```
src/app/globals.css
src/app/layout.tsx
src/app/login/page.tsx
src/app/watchlist/page.tsx
src/app/heat/page.tsx
src/app/inbox/page.tsx
src/app/parties/[id]/page.tsx
src/app/setup/page.tsx
src/components/nav.tsx          (delete after Shell lands)
src/components/ui/session-banner.ts
src/components/ui/button.tsx
src/components/ui/badge.tsx
src/components/ui/card.tsx
src/components/ui/banner.tsx
src/components/ui/data-table.tsx
src/components/ui/shell.tsx
tests/ui/session-banner.test.ts
```

---

### Task 1: Tokens and session banner helper

**Files:**
- Create: `src/app/globals.css`, `src/components/ui/session-banner.ts`, `tests/ui/session-banner.test.ts`
- Modify: `src/app/layout.tsx` (import CSS only in this task)

**Interfaces:**
- Consumes: `WaStatus["state"]` union `"connected" | "qr" | "disconnected"`
- Produces:
  - `export type BannerTone = "accent" | "muted" | "danger"`
  - `export function sessionBanner(state: "connected" | "qr" | "disconnected"): { tone: BannerTone; text: string } | null`
  - CSS variables `--bg --surface --line --text --muted --accent --danger --radius --pad`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { sessionBanner } from "@/components/ui/session-banner";

describe("sessionBanner", () => {
  it("hides the bar when connected", () => {
    expect(sessionBanner("connected")).toBeNull();
  });

  it("uses lime copy for QR", () => {
    expect(sessionBanner("qr")).toEqual({ tone: "accent", text: "QR pendente" });
  });

  it("uses danger copy when disconnected", () => {
    expect(sessionBanner("disconnected")).toEqual({
      tone: "danger",
      text: "WhatsApp desconectado",
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/ui/session-banner.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement helper + CSS + import**

`src/components/ui/session-banner.ts`:

```ts
export type BannerTone = "accent" | "muted" | "danger";

export function sessionBanner(
  state: "connected" | "qr" | "disconnected",
): { tone: BannerTone; text: string } | null {
  if (state === "connected") return null;
  if (state === "qr") return { tone: "accent", text: "QR pendente" };
  return { tone: "danger", text: "WhatsApp desconectado" };
}
```

`src/app/globals.css` — exactly these tokens and base rules:

```css
:root {
  --bg: #0c0a0f;
  --surface: #16131c;
  --line: #2a2633;
  --text: #f4f1ea;
  --muted: #9a93a5;
  --accent: #c8f542;
  --danger: #f0718b;
  --radius: 10px;
  --pad: 1rem;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, sans-serif;
}

a { color: var(--accent); }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.btn {
  border-radius: var(--radius);
  border: 1px solid var(--line);
  padding: 0.4rem 0.75rem;
  font: inherit;
  cursor: pointer;
  background: transparent;
  color: var(--text);
}
.btn--primary { background: var(--accent); color: #0c0a0f; border-color: var(--accent); }
.btn--ghost { background: transparent; color: var(--text); }
.btn--danger { background: transparent; color: var(--danger); border-color: var(--danger); }

.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.75rem;
  border: 1px solid var(--line);
  color: var(--muted);
}
.badge--accent { color: #0c0a0f; background: var(--accent); border-color: var(--accent); }
.badge--danger { color: var(--danger); border-color: var(--danger); }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: var(--pad);
}

.banner {
  border-radius: var(--radius);
  padding: 0.6rem var(--pad);
  border: 1px solid var(--line);
  color: var(--muted);
}
.banner--accent { border-color: var(--accent); color: var(--accent); }
.banner--danger { border-color: var(--danger); color: var(--danger); }

.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td {
  text-align: left;
  padding: 0.5rem;
  border-bottom: 1px solid var(--line);
}
.data-table .score { color: var(--accent); font-variant-numeric: tabular-nums; }

.shell-nav {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: var(--pad);
  border-bottom: 1px solid var(--line);
}
.shell-nav a { color: var(--muted); text-decoration: none; }
.shell-nav a.is-active { color: var(--accent); }

.page { padding: var(--pad); padding-bottom: 5rem; max-width: 1100px; margin: 0 auto; }
.stack { display: flex; flex-direction: column; gap: var(--pad); }
.row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.two-col { display: grid; gap: var(--pad); }
.heat-score { color: var(--accent); font-variant-numeric: tabular-nums; font-weight: 700; }

@media (min-width: 720px) {
  .page { padding-bottom: var(--pad); }
  .two-col { grid-template-columns: 1fr 1fr; }
  .data-table--cards .data-table__card-label { display: none; }
}

@media (max-width: 719px) {
  .shell-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    border-bottom: none;
    border-top: 1px solid var(--line);
    background: var(--bg);
    justify-content: space-around;
    z-index: 10;
  }
  .data-table thead { display: none; }
  .data-table, .data-table tbody, .data-table tr, .data-table td {
    display: block;
    width: 100%;
    border: 0;
  }
  .data-table tr {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--pad);
    margin-bottom: var(--pad);
  }
  .data-table td { display: flex; justify-content: space-between; gap: 1rem; }
  .data-table__card-label { color: var(--muted); }
}
```

`layout.tsx`: add `import "./globals.css";` at the top. Keep `<Nav />` for now.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/ui/session-banner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/components/ui/session-banner.ts tests/ui/session-banner.test.ts
git commit -m "feat: add nightlife tokens and session banner copy"
```

---

### Task 2: Presentational kit

**Files:**
- Create: `src/components/ui/button.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/card.tsx`, `src/components/ui/banner.tsx`, `src/components/ui/data-table.tsx`, `src/components/ui/shell.tsx`
- Delete: `src/components/nav.tsx` after layout uses Shell
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `sessionBanner`, `readWaStatus`, CSS classes from Task 1
- Produces:
  - `Button({ variant?: "primary" | "ghost" | "danger" } & ButtonHTMLAttributes<HTMLButtonElement>)`
  - `Badge({ tone?: "muted" | "accent" | "danger"; children })`
  - `Card({ children, className?: string })`
  - `Banner({ tone?: "muted" | "accent" | "danger"; children })`
  - `DataTable({ columns: { key: string; header: React.ReactNode }[]; rows: { id: string; cells: Record<string, React.ReactNode> }[]; empty?: React.ReactNode })`
  - `Shell({ children }: { children: React.ReactNode })` — client nav + server-read status banner. Implement as a server component that reads `WA_STATUS_PATH` (default `./data/wa-status.json`) via `readWaStatus`, renders `sessionBanner` result, and a client `ShellNav` with links Watchlist, Calor, Inbox, Setup. Hide nav when pathname is `/login`.

- [ ] **Step 1: Write a failing test for DataTable empty render** — skip DOM RTL (not installed). Instead add `tests/ui/session-banner.test.ts` is enough. For this task, add no new test file; run existing `session-banner` + `tsc --noEmit` after wiring layout.

If you need a compile gate: create the components below, switch layout to Shell, delete Nav, run `npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 2: Implement the six files**

`button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`btn btn--${variant} ${className ?? ""}`.trim()} {...props} />;
}
```

`badge.tsx`:

```tsx
export function Badge({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "accent" | "danger";
  children: React.ReactNode;
}) {
  const extra = tone === "muted" ? "" : ` badge--${tone}`;
  return <span className={`badge${extra}`}>{children}</span>;
}
```

`card.tsx`:

```tsx
export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`card ${className ?? ""}`.trim()}>{children}</section>;
}
```

`banner.tsx`:

```tsx
export function Banner({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "accent" | "danger";
  children: React.ReactNode;
}) {
  const extra = tone === "muted" ? "" : ` banner--${tone}`;
  return <p className={`banner${extra}`}>{children}</p>;
}
```

`data-table.tsx`:

```tsx
export function DataTable({
  columns,
  rows,
  empty,
}: {
  columns: { key: string; header: React.ReactNode }[];
  rows: { id: string; cells: Record<string, React.ReactNode> }[];
  empty?: React.ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <table className="data-table data-table--cards">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            {columns.map((c) => (
              <td key={c.key}>
                <span className="data-table__card-label">{c.header}</span>
                {row.cells[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`shell.tsx` — split:

`src/components/ui/shell-nav.tsx` (client):

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/watchlist", label: "Watchlist" },
  { href: "/heat", label: "Calor" },
  { href: "/inbox", label: "Inbox" },
  { href: "/setup", label: "Setup" },
] as const;

export function ShellNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <nav className="shell-nav">
      <span>Lumberjack</span>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={pathname.startsWith(l.href) ? "is-active" : undefined}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
```

`src/components/ui/shell.tsx` (server):

```tsx
import { Banner } from "./banner";
import { ShellNav } from "./shell-nav";
import { sessionBanner } from "./session-banner";
import { readWaStatus } from "@/connector/status";

export function Shell({ children }: { children: React.ReactNode }) {
  const status = readWaStatus(process.env.WA_STATUS_PATH ?? "./data/wa-status.json");
  const banner = sessionBanner(status.state);
  return (
    <>
      <ShellNav />
      {banner ? <Banner tone={banner.tone}>{banner.text}</Banner> : null}
      {children}
    </>
  );
}
```

`layout.tsx`:

```tsx
import { Shell } from "@/components/ui/shell";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
```

Delete `src/components/nav.tsx`. Banner on login: `ShellNav` already hides; session banner would still show on `/login` if disconnected. **Do not render the session Banner when pathname is login.** Because `Shell` is a server component, pass nothing extra — instead skip the banner inside `Shell` by not showing it if we cannot know the path… Next.js `headers()` / we can make `Shell` accept hiding via splitting: only wrap authenticated layouts.

Cleaner lock: create `src/app/(app)/layout.tsx` is a new route group and would move all pages — **out of scope (no new mental routes)**. Instead: `Shell` renders banner only when `ShellNav` would show. Make a tiny client `SessionBannerGate` that hides banner on `/login`, wrapping the server-computed banner children.

```tsx
"use client";
export function HideOnLogin({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return children;
}
```

Use that around both nav (already handled) and banner.

- [ ] **Step 3: Run `npx tsc --noEmit`**

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/ui src/app/layout.tsx
git rm src/components/nav.tsx
git commit -m "feat: add UI kit and shell with session banner"
```

---

### Task 3: Login and Watchlist

**Files:**
- Modify: `src/app/login/page.tsx`, `src/app/watchlist/page.tsx`

**Interfaces:**
- Consumes: `Card`, `Button`, `Badge`
- Produces: styled pages; same actions and queries as today

- [ ] **Step 1: Restyle login**

```tsx
// keep login() action unchanged
export default function LoginPage() {
  return (
    <main className="page" style={{ minHeight: "80vh", display: "grid", placeItems: "center" }}>
      <Card>
        <h1>Lumberjack</h1>
        <form action={login} className="stack">
          <label htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" autoComplete="current-password" />
          <Button type="submit">Entrar</Button>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Restyle watchlist**

Wrap the page in `<main className="page stack">`. Title `h1` Watchlist. Empty: `<Card><p>Nenhuma festa na fila</p><p><a href="/inbox">Inbox</a> · <a href="/heat">Calor</a></p></Card>`. Each party is a `Card` with name + optional `<Badge>edição anterior</Badge>`, date, lote, link, nota, `<span className="heat-score">` for calor. Actions in `<div className="row">` using `Button variant="ghost"` (Subir, Descer, Sair da fila, Fechar lote) and `Link` Detalhe. Do not change `listWatchlist`, move/remove/close actions, or sort.

- [ ] **Step 3: `npx tsc --noEmit`** — PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx src/app/watchlist/page.tsx
git commit -m "feat: style login and watchlist cards"
```

---

### Task 4: Heat and Inbox

**Files:**
- Modify: `src/app/heat/page.tsx`, `src/app/inbox/page.tsx`

**Interfaces:**
- Consumes: `DataTable`, `Card`, `Button`, `Badge`
- Produces: same filters (`janela`, `grupo`) and same confirm/reject/link actions

- [ ] **Step 1: Heat**

Keep query/sort logic. Header: `h1` Calor + if any row has `computedAt`, `<Banner tone="muted">Atualizado em {format that latest}</Banner>`. Chips: links 1d/3d/7d; active chip gets class that uses accent (wrap active in `<Badge tone="accent">`). Grupo stays a GET `<form>` with `<select>` + `<Button variant="ghost">Filtrar</Button>`.

`DataTable` columns: Nome (link), Procura 1/3/7, Oferta 1/3, Autores 7d, Dias, Score (`<span className="score">` or `—`), Atualizado em. Empty: `<Card><p>Nenhuma festa no calor</p><a href="/inbox">Inbox</a></Card>`. Do not change sort (null score last).

- [ ] **Step 2: Inbox**

`<main className="page stack">`, `h1` Inbox, `<div className="two-col">`. Left: Candidatos. Empty `Nenhum candidato`. Each candidate `Card` with source text + existing confirm fields + `<Button>Confirmar</Button>` and `<Button variant="danger">Rejeitar</Button>`. Right: Órfãos. Empty `Nenhum órfão`. Each orphan `Card` + select + `<Button>Vincular</Button>`. Do not change `required` on name/`eventAt` or `linkOrphan` gates.

- [ ] **Step 3: `npx tsc --noEmit`** — PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/heat/page.tsx src/app/inbox/page.tsx
git commit -m "feat: style heat table and inbox columns"
```

---

### Task 5: Party detail and Setup

**Files:**
- Modify: `src/app/parties/[id]/page.tsx`, `src/app/setup/page.tsx`

**Interfaces:**
- Consumes: `Card`, `Button`, `Badge`, `Banner`, `DataTable`
- Produces: same update/addLot/enqueue/unlink/close and setup listen/role actions

- [ ] **Step 1: Party**

`<main className="page stack">`. Header card: name, formatted date, status. If `status` is `past` or `cancelled`, `<Banner tone="danger">sem compra</Banner>` and do **not** render “Entrar na fila” / “Abrir lote” (keep existing `canAppearOnWatchlist` / upcoming gates). Lots in a card/table. Edit form in a card with `<Button>Salvar</Button>`. Timeline in a card; desvincular = `<Button variant="danger">Desvincular</Button>`.

- [ ] **Step 2: Setup**

`<main className="page stack">`, `h1` Setup. Map `readWaStatus` through `sessionBanner` for the page banner as well (QR accent, disconnected danger; connected: `<Badge>Conectado</Badge>` only, no blocking). Groups `DataTable` (Nome, Ouvir toggle via existing form + `Button`). Senders `DataTable` (Nome, papel select + `Button variant="ghost">Salvar</Button>`). Empty tables: one sentence.

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: `tsc` + all existing tests PASS (including seed / catalog). No product test should break.

- [ ] **Step 4: README** — one short “UI” note: dark theme, 720px breakpoint, no Tailwind.

- [ ] **Step 5: Commit**

```bash
git add src/app/parties src/app/setup/page.tsx README.md
git commit -m "feat: style party detail and setup"
```

---

## Self-review

Spec coverage: tokens/kit → Tasks 1–2; five screens + login → Tasks 3–5; session banner → Tasks 1–2 and Setup; empty/failure → page tasks; tests → Task 1 unit + Task 5 `npm test`; no product rule changes.

No Playwright/Tailwind/toast. Types locked: `sessionBanner`, `Button` variants, `DataTable` columns/rows, `Shell`.
