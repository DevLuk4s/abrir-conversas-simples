# Abrir Conversas

Ferramenta de prospecção para WhatsApp: gera mensagens de abordagem prontas (com variação antispam) e oferece um painel para disparar conversas, tudo 100% no navegador — sem servidor, sem banco de dados.

## Visão geral

O projeto tem duas partes:

1. **Painel web de disparo** (`index.html` + `app.js`) — painel que roda no navegador:
   - Upload de CSV (arrastar/solte ou clique) com leads do Google Maps.
   - Tabela com status por lead: conversa aberta, mensagem enviada, número inválido.
   - Disparo em fila (abre conversas `wa.me` em sequência com intervalo) com pausar/retomar.
   - Dados persistidos no `localStorage` do navegador/aparelho. Backup/restore em JSON.
2. **Pipeline de prospecção** (`prospeccao-pipeline/`) — Node.js:
   - Transforma CSV bruto do crawler em CSV final com **mensagens prontas**, classificadas por "ângulo de abordagem", garantindo que **nunca haja duas mensagens com a mesma estrutura** (antispam).
   - `validar.js` checa invariantes da saída.

## Estrutura

```
abrir-conversas-simples/
├── index.html                 # painel web de disparo
├── app.js                     # lógica do painel (localStorage, CSV, fila de disparo)
├── prospeccao_lojas_iphone_salvador.csv  # exemplo de saída do pipeline (9 leads)
├── .gitattributes
└── prospeccao-pipeline/
    ├── processar.js           # CSV bruto -> CSV de prospecção
    ├── validar.js             # checagem de invariantes (exit 1 se falhar)
    ├── SESSIONS.md            # documentação de estado do pipeline
    └── output/                # CSVs gerados por segmento
```

## Como usar o painel

1. Abra `index.html` no navegador (duplo clique ou `python3 -m http.server`).
2. Arraste um CSV ou clique na área de upload.
3. Ajuste o modelo de mensagem se o CSV não tiver a coluna `Mensagem` do pipeline (use `{NOME}` como placeholder).
4. Na tabela, use os botões de cada lead:
   - **Abrir conversa** — abre modal para pré-visualizar/editar e abrir o WhatsApp.
   - **Marcar como enviada** — registra o envio.
   - **Número não encontrado** — marca como inválido.
5. **Disparar fila** — abre cada conversa pendente em sequência, respeitando o intervalo configurado; pode pausar e retomar.
6. **Exportar/Importar backup** — `.json` para migrar entre navegadores sem perder progresso.

> ⚠️ Os dados ficam salvos só no navegador/aparelho. Não sincronizam entre notebook e celular.

## Formatos de CSV aceitos no painel

- **Já processado (pipeline)** — colunas `Nome, Bairro/Região, Telefone, Link WhatsApp, Nota, Avaliações, Ângulo, Mensagem`. Mensagem e ângulo entram automaticamente.
- **Bruto do crawler/Google Maps (Apify)** — colunas `title, phone, reviewsCount, url, ...` (aceita também `nome, telefone, avaliações, link/url`). Mensagem vem do modelo padrão.
- O telefone é normalizado (ganha `55` quando local); leads duplicados por telefone são deduplicados.

## Como usar o pipeline

```bash
cd prospeccao-pipeline

# Processar um segmento
node processar.js /caminho/para/leads.csv output/<segmento>_leads_prospeccao.csv

# Validar a saída
node validar.js output/<segmento>_leads_prospeccao.csv
```

O validador deve imprimir `Tudo OK.` e sair com código 0. Detalhes completos do fluxo em [`prospeccao-pipeline/README.md`](prospeccao-pipeline/README.md) e [`prospeccao-pipeline/SESSIONS.md`](prospeccao-pipeline/SESSIONS.md).

## Extensão Chrome (implementada)

`extension/` — extensão Manifest V3 que roda o painel em aba própria e dispara direto no `web.whatsapp.com`:

- **Painel em aba própria** (`painel.html/css/js`) — mesmo fluxo do painel web, mas com `chrome.storage.local`.
- **Disparo automático** (`content-whatsapp.js`) — content script busca o número, digita (simulado) e envia. Selectors resilientes + fallbacks; confirmação por compose vazio ou texto no painel de mensagens.
- **Pipeline no navegador** (`pipeline.js`) — porta de `processar.js`, idêntico (teste de paridade em `extension/testes/paridade-pipeline.js`).
- **Camada anti-ban humanizada** (padrão Conservador): aquecimento progressivo, janela de horário 9h–18h com pausa de almoço, intervalo aleatório humano (45–120s), pausas automáticas e imprevisíveis, limites diário/semanal, fila embaralhada, log com horários e botão de emergência.
- `protocolo.js` — constantes compartilhadas de mensagens/storage.

## Roadmap

- Revisão de tom/CTA das mensagens por ângulo (sample gerado em `prospeccao-pipeline/output/_revisao_mensagens.md`).
- Mais segmentos: conferir pools de ângulos antes e rodar `validar.js` sobre cada saída.
