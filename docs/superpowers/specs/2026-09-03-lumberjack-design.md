# Lumberjack — suporte a decisão de ingressos

Data: 2026-09-03  
Status: draft para revisão

## Problema

Comprar ingresso de festa no primeiro lote costuma ser o trade com melhor margem, mas o capital fica parado até perto do evento. O mercado informal (grupos de WhatsApp) mostra oferta, procura e abertura de lote; o preço fechado mora no privado e não é observável. Propaganda de admin não é aquecimento — admins promovem quase todas as festas, muitas vezes com link de afiliado.

## Jobs do v1

- **A — Lote 1:** descobrir que o lote existe e manter uma watchlist. Quem ordena a fila é o operador. O sistema não recomenda “compre N ingressos” e não ranqueia lote 1 automaticamente.
- **D — Calor:** um quadro, atualizado em lote (não em tempo real), com festas *upcoming* ordenadas por movimento da pista (oferta/procura nos grupos).

Feeling e ciclo de amigos continuam humanos. Score qualitativo (nota 1–5) e badge de edição passada são opcionais na carta da festa; não ordenam a watchlist.

## Fora do v1

- Alocação de capital / “quanto comprar” (expansão se o quadro de calor começar a acertar).
- Ledger de compras, posição e P&L.
- Preço informal negociado no privado.
- Scrape ou API de Sympla, Gandaya, Blacktag, Ingresse (enriquecimento futuro de preço oficial e estoque).
- Digest em Telegram/WhatsApp.
- Ranking automático de lote 1, LLM em massa, embeddings.
- Multi-usuário / produto para terceiros.

## Usuário e operação

Um operador. Relógio `America/Sao_Paulo`.  
Listener de grupos: terça a sábado. Resumo/calor: um job em lote após o sync (ou de manhã), não push em tempo real.

WhatsApp: Baileys (cliente não-oficial, viola ToS, risco de ban). Semana 1 no número pessoal para provar o tubo; se aguentar, a mesma sessão migra para um chip. O sistema guarda mensagens e festas, não o número. Conta pessoal usada em 2FA de banco/e-mail é risco real mesmo em 7 dias.

## Arquitetura

Monólito modular em TypeScript. Três processos, um Postgres.

| Processo | Papel |
|---|---|
| **Connector** | Processo longo (Baileys). Sync terça–sábado nos grupos com `listen`. Persiste mensagem crua. Não classifica. Auth em arquivo, trocável de número. |
| **Worker** | Job em lote: classifica, extrai candidatos, agrega calor, marca festas `past`. Roda mesmo se o WhatsApp estiver caído, sobre o que já está no banco. |
| **Web** | Next.js, um usuário. Senha única via env + cookie de sessão. Sem auth se `AUTH_DISABLED=1` (só localhost). Watchlist, calor, detalhe da festa, inbox, setup. Fonte da verdade. |

Rodam numa máquina só (WSL ou VPS pequeno). O connector precisa de processo vivo o suficiente para o sync; não é um request HTTP.

WhatsApp e, no futuro, plataformas oficiais são **conectores**. O produto é o modelo no Postgres.

## Pipeline

1. **Mensagem crua** — grupo, autor, hora, texto, `waMessageId`. Idempotente.
2. **Papel do remetente** — admin do grupo (metadado WhatsApp) + override manual. Sem papel, promo vira calor falso.
3. **Classificação por regras** (sem LLM no v1), um rótulo por mensagem:
   - `admin_promo` — festa nova, lote aberto, link de plataforma ou encurtador.
   - `pista_oferta` — venda informal (“vendo”, “tenho”, “saída”).
   - `pista_procura` — demanda (“procuro”, “preciso”, “quero comprar”).
   - `ruido` — gravado, fora do agregado.
4. **Extração → `PartyCandidate`** — nome, URL, lote/preço/data se o texto tiver. Não entra em watchlist nem calor ranqueado. Sem data extraída, o candidato espera confirmação humana; não vira “compre”.
5. **Confirmação** — nome + `event_at` obrigatórios. Lote, link, preço oficial, nota 1–5 opcionais. Gera `Party` + `Lot` e fecha o candidato.
6. **Pista → `Signal`** — oferta/procura tenta match por nome ou apelido em festas confirmadas. Sem match: fila de órfãos. **Pista nunca cria festa.**
7. **Calor** — só `event_at > agora`. Snapshot no job; a web lê o último snapshot.
8. **Histórico** — outra `Party` com o mesmo nome/apelido e `event_at` antigo. Badge na carta; não reordena watchlist.

Match fuzzy (v1): nome/apelido normalizado (minúsculo, sem acento). Casa se o nome da festa aparece na mensagem ou um apelido aparece. Sinal de compra/calor não gruda em festa `past`.

