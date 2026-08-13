# Prospecção — Documentação de Estado (SESSIONS)

> Mantenha este arquivo atualizado. Ele é o ponto de retomada caso a sessão estoure o limite.
> Última atualização: 2026-08-13

## O que o projeto faz

Gera, a partir de CSVs de leads do Google Maps (exportados por crawler), uma planilha final
com **mensagens de prospecção prontas para WhatsApp** (`wa.me`), cada uma classificada por
"ângulo de abordagem" e composta por abertura + corpo + fechamento montados de blocos de
texto, de modo que **nunca haja duas mensagens com a mesma estrutura** (antispam/variação).

## Estrutura

```
abrir-conversas-simples/
└── prospeccao-pipeline/
    ├── processar.js      # pipeline: CSV bruto -> CSV de prospecção
    ├── validar.js        # checagem de invariantes da saída (exit 1 se falhar)
    ├── output/           # CSVs gerados:
    │   ├── petshop_leads_prospeccao.csv          (99 leads)
    │   ├── loja_de_roupas_prospeccao.csv         (92 leads)
    │   ├── barbearia_leads_prospeccao.csv        (505 leads)
    │   ├── clinica_estetica_prospeccao.csv       (50 leads)
    │   └── santa_catarina_prospeccao.csv         (737 leads)
    ├── SESSIONS.md       # este arquivo
    └── (prospeccao_prototipo.csv / prospeccao_revisado.csv — protótipos antigos, podem ir pro lixo)
```

Leads brutos ficam em `/home/lucas/Documentos/leads/` (fora do repo):
- `petshop-leads.csv`, `loja-de-roupas-leads.csv`, `leads-barbearia.csv` — formato crawler padrão
- `clinica-estetica-sp.csv` — formato crawler padrão
- `santa-catarina_leads_limpos.csv` — formato limpo: `nome,telefone_formatado,telefone,categoria,bairro,cidade,nota,avaliacoes,link_maps`
- `arquivo/` — lixo movido (backups .json antigos, dataset_crawler, loja-insta, leads_limpos)

## Comandos

```bash
cd prospeccao-pipeline

# Processar um segmento
node processar.js /home/lucas/Documentos/leads/<leads>.csv output/<segmento>_leads_prospeccao.csv

# Validar a saída
node validar.js output/<segmento>_leads_prospeccao.csv
```

Validator deve imprimir "Tudo OK." e exit 0.

## Como o processar.js funciona (fluxo)

1. **Parse CSV** — detecta `,`/`;`, respeita aspas e BOM.
2. **Colunas esperadas** (mínimas): `title|name` (nome), `phone|phoneUnformatted` (telefone),
   `neighborhood|address|street` (bairro/região). Avisa se faltar.
3. **Limpeza de nome** (`nomeCurto`): remove endereço, sufixos de categoria, parênteses,
   e textos após `- Loja/Moda/...` — usado no nome e na deduplicação.
4. **Derivações**: bairro, telefone (prefere `phoneUnformatted`; descarta se < 10 dígitos),
   nota/avaliações (só dígitos), referência (shopping/edifício/wall street no endereço),
   flags: `shopping`, `empresarial`, `vinteQuatroHoras` (via colunas `openingHours/...`).
5. **Ângulo** (`definirAngulo`):
   - sem link/telefone → `sem-telefone`
   - nota ≥ 4.5 e avaliações < 20 → `credibilidade`
   - shopping → `shopping-muitas` (≥50 aval) ou `shopping`
   - empresarial → `empresarial-muitas` (≥50 aval) ou `empresarial`
   - avaliações ≥ 50 → `muitas`
   - aberto 24h → `24h`
   - senão → `basica`
