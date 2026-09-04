# Lumberjack — UI v1 (noite / lima)

Data: 2026-09-04  
Status: draft para revisão  
Produto: `2026-09-03-lumberjack-design.md` (regras não mudam)

## Problema

As cinco telas do v1 são HTML sem CSS. O operador precisa de um quadro que dê para usar de manhã no desktop e no celular, com cara de role — não de planilha e não de SaaS genérico.

## Jobs desta spec

- Vestir Watchlist, Calor, Inbox, Festa, Setup e Login.
- Desktop primeiro; abaixo de `720px`, usável (cards + nav embaixo).
- Um acento só: lima. Sem tela nova, sem regra nova.

## Fora

Gráfico de calor, tema claro, Tailwind, fonte web, toast, Storybook, Playwright, ilustração vazia, dark/light toggle, nova rota, mudança de ingest/catálogo/WhatsApp.

## Direção

Fundo `#0C0A0F`, superfície `#16131C`, texto off-white, linha `#2A2633`.  
Lima `#C8F542` só em: nav ativa, score de calor, badge de calor/“esquentou”, foco, botão primário.  
Perigo (vermelho-rosa `#F0718B`) só em rejeitar / desconectar / desvincular.  
Sem gradiente, sem neon em massa. Tipo: `ui-sans-serif` do sistema. Raio `10px`.

Tokens em `:root` (`src/app/globals.css`): `--bg`, `--surface`, `--line`, `--text`, `--muted`, `--accent`, `--danger`, `--radius`, `--pad`. Sem tema claro.

## Kit (`src/components/ui/`)

Apresentação só. Sem Prisma, sem actions.

| Bloco | Papel |
|---|---|
| `Shell` | Nav topo a partir de 720px; nav baixa abaixo disso. Logo textual “Lumberjack”. |
| `Card` | Watchlist, Inbox, detalhe, vazio |
| `DataTable` | Calor e Setup no desktop; no estreito, cada linha vira `Card` |
| `Badge` | edição anterior, Ouvindo/Pausado, QR/conectado/caiu |
| `Button` | `primary` lima, `ghost`, `danger` |
| `Banner` | sessão WhatsApp e “Atualizado em …” |

`layout.tsx` importa `globals.css` e envolve páginas autenticadas com `Shell` (login sem nav, como hoje).

## Telas

Rotas e home do dia **iguais** ao spec de produto.

- **Watchlist** — cards na ordem do operador: nome, data, lote+link, nota, calor discreto lima, badge edição anterior. Ações ghost na fileira. Vazio: uma frase + link Inbox/Calor.
- **Calor** — desktop tabela, score lima à esquerda; chips 1/3/7. Sem score: `—`, vai ao fundo. Celular: cards. Grupo: `<select>`.
- **Inbox** — desktop duas colunas (candidatos \| órfãos); celular uma coluna, candidatos primeiro. Confirmar no card (nome + `eventAt` obrigatórios). Órfão: texto + select + Vincular.
- **Festa** — cabeçalho nome/data/status. `past`/`cancelled`: banner “sem compra”, sem CTA de fila/lote. Lots, edição, timeline. Desvincular = `danger` pequeno.
- **Setup** — banner de sessão no topo (QR lima, conectado muted, caiu danger). Grupos e remetentes: tabela desktop, cards no estreito. Toggle Ouvindo/Pausado.
- **Login** — card central, Senha, botão lima. Sem nav.

`Banner` de sessão no `Shell` (todas as autenticadas) quando status ≠ `connected`. Quadros **não** bloqueiam.

## Estados

- Calor sem snapshot: `—` + “Atualizado em” só se `computedAt` existir.
- Action falhou: página recarrega, card permanece. Sem toast.
- Vazio: uma frase + um link. Sem arte.
- Foco visível lima; botões com texto, não só ícone.

Corte único: `720px`.

## Teste

- `tsc --noEmit` continua no `npm test`.
- Seed / home `/watchlist` / calor com score / past sem CTA de compra: testes de catálogo existentes. Sem suite visual.
- Verificação manual: desktop e ~375px nas cinco telas + login.

## Relação com o produto

Nada aqui altera classificação, ingest, watchlist order, fórmula de calor, trava de data ou Baileys.