## Score de calor

`days_to_event` é coluna de exibição, **não entra no score**. O score mede só movimento da pista.

```
score = 4 * procura_1d
      + 2 * procura_3d
      + 1 * procura_7d
      + 2 * autores_unicos_procura_7d
      + 1 * oferta_1d
      + 1 * oferta_3d
```

Contagens vêm de `Signal` no intervalo, por festa. Fórmula fechada; se ficar esquisita, desliga-se grupo ou desvincula-se sinal — não há retreino.

## Modelo de dados

- **Group** — id WhatsApp, nome, `listen`.
- **Sender** — número, nome, papel `admin | pista | unknown`.
- **Message** — texto, hora, grupo, autor, classificação, `party_id` e/ou `candidate_id` opcionais. Crua nunca some.
- **PartyCandidate** — campos extraídos, mensagem-fonte, `pending | confirmed | rejected`.
- **Party** — nome, apelidos, `event_at` (obrigatório), `upcoming | past | cancelled` (cancelar = editar status no detalhe; sem fluxo extra), nota 1–5 opcional, `watchlist_position` (null = fora da fila), notas.
- **Lot** — rótulo, `opened_at`, `closed_at` opcional, preço oficial, URL, plataforma `sympla | gandaya | blacktag | ingresse | other | unknown`. Lote aberto = `opened_at` preenchido e `closed_at` vazio.
- **Signal** — oferta ou procura ligada a uma festa via mensagem.
- **HeatSnapshot** — contagens 1/3/7d, autores únicos, `days_to_event`, score, `computed_at`.

Job noturno: `event_at < agora` (fuso SP) ⇒ `past`. Sem `event_at` confirmado, a festa não existe no quadro.

Sessão WhatsApp é arquivo de auth, não tabela.

## Telas

1. **Watchlist** — festas `upcoming` com lote aberto, ordem do operador. Linha: nome, data, lote, link, nota, badge de edição passada, calor discreto. Ações: detalhe, sair da fila, fechar lote.
2. **Calor** — `upcoming` ordenadas pelo último snapshot. Colunas de procura/oferta/autores/dias/score. Filtro por grupo e janela 1/3/7d. Sem sinal: vai para o fundo, não some do catálogo.
3. **Festa** — data, status, nota, apelidos, lots, timeline (admin + pista). Único lugar de edição pesada. Se `past`, sem CTA de compra. Ação: desvincular sinal (volta a órfão).
4. **Inbox** — candidatos `pending` e sinais órfãos. Confirmar / rejeitar / criar vínculo.
5. **Setup** — grupos `listen`, papel de remetentes, status da sessão (conectada / QR / caiu).

Navegação: Watchlist | Calor | Inbox + detalhe. Home do dia: Inbox se houver pendente; senão Watchlist se houver lote aberto; senão Calor.

## Falhas

- WhatsApp caiu/ban/QR: connector `disconnected`, para de puxar, **não apaga**. Banner no Setup. Worker e quadros seguem com o banco. Reconectar = novo QR. Trocar número = trocar pasta de auth.
- Sync parcial: um grupo falho não bloqueia os outros.
- `waMessageId` duplicada: insert ignorado.
- Parse ruim: Inbox, não quadro. Correção é confirmar/rejeitar/desvincular.
- Calor falhou: snapshot anterior + “atualizado em”. Nunca zera por erro.
- Postgres fora: app fora. Sem cache mentiroso.
- Link oficial quebrado: problema deles; guardamos a URL.

## Teste

Unitário, sem WhatsApp:

- Classificador com exemplos (podem ser sintéticos no primeiro PR; dump real anonimizado entra quando existir).
- Extração de nome/URL/lote/data.
- Fuzzy não casa sinal de compra em festa `past`.
- Trava de data: `past` fora de Watchlist e de ranking de calor.
- Score de calor determinístico para um set de sinais.
- Idempotência de `waMessageId`.

Integração (Postgres de teste): confirmar candidato cria Party+Lot; rejeitar não cria; desvincular volta órfão; job noturno marca `past` em SP.

Connector: no CI, só “sessão ausente ⇒ disconnected e worker ainda roda”. O teste de 7 dias no número pessoal é o teste do tubo.

Web: smoke das quatro rotas com banco vazio e com fixture (1 grupo, 1 admin, 1 festa futura, 1 passada, ~20 textos).

## Expansões (não implementar agora)

- Chip dedicado depois da semana de prova.
- Notifier (Telegram/e-mail) em cima do mesmo banco.
- Enriquecimento Sympla / Gandaya / Blacktag / Ingresse.
- Posição, preço pago, alocação.
- Ranking de lote 1 se nota + histórico se mostrarem sinal.
