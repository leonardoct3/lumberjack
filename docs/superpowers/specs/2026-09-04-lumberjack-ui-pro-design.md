# Lumberjack — UI profissional (v2)

Data: 2026-09-04  
Status: aprovado em conversa; aguardando revisão do arquivo  
Produto: `2026-09-03-lumberjack-design.md` (regras não mudam)  
Substitui a camada visual de: `2026-09-04-lumberjack-ui-design.md` (kit CSS v1)

## Problema

A paleta noite/lima está certa. As seis telas ainda parecem HTML vestido: tipografia de sistema, forms empilhados, reload em cada ação. O operador precisa de um quadro que se sinta ferramenta (referência: Linear dark) no desktop e no celular, sem feature nova de produto.

## Jobs

- Vestir de novo Watchlist, Calor, Inbox, Festa, Setup e Login.
- Desktop denso **e** mobile de primeira classe (não “emergência”).
- Ação atualiza no lugar + toast curto.
- Código em primitivos reutilizáveis, páginas finas.

## Fora

Rota nova, regra de catálogo/ingest/calor/Baileys, command palette, tema claro, MUI, styled-components, Playwright, Storybook, ilustração vazia, gráfico de calor, dark/light toggle.

## Direção visual

Fundo `#0C0A0F`, superfície `#16131C`, linha `#2A2633`, texto `#F4F1EA`, muted `#9A93A5`, lima `#C8F542`, perigo `#F0718B`. Raio `10px`.

Lima só em: nav ativa, score de calor, badge de calor/“esquentou”, foco, botão primário.  
Perigo só em: rejeitar, desconectar, desvincular, Fechar lote **não** é perigo (continua ghost).

Sem gradiente, sem neon em massa. Fonte **Geist** (Next). Ícones **lucide**. Copy em português.

Corte único: `md` do Tailwind (**768px**). Acima: sidebar + tabelas. Abaixo: bottom nav + cards. Um valor só — sem `sm`/`lg` extras para layout.

## Stack

- Next.js 16 App Router, React 19, Node 24.
- Tailwind CSS v4.
- shadcn/ui estilo **New York**, dark only. Tokens do shadcn mapeiam a paleta acima (`--background`, `--primary` = lima, `--destructive` = `#F0718B`, `--sidebar` = fundo).
- Sonner para toast (posição bottom-right no desktop, bottom-center acima da nav no celular).
- `next/font` Geist. Sem outra webfont.
- Mutações: server actions **existentes**. Client chama com `useTransition`; sucesso → `toast` + `router.refresh()`; falha → toast destructive, item permanece.

## Arquitetura

Páginas (`src/app/**/page.tsx`) são server: Prisma, gates, formatadores de data. Passam props serializáveis (ISO strings, números, ids). Sem Prisma nos client components.

```
src/components/ui/          # primitivos shadcn (button, badge, card, table, input, select, tabs, sonner)
src/components/shell/       # AppShell, AppNav, SessionStrip
src/components/watchlist/   # WatchlistBoard
src/components/heat/        # HeatBoard
src/components/inbox/       # InboxBoard
src/components/party/       # PartyBoard
src/components/setup/       # SetupBoard
```

O kit CSS v1 (`src/components/ui/{button,badge,card,banner,data-table,shell,shell-nav,hide-on-login}.tsx` e as regras manuais de `globals.css`) **sai**. `sessionBanner()` em `session-banner.ts` **fica** (já testado): o `SessionStrip` só consome o retorno.

`layout.tsx` envolve o app com `AppShell` + `<Toaster />`. Login esconde nav (path `/login`), não o Toaster.

### Contrato dos boards

Cada `*Board` é client, recebe dados já prontos, não busca. Actions injetadas por props (as funções de `src/app/actions/*`) para o board não importar o servidor direto se isso quebrar o boundary — ou importar as actions (Next permite) e a página só passar dados. **Escolha travada:** boards importam as server actions existentes; a página só passa dados.

Props mínimas (nomes fixos):

| Board | Props |
|---|---|
| `WatchlistBoard` | `items: WatchlistItem[]` — id, name, eventAt ISO, lotLabels, lotUrl?, heat: number \| null, previousEdition, canMoveUp, canMoveDown, openLotIds |
| `HeatBoard` | `janela`, `grupo`, `groups[]`, `rows[]` (id, name, procura1/3/7, oferta1/3, autores7d, days, score \| null, computedAt ISO \| null), `updatedAt ISO \| null` |
| `InboxBoard` | `candidates[]`, `orphans[]`, `upcoming[]` (id, name) |
| `PartyBoard` | party + lots + timeline + flags `noBuy`, `watchlistEligible`, `upcoming` (mesmos gates de hoje) |
| `SetupBoard` | `status`, `groups[]`, `senders[]` |

Datas nas props: ISO UTC. Formatação `pt-BR` / `America/Sao_Paulo` no client com o mesmo `TZ` do domínio.