6. **Mensagem** (`montarMensagem`): escolhe combo (abertura|corpo|fechamento) da tabela
   `BLOCOS[chave]` com **unicidade garantida**:
   - fase 1: tenta a "diagonal" `(g-1+t, g+t, g+1+t)` mod tamanho dos pools (vizinhos diferentes);
   - fase 2 (se colidiu): varredura completa do espaço de combos em ordem rotativa `(k*37+g) % total`;
   - sem repetição por chave até esgotar o pool (capacidade = a×m×f).
   Substitui placeholders: `{NOME_CURTO}`, `{NOTA_TXT}` (nota máxima/nota X/boa avaliação;
   removido se lead sem nota), `{AVAL}`, `{EM_BAIRRO}`, `{LOC_REF}`, `{DESC_ATUACAO}`
   (derivado de `categoryName` — não repete palavra já presente no nome).
7. **Dedup**: por `nomeCurto|DDD`, mantém o de mais avaliações.
8. **Ordenação**: nota desc, depois avaliações desc.
9. **Saída**: CSV UTF-8 com BOM: `Nome,Bairro/Região,Telefone,Link WhatsApp,Nota,Avaliações,Ângulo,Mensagem`.

## Blocos de mensagem (BLOCOS)

9 ângulos, cada um com `a` (aberturas), `m` (corpos), `f` (fechamentos). Capacidades atuais:

| ângulo            | a | m | f | pool  | demanda máxima usada |
|-------------------|---|---|---|-------|----------------------|
| sem-telefone      | 5 | 4 | 5 | 100   | 62  |
| credibilidade     | 5 | 10| 7 | 350   | 326 |
| muitas            | 5 | 5 | 5 | 125   | 109 |
| basica            | 5 | 8 | 8 | 320   | 303 |
| 24h               | 3 | 3 | 3 | 27    | 1   |
| shopping-muitas   | 3 | 3 | 3 | 27    | 3   |
| shopping          | 3 | 3 | 3 | 27    | 5   |
| empresarial-muitas| 3 | 3 | 3 | 27    | 3   |
| empresarial       | 3 | 3 | 3 | 27    | 1   |

⚠️ Se a demanda de um ângulo passar o pool, o validador acusa mensagens idênticas.
Regra prática: **antes de processar um CSV novo, confira os counts de ângulo esperados
e amplie os pools** (especialmente `credibilidade` e `basica`, os mais usados).

## Validador (validar.js)

- Colunas obrigatórias na saída.
- Sem placeholders `{}` restantes na mensagem.
- Link `https://wa.me/55\d{10,12}` (ou vazio).
- Ângulo "Sem telefone no cadastro" → link vazio; demais → telefone e link preenchidos.
- Nenhuma mensagem repetida (mesmo ângulo e estrutura, normalizando ` em <bairro>` → ` em X`).
- Vizinhos do mesmo ângulo não podem ter a mesma estrutura.

## Histórico de problemas resolvidos

1. **Combos repetidos apesar do Set** — a "diagonal" colide a cada ~lcm(a,m,f) passos;
   solução: fase 2 com varredura rotativa (PRIME).
2. **Pool estourado em barbearia** (505 leads): credibilidade tinha 110+ e basica 128+
   com pools de 100 — ampliados os blocos m/f (ver tabela acima).
3. **Normalizador do validador guloso** — antes `em [^.!?]+` engolia o resto da frase;
   agora `em [^,.!?—:]+`.
4. **sem-telefone com telefone "malformado"** — validador só exige link vazio (telefone
   bruto pode aparecer com formato estranho no CSV fonte).
5. **Pool estourado em Santa Catarina** (737 leads): basica 303/210 e credibilidade
   326/245 — mais blocos adicionados (nova tabela acima).
6. **Suporte a formato limpo de CSV** — processar.js mapeia colunas alternativas:
   `nome`/`telefone`/`telefone_formatado`/`bairro`/`cidade`/`nota`/`avaliacoes`/`categoria`.
   Cuidado com o helper `valor()`: indexa com `r[col[c]]` (nome -> índice), não `r[c]`.
7. **validar.js crash com nota ausente** — `notesAusentes` não era declarada;
   linha removida (a contagem não era mais usada).
8. **"nota nota máxima"** nas mensagens de credibilidade — template dizia literalmente
   `" Vi a nota {NOTA_TXT}..."` e `NOTA_TXT` expande para "nota máxima"; corrigido para
   `" Vi a {NOTA_TXT}..."`.
9. **Nomes sujos do crawler** (categorias/keywords concatenadas) — `nomeCurto` agora
   corta no primeiro `|`, remove caudas `- em/no/na <lugar>`, `- Unidade/Shopping/<cidade>`
   e sufixos de categoria (barbearia, salão, centro de beleza, micropigmentação, pet shop,
   banho e tosa, etc.). A coluna **Nome** da saída passou a gravar o nome limpo
   (`nomeCurto`), coerente com a saudação da mensagem e com a deduplicação.
10. **`extension/testes/paridade-pipeline.js`** — teste de paridade entre
    `extension/pipeline.js` e `processar.js` (recommitado; havia ficado de fora do
    commit da extensão).

## Estado atual (2026-08-13)

- [x] petshop → 99 leads, Tudo OK
- [x] loja de roupas → 92 leads, Tudo OK
- [x] barbearia → 505 leads, Tudo OK
- [x] clinica estetica SP → 50 leads, Tudo OK
- [x] santa catarina (formato limpo) → 738 leads, Tudo OK
- [x] lixo do diretório de leads movido para `arquivo/`
- [x] documentação (este arquivo)
- [x] extensão Chrome implementada e commitada (`extension/`) — ver seção abaixo
- [x] teste de paridade `pipeline.js` ↔ `processar.js` passando
- [x] todos os outputs revalidados (Tudo OK em todos)

## Próximos passos (em ordem)

1. Revisão manual de um sample de mensagens por ângulo (tom/CTA) —
   sample em `prospeccao-pipeline/output/_revisao_mensagens.md`.
   (Revisão feita em 2026-08-13: bugs de "nota nota" e nomes sujos encontrados e corrigidos;
   seguir conferindo tom/CTA.)
2. Se processar mais CSVs: conferir pools de ângulos antes (regra das demandas acima),
   e lembrar de rodar `validar.js` sobre cada saída.

## Decisão: extensão Chrome (2026-08-13) — IMPLEMENTADA

A extensão Chrome (Manifest V3) reaproveitando toda a lógica do pipeline está **pronta e
commitada** (`847a95d`) em `extension/`:

- **Painel em aba própria** — porta do `app.js`/`index.html` (storage → `chrome.storage.local`).
- **Disparo automático** no `web.whatsapp.com` via content script (`sendOne`): busca o número,
  digita (simulado) e envia. Selectors resilientes + fallbacks; confirmação por compose vazio
  ou texto no painel de mensagens.
- **Pipeline no navegador** — `processar.js` portado (`pipeline.js`): botão "Gerar mensagens"
  para CSV bruto do crawler. Paridade garantida por teste (`extension/testes/paridade-pipeline.js`).
- **Camada anti-ban humanizada** (padrão Conservador): aquecimento progressivo do número,
  janela de horário 9h–18h com pausa de almoço, intervalo aleatório humano (45–120s),
  pausas automáticas e imprevisíveis, limites diário/semanal, fila embaralhada,
  log com horários e botão de emergência.
- `protocolo.js` — constantes compartilhadas de mensagens/storage (manifest, background e painel).

Correções notáveis aplicadas durante a implementação: CSP (delegação de eventos no painel),
dupla injeção do content script (aguarda página `complete`), confirmação de envio não-falsa,
escopo do detector de número inválido no header, resume com contador correto, janela noturna,
CSV com `;`, re-render parcial da tabela, `urlSegura()` contra `javascript:`.

Estrutura: `extension/` (`manifest.json`, `background.js`, `painel.html/css/js`, `pipeline.js`,
`protocolo.js`, `content-whatsapp.js`, `icons/`, `testes/paridade-pipeline.js`). Documentação:
`README.md` na raiz e `prospeccao-pipeline/README.md`.

## Toques finos conhecidos

- Aviso de colunas: o script só avisa (não aborta) se faltar endereço/bairro.
- Lead sem nota tem nota `—` e mensagem sem trecho de nota (removido com regex).
- DDD no dedup vem do link `wa.me`; leads sem telefone vão para `sem-telefone` e não participam do dedup por DDD (sozinha a chave é nomeCurto|vazio — ok, mais conservador).