## Shell

Desktop (`≥768px`): sidebar ~220px, logo “Lumberjack”, quatro links (Watchlist, Calor, Inbox, Setup), `startsWith` para ativo. `/parties/[id]` não acende nenhum.  
Celular: bottom nav com os quatro links; logo some.

`SessionStrip`: se `sessionBanner(state)` não é `null`, faixa no topo (QR = accent, disconnected = danger). Clique vai para `/setup`. Quadros clicáveis. Não renderiza em `/login`.

## Telas

### Watchlist

Lista na ordem do operador (já vem de `listWatchlist`). Rank `#` visível. Desktop: linhas densas (número, nome, data, lote, calor lima, badge “edição anterior”, ações). Celular: um card por festa, mesmas ações em fileira.

Ações (ghost, ícone + texto): Subir, Descer, Sair da fila, Fechar lote, Detalhe (`Link` para `/parties/[id]`). Subir some no primeiro; Descer some no último. Fechar lote só se houver lote aberto.

Sucesso: item reordena / some; toast “Subiu”, “Desceu”, “Saiu da fila”, “Lote fechado”.  
Vazio: “Nenhuma festa na fila” + links Inbox e Calor.

### Calor

Query `janela` (`1` \| `3` \| `7`) e `grupo` iguais às de hoje. Sort: score desc, `null` por último — **não reimplementar**, a página server já entrega `rows` ordenadas.

Desktop: `Table` sticky header. Colunas nesta ordem: Nome, Score, Procura 1, 3, 7, Oferta 1, 3, Autores 7d, Dias. Score usa lima + tabular-nums; sem score: `—`. Sem coluna “Atualizado em”. Chips 1d/3d/7d: ativo = `Badge` accent. Grupo: `Select` + botão ghost Filtrar (GET, mesmo `?janela=&grupo=`).  
Celular: cada row vira card com os mesmos campos, Score no topo do card.

`updatedAt`: o maior `computedAt` das rows. Mostrar **uma** vez no header (“Atualizado em …”). Sem coluna “Atualizado em” e sem banner extra — o header cobre os dois.

Sem score: `—`. Vazio: “Nenhuma festa no calor” + link Inbox.

### Inbox

Desktop: duas colunas (Candidatos \| Órfãos). Celular: uma coluna, candidatos primeiro.

Candidato: texto-fonte muted; form compacto; `required` em nome e `eventAt`; Confirmar primary; Rejeitar destructive.  
Órfão: texto + `Select` de festas `upcoming` + Vincular; `required` no select. `matchParty` continua na página server (defaultValue do select).

Sucesso: card some; toast “Festa confirmada”, “Candidato rejeitado”, “Mensagem vinculada”.  
Vazio: “Nenhum candidato” / “Nenhum órfão” — frase só, sem link (ingest que cria esses itens).

### Festa

Header: nome, data formatada, status (Futura / Passada / Cancelada).  
`status` `past` ou `cancelled`: `Alert` destructive “sem compra”. Não renderizar “Entrar na fila” nem “Abrir lote”. Gates `canAppearOnWatchlist` / `upcoming` iguais aos de hoje.

Lotes: tabela desktop / cards no estreito. Fechar lote = ghost.  
Editar: form em `Card`, Salvar primary.  
Timeline: cada mensagem; Desvincular = destructive; some a linha + toast “Desvinculado”.

### Setup

`sessionBanner` de novo no page (além do strip do shell): connected → `Badge` “Conectado”; senão o mesmo strip.  
Grupos: nome + `Badge` muted “Ouvindo”/“Pausado” + ghost “Pausar”/“Ouvir”. Hidden `listen` igual ao de hoje (`"0"` se ouvindo, `"1"` se pausado).  
Remetentes: `Select` admin/pista/unknown + ghost Salvar.  
Vazio: “Nenhum grupo” / “Nenhum remetente”.

### Login

Card centrado, título Lumberjack, Senha, Entrar primary. Sem nav, sem session strip. Action `login` inalterada.

## Erros e estados

- Action lança ou devolve falha: toast destructive com a mensagem se houver, senão “Não deu. Tenta de novo.” Item permanece.
- Pending `useTransition`: botão `disabled` + `aria-busy`, sem spinner de página.
- WhatsApp ≠ connected: strip visível; boards usáveis.
- Sem ilustração. Sem toast de “página carregou”.

## Teste

`npm test` continua `tsc --noEmit && vitest run --fileParallelism false`.

Mantém `tests/ui/session-banner.test.ts`. Sem teste de componente React (RTL não entra). Sem Playwright.

Catálogo / seed / gates existentes não podem quebrar: boards não mudam queries nem actions.

## Relação com o produto

Nada aqui altera classificação, ingest, ordem da watchlist, fórmula de calor, trava de data ou Baileys. Home do dia e rotas iguais ao spec de produto.
