# Extensão — Documentação de Estado (SESSIONS)

> Mantenha este arquivo atualizado. É o ponto de retomada caso a sessão estoure o limite
> ou outra IA assuma o trabalho.
> Última atualização: 2026-08-15

## 🔧 2026-08-15: confirmação de envio reforçada com o tique nativo do WhatsApp

**Pedido do usuário:** garantir que a mensagem foi realmente enviada (não só "apareceu no
painel"). O DOM atual do WhatsApp Web (fornecido pelo usuário) mostrou que o tique NESSA
versão não usa `data-icon`/`data-testid` — é `span[aria-label=" Lida "]` contendo
`<svg><title>wds-ic-read</title></svg>`, dentro de `[data-testid="msg-meta"]` na
`[data-testid="msg-container"]`.

**Correção em `content-whatsapp.js`:**
1. Novo helper `mensagemComTique(bubble)`: detecta tique com fallback multi-versão —
   `data-icon` (`msg-check`/`msg-dblcheck`/`msg-sent`), `data-testid`
   (`msg-check`/`msg-dblcheck`/`msg-dblcheck-ack`), `aria-label`
   (`/enviada|entregue|lida/i` pt ou `/sent|delivered|read/i` en) e `svg title`
   (`/wds-ic-(sent|delivered|read)/i`). Qualquer estado basta (Enviada/✓ já garante envio
   ao servidor).
2. `enviarNoCompose` (caminho principal): confirmação agora é **trecho na última mensagem
   + tique** OU **compose vazio** (fallback mantido). Trecho SEM tique (ex.: sincronização
   pausada → mensagem pendente/relógio) NÃO confirma mais.
3. `enviarNoCompose` (caminho de aborto pós-clique): mesma lógica (trecho + tique OU
   compose vazio) para não marcar "enviado" por engano.

**Validação:** `node --check` OK em `content-whatsapp.js` e `painel.js`.

**✅ TESTE REAL 2026-08-15 (disparo de 5 leads) — resultado documentado:**

```
[16:59:20] ✓ Teste Loja Real (5571984078620)         — 3 mensagem(ns) enviada(s)
[16:55:13] ✓ Bahia Tech iPhones (Teste) (557193523146) — 3 mensagem(ns) enviada(s)
[16:53:41] ✗ Conecta Express (Fantasma 1)            — número não encontrado
[16:53:25] ✗ Smart Salvador (Fantasma 2)             — número não encontrado
[16:50:56] ✓ Salvador Cell (Teste) (557186609769)     — 3 mensagem(ns) enviada(s)
```

- **3 envios reais confirmados ✓** (Salvador Cell, Bahia Tech, Teste Loja Real) — inclui o
  lead Bahia Tech do `conversa-errada` anterior: agora enviou SEM erro de conversa errada.
- **2 fantasmas corretamente rejeitados** ("número não encontrado") — os fantasmas 1 e 2
  não existem de propósito e não receberam mensagem. Comportamento esperado.
- Nota: o log do painel é por LEAD, não por mensagem; cada lead com 3 mensagens é a
  validação de envio por tique/nativo rodando 3x sem falso positivo.

**Observação sync-paused:** não houve `sem-confirmacao` neste disparo — a confirmação por
tique funcionou (ou compose vazio). Garantir o celular conectado durante o disparo.

## 📋 2026-08-15: decisões de produto (pós-teste) — usuário finalizou o ciclo

**Contexto do usuário:** vai capturar leads via **Apify** e **normalizar/filtrar o CSV
manualmente com ChatGPT** antes de importar na extensão. Objetivo: só fazer a ABORDAGEM
(1º contato) e depois desenrolar no manual. Por isso o CSV de produção virá pronto no
formato aceito (`nome`, `telefone`, `mensagem_1...`) — **nenhuma regra de CSV é
necessária** no import.

**Decisões registradas (ponto de retomada):**
1. **Navegação fica COMO ESTÁ** (matcher por dígito/nome + resultado-novo + Enter + 4c/4e).
   Não simplificar: o caso "mana" (contato salvo com nome diferente do CSV) é ISOLADO; na
   maioria dos leads reais o número aparece em dígitos/nome+número na linha do resultado,
   e o matcher por dígito resolve. Leads novos do Apify (sem contato salvo) mostram o
   número em dígitos → coberto pelo matcher por dígito.
2. **Estados de contato no WhatsApp do usuário (materiais para diagnóstico futuro):**
   - "mana" → contato salvo com nome diferente do CSV (caso isolado, só Bahia Tech/Salvador
     Cell). Matcher por nome/dígito falha; navega via resultado-novo ou Enter.
   - "Teste Loja Real" → salvo como DÍGITOS (número aparece na linha).
   - "Salvador Cell (Teste)" → salvo com NOME + número do contato.
3. **Confirmação de envio por tique** continua como está (validada).
4. **Item futuro (ADIADO, não implementar agora):** adicionar no log do painel o método de
   confirmação usado (tique vs compose vazio) — hoje não dá pra saber qual confirmou; seria
   útil antes de lotes grandes do Apify. Registrado como pendência de observação.
5. **Riscos conhecidos (documentados, não bloqueiam):** orquestração do painel não
   estressada (limites diário/semanal, resume, retry "ocupado", morte do painel) com lotes
   pequenos; dependência do DOM do WhatsApp (atualização pode quebrar seletores e o tique
   cairia pro fallback compose); número fixo (DDD+3xxx) sem 9º dígito não é WhatsApp.
6. **Trabalho NÃO commitado** — estado validado no working tree aguardando commit do
   usuário: tique nativo, instrumentação conversa-errada, UI redesenhada, SESSIONS.md.
   Repo está 4 commits à frente de `origin/main`.

## 🔧 Auditoria 2026-08-15 (3º): 4 falhas de código corrigidas na revisão completa

**Pedido do usuário:** "buscar falhas no código é corrigir" — auditoria nos 4 arquivos
(painel.js, content-whatsapp.js, background.js, protocolo.js).

1. **Encoding do CSV (painel.js `lerCsv`):** lia com `readAsText(file, "utf-8")` — CSV em
   ANSI/CP1252 (exportação comum de Excel/planilhas BR) quebrava acentos (ã → "Ã£") e o
   nome não batia mais na busca. Agora lê ArrayBuffer + `TextDecoder("utf-8",{fatal:true})`
   com fallback pra `windows-1252`.
2. **Classificação `naoAchou` (painel.js `processarFila`):** `compose-nao-encontrado` e
   `tela-nova-conversa-nao-confirmada` eram marcadas como "número não encontrado" (cinza ✗
   permanente). São falhas de NAVEGAÇÃO, não prova de inexistência — pela regra do usuário
   (vazio = não existe) só `numero-invalido` é definitivo. Agora caem em erro normal pra
   revisão manual (nunca entram no registry).
3. **`enviarNoCompose` (content-whatsapp.js):** (a) se o botão de enviar vier desabilitado
   (React não registrou o texto após re-render do compose), Enter no box como fallback em
   vez de travar a rodada; (b) aborto durante a confirmação de envio agora retorna
   `abortado` (era `sem-confirmacao` genérico).
4. **`comTimeout`/lock `ocupado` (content-whatsapp.js):** se a promise do `sendSeq` nunca
   assentasse, o lock nunca liberava e o painel travava pra sempre (sintoma "timeout-geral/
   travamento"). Agora o release da resposta tem teto extra de 10s via `Promise.race`.

**Validação:** `node --check` OK nos 4 arquivos. **Teste real concluído ✓ (2026-08-15):**
usuário rodou o `teste.csv` — rodada funcionou bem: sequência de 3 mensagens completa,
fantasmas seguem corretos em "número não encontrado".

## 🔧 Correção 2026-08-15 (2º): sequência de mensagens parava depois da 1ª (stale compose)

**Sintoma relatado (teste real após a correção do nome):** com `teste.csv`, os 2 fantasmas
caíram certos em "número não encontrado", 2 reais (Teste Loja Real e Bahia Tech) enviaram
as 3 mensagens, mas **Salvador Cell — o lead corrigido — abriu o chat CERTO, enviou 1
mensagem e então deu erro**, deixando as outras 2 mensagens da conversa sem enviar (lead
marcado como erro, sequência abortada no meio).

**Causa provável em `sendSeq`/`enviarNoCompose` (content-whatsapp.js):** o loop de
`sendSeq` capturava o nó do compose UMA vez na abertura (`aberta.compose`) e reutilizava
essa referência para todas as mensagens. O WhatsApp React pode trocar/re-renderizar o nó
do compose após cada envio — a referência capturada fica desanexada e "digitar" nela não
chega ao campo real: o botão de enviar nem habilita, o clique não envia e a confirmação
estoura (`sem-confirmacao`) na 2ª mensagem.

**Correção:** `enviarNoCompose` agora re-adquire um compose **VISÍVEL** a cada envio
(`const box = primeiroComposeVisivel() || compose;`) e digita nesse nó atual — o recebido
só é fallback. A confirmação de envio já usava `primeiroComposeVisivel()` (não mudou).

**Validação:** `node --check` OK. **Pendente teste real:** recarregar a extensão e rodar
`teste.csv` — Salvador Cell deve abrir o chat certo e enviar as 3 mensagens em sequência.

## 🔧 Correção 2026-08-15: nome do CSV com sufixo entre parênteses quebrava o match de contato real salvo por nome

**Sintoma relatado (log real):** na rodada de teste com `teste.csv` (3 reais + 2 fantasmas),
os fantasmas caíram certos em "número não encontrado", Teste Loja Real e Bahia Tech enviaram,
mas **Salvador Cell (Teste) — contato REAL salvo por nome — falhou nas 2 rodadas**:
1ª como "número não encontrado", 2ª como "conversa-errada". Recurso recorrente (3 problemas
citados: envio pra chat errado, real salvo por nome vira "não encontrado", timeout).

**Causa raiz em `acharResultadoPorNumero` (content-whatsapp.js):** o match por nome exigia
que **TODOS** os tokens do nome do CSV aparecessem no texto do resultado. O CSV diz
"Salvador Cell **(Teste)**" mas o contato está salvo no WhatsApp como "Salvador Cell" — o
token "teste" nunca bate. Como Salvador Cell já era chat recente (aberto em rodadas
anteriores), `acharResultadoNovo` também não achava (o texto dele já estava no snapshot
pré-digitação). Sobrava o fallback de Enter, que abre o 1º resultado visível — inconfiável
→ "não encontrado"/"conversa-errada". Bahia Tech funcionou porque não era chat recente no
momento (item "novo" apareceu).

**Correção:** remover o conteúdo entre parênteses do nome ANTES de tokenizar:
```js
const nomeNorm = normalizarNome((nome || "").replace(/\([^)]*\)/g, " "));
```
"Salvador Cell (Teste)" → tokens `["salvador","cell"]` → bate no resultado "Salvador Cell".
Só remove os parênteses do nome do CSV (não muda nada na busca digitada); o match por dígito
continua como antes. Rede de segurança (4c/4e + `detectarNumeroInvalido`) inalterada.

**Validação:** `node --check` OK + teste unitário da normalização confirmando `bate=true`.
**Pendente teste real:** recarregar a extensão e rodar `teste.csv` — Salvador Cell deve
abrir o chat certo e enviar as 3 mensagens.

## 🔧 Auditoria 2026-08-14: revisão sênior (MV3) — correções aplicadas

**Origem:** pedido de auditoria completa (mapeamento, bugs, segurança, performance,
refatoração, boas práticas). Relatório abaixo com o que estava correto e o que foi corrigido.

**Já estava correto (sem mudança):**
- Manifest V3: `service_worker` (não background page persistente), `action`, CSP
  `script-src 'self'; object-src 'self'` — sem `eval`/blob.
- `host_permissions` restrito a `https://web.whatsapp.com/*` (não `<all_urls>`).
- Sem segredos/API keys hardcoded. Todos os dados em `chrome.storage` local.
- `innerHTML` só com dados escapados: `montarLinha`/`renderizarLog` usam `escaparHtml`;
  `modalTitulo`/`atualizarProgresso` usam `textContent` (sem XSS na própria extensão).
- Content script só roda em `web.whatsapp.com`, `run_at: document_idle` (não em todas as
  páginas), com guarda de idempotência `__acContentScript` (sem listener duplicado).
- Mensagens tipadas via `AC_MSG` (protocolo.js, idempotente com `globalThis`).
- `sendMessage`/`onMessage` com resposta assíncrona correta (`return true` no listener do
  SEND_ONE/SEND_SEQ e no GET_WHATSAPP_TAB do background).
- Sem MutationObserver (nada para desconectar); storage com debounce (400ms) + flush.
- Selectors do WhatsApp com múltiplos fallbacks (arrays `SELETORES`).

**Correções aplicadas:**
1. **Código morto**: removida a função `temResultadoVisivel` (content-whatsapp.js) — sem
   uso após as correções de busca por snapshot/resultado-novo.
2. **console.logs esquecidos**: removidos os 2 logs de debug em content-whatsapp.js
   ("não confirmei a tela 'Nova conversa'" e "busca sem resultados — tratando como inválido").
3. **Rejeição não tratada no background** (background.js `abrirPainel`): `chrome.tabs.update`
   e `chrome.windows.update` agora têm `.catch(() => {})` — antes, se a aba/janela sumisse
   entre o `tabs.get` e o update, a promise rejeitava sem tratamento.
4. **Falha de storage sem tratamento** (painel.js `Storage` wrapper): `get` agora retorna o
   fallback com `console.error`; `set` loga e re-lança (para o try/catch de quem chamou).

**Validação:** `node --check` OK em todos os 4 arquivos.

## 🔧 Ajuste 2026-08-14: "número não encontrado" com cara de enviado, mas SEM marcar como enviado

**Pedido do usuário:** (a) lead "número não encontrado" deve ficar visualmente igual ao
"enviado" (sem o riscado cinza); (b) só marcar como **enviado** quando a mensagem saiu com
sucesso — número não encontrado **não** pode ser marcado como enviado nem registrar no
registry.

**Já garantido na lógica (não mudou):** `processarFila` só seta `status: "enviado"` +
`registrarEnviado` (painel.js:945) quando `resp.ok`. Número não encontrado (`naoAchou`)
vai para `status: "erro"` + `naoEncontrado: true` + `naoEncontradoEm`, sem contar no
daily/weekly e sem entrar no registry — então reimportar o CSV não força "enviado".

**Ajuste visual em `painel.js` (`montarLinha`):**
1. `naoEncontrado` agora usa a classe `enviada` (fundo azul, sem riscado).
2. Badge verde com rótulo "Número não encontrado".
3. Botão desabilitado **sem** "✓": "Número não encontrado" (antes tinha "Número não
   encontrado ✓", que parecia marcação de envio). O "Enviada ✓" fica só para envios reais.

**Validado:** `node --check` OK em `painel.js`.

## 🔧 Ajuste 2026-08-14: marcar como "número não encontrado" quando não acha o contato

**Pedido do usuário:** quando a extensão não acha o contato, o lead deve ser marcado
SOZINHO como "número não encontrado" (sem ação manual).

**Antes:** só o erro `numero-invalido` marcava `naoEncontrado: true`. Depois das 5
tentativas, o erro final `compose-nao-encontrado` (busca não abriu nenhuma conversa) caía
no ramo genérico → lead ficava como "Erro" genérico (mesma cara de um erro de envio).

**Correção em `painel.js` (`processarFila`):** novos erros tratados como "número não
encontrado" quando são o resultado FINAL (após os retries):
- `compose-nao-encontrado` — a busca não abriu conversa nenhuma.
- `tela-nova-conversa-nao-confirmada` — não chegou na tela "Nova conversa" (busca cairia
  no filtro da lista principal).

Ambos agora setam `naoEncontrado: true` + `naoEncontradoEm`, e o log diz "número não
encontrado". `numero-invalido` continua como antes.

**Validado:** `node --check` OK em `painel.js`.

## 🔧 Correção 2026-08-14: contato salvo por nome NÃO abria (só número não salvo enviava)

**Sintoma relatado (após a 4ª correção):** "a extensão só consegue mandar mensagem pra
contato não salvo". Contato salvo no WhatsApp com nome DIFERENTE do CSV não abria a
conversa (compose nunca aparecia → timeout/`compose-nao-encontrado`).

**Causa raiz em `clicarPrimeiroResultado`:** para o contato salvo por nome que JÁ era
chat recente, nenhum matcher dispara — a linha do resultado mostra só o nome salvo (sem
dígitos → `acharResultadoPorNumero` não bate) e o texto já estava no snapshot pré-digitação
(→ `acharResultadoNovo` não acha). O `if (!el) return false;` (antes da checagem de
compose) **abortava a função ANTES dos fallbacks de Enter** (linhas 689 e 702 antigas,
que dependiam de `el` ter sido encontrado). Ou seja: contato não salvo funciona porque a
linha tem dígitos → clique certo; salvo por nome → `el` null → desistência imediata.

**Correções em `content-whatsapp.js`:**
1. `clicarPrimeiroResultado` reescrito:
   - Preferência: `acharResultadoPorNumero` (dígito/nome) e `acharResultadoNovo` (item
     novo pós-digitação). Se achar, clica e confirma o compose.
   - **Removido** o `if (!el) return false;` que bloqueava o caminho de Enter.
   - **Removido** o fallback cego `listaFiltrada()` → `primeiroResultadoVisivel()`
     (foi o que clicou em grupo fixado/recente na 3ª correção).
   - **Fallback único de Enter** na busca: se nenhum `el` foi encontrado OU o clique não
     navegou, pressiona Enter no campo de busca (comportamento nativo da tela "Nova
     conversa" — abre a conversa do número digitado, salvo por nome ou não). Guarda:
     `busca && !telaComVazioVisivel()` (a regra do usuário: vazio = não existe; apareceu
     algo = é o número certo). Timeout 8s. `buscaSemResultados` já confirmou a existência
     do número antes, então o Enter abre exatamente a conversa daquele número.
2. Removidas as funções órfãs `listaFiltrada` e `primeiroResultadoVisivel` (sem uso restante).

**Rede de segurança mantida:** header 4c/4e (`validarNumeroNoHeader`) +
`detectarNumeroInvalido` validam depois que a conversa abre — um Enter/clique errado
não dispara mensagem.

**Validado:** `node --check` OK. **Pendente teste real:** recarregar a extensão e rodar
`teste.csv` — os 2 contatos salvos por nome devem abrir e disparar; os 2 fantasmas devem
continuar caindo em `numero-invalido`.

## 🔧 Correção 2026-08-14: contato salvo com nome diferente + número fantasma (tudo automático)

**Origem:** pedido do usuário — CSV de teste (`teste.csv`) com 3 números reais salvos no
WhatsApp com nome DIFERENTE do CSV e 2 números que não existem (fantasmas). Objetivo:
reais abrem e disparam; fantasmas viram `numero-invalido` sem intervenção.

**content-whatsapp.js:**
1. **`snapshotResultadosVisiveis()`** (novo): coleta num `Set` o texto dos itens visíveis
   da lista (`chat-list`/`#pane-side`) ANTES de digitar o número — o "estado pré-busca"
   (fixadas/recentes). Chamado em `tentarAbrirConversa` logo após `busca.click()`+sleep,
   antes do `digitar`.
2. **`acharResultadoNovo(itensAntes)`** (novo): retorna o 1º item visível cujo texto NÃO
   está no snapshot = resultado que surgiu por causa da busca do número. Cobre o contato
   salvo com nome diferente: a linha mostra o nome salvo (sem dígitos), `acharResultadoPorNumero`
   não bate, mas o item é "novo" → clica e envia.
3. **`buscaSemResultados(telefone, nome, itensAntes)`**: agora também recebe o snapshot.
   Inválido (sem clicar) se tela de vazio OU após 8s nenhum resultado novo apareceu
   (fixadas/recentes não contam mais como "resultado" — antes confundiam via
   `temResultadoVisivel`). Existe se dígito/nome OU resultado novo.
4. **`clicarPrimeiroResultado(telefone, nome, busca, itensAntes)`**: tenta
   `acharResultadoPorNumero` (dígito/nome) e, se nada, `acharResultadoNovo`. NÃO há fallback
   genérico de "primeiro item visível" (mantém a proteção contra chat errado de número fantasma).

**Comportamento automático:**
- Real com nome salvo diferente → resultado novo → clica → envia.
- Fantasma sem exibição na busca → 8s sem resultado novo → `numero-invalido` sem clicar.
- Fantasma exibido como linha só com o número → bate por dígito → clica → WhatsApp mostra
  "não registrado/convidar" → `detectarNumeroInvalido` marca `numero-invalido`.

**Validado:** `node --check` OK.

## 🔧 Correção 2026-08-14: auditoria completa (relatório) — correções aplicadas

**Origem:** auditoria de 6 etapas (mapeamento, bugs, segurança, performance, refatoração,
boas práticas). Relatório com 🔴3 / 🟡8 / 🟢13. Itens corrigidos abaixo.

**content-whatsapp.js:**
1. **Timeout-geral não abortava o envio em andamento e liberava o lock `ocupado`**
   (risco de 2 envios concorrentes): no listener `SEND_ONE/SEND_SEQ`, quando o
   `comTimeout` resolve `timeout-geral`, agora seta `abortado = true` (o
   `sendSeq`/`sendOne` desiste nas checagens) e só libera `ocupado` quando a
   operação terminar (`Promise.resolve(fn).finally(...)`).
2. **Regressão: número real salvo por NOME virava `numero-invalido`** (o fix anterior
   removeu `primeiroResultadoVisivel` como sinal de existência, mas contato salvo por
   nome mostra só o nome na busca, sem dígitos):
   - `acharResultadoPorNumero(telefone, nome)`: agora bate por **últimos 8 dígitos OU
     pelo nome do contato** (`normalizarNome`: minúsculo, sem acentos, tokens).
   - `buscaSemResultados(telefone, nome)`: "não existe" = tela de vazio OU 8s sem
     NENHUM resultado visível (`temResultadoVisivel`); resultado visível sem match =
     INCONCLUSIVO (não bloqueia — o clique continua restrito a match de dígito/nome).
   - `nome` propagado: painel → SEND_SEQ/SEND_ONE → `abrirConversaComRetry` →
     `tentarAbrirConversa` → `buscaSemResultados`/`clicarPrimeiroResultado`.
3. **Fallback de Enter podia abrir chat errado**: `clicarPrimeiroResultado` só usa
   Enter se o 1º resultado visível for o nosso alvo (`primeiroResultadoVisivel() === el`).
4. **Nova checagem 4e**: `validarNumeroNoHeader` — se o header da conversa aberta
   mostrar um número de telefone que NÃO é o do lead, retorna `conversa-errada` (não envia).
5. **`enviarNoCompose` (simulação OFF)**: usa `document.execCommand("insertText")`
   (mesmo mecanismo de input do WhatsApp) em vez de `textContent` direto, que o React
   podia ignorar (botão de enviar nem habilitava). Fallback pro modo direto se falhar.
6. **Teto do SEND_SEQ**: `Math.max(900000, ms + 120000)` — intervalos longos entre
   mensagens (até 3600s) não cortam mais a sequência no meio.
7. `detectarNumeroInvalido`: `iteracoes` 20→15, leitura do `#main` limitada a 3000
   chars, `abortado` checado no loop, sleep 300ms (perf).
8. Código morto removido: `validarNumeroAberto`, `SELETORES_RESULTADO`, seletor
   `infoDrawer`. Refatoração: retry de navegação extraído em `abrirConversaComRetry`
   (compartilhado por `sendOne`/`sendSeq`).

**painel.js:**
9. **Leads presos em `enviando` para sempre** (resume só pega `pendente`): os ramos
   de erro `abortado`/genérico e o catch de aba fechada agora setam
   `status: "erro"` + `erroEm` (saindo de `enviando`).
10. **Backup importava status `enviando`** (lead preso): `"enviando"` removido da
    lista de status aceitos no `sanitizar` → vira `pendente`/`ignorado`.
11. `data-id` dos botões da tabela agora passa por `escaparHtml` (consistência/XSS).
12. **Perf**: `persistirEstado` com debounce (400ms) agrupando as transações de
    storage (antes: LEADS+LOG+STATS+DAILY+WEEKLY inteiros a cada envio) +
    `flushPersistir` no `try/catch` de fim de lead e no `finally`. `renderizarLog`
    só re-renderiza quando o `<details>` do log está aberto (com listener `toggle`).
13. `SEND_SEQ` agora envia `nome: lead.nome`.
14. Código morto removido: `lerEnviados`, campo `jaEnviado`, constantes
    `AC_STORAGE.ENVIADOS` e `AC_STORAGE.MODELO` (protocolo.js).

**background.js:**
15. **Múltiplas abas do WhatsApp**: `getWhatsAppTab` agora prefere a aba que responde
    PING e está logada (senão pegava a primeira, podendo ser uma antiga deslogada).

**Validação:** `node --check` OK em todos os 4 arquivos. **Pendente teste real:** disparar
com número salvo por nome (deve abrir e enviar), número-fantasma (deve cair em "número
não encontrado" sem enviar a ninguém), 2 abas do WhatsApp abertas, e EMERGÊNCIA durante
um timeout.

## 🔧 Correção 2026-08-14: falso "conversa-errada" (números-fantasma marcados como erro de envio)

**Sintoma relatado (log de disparo real):** número real envia OK; números-fantasma/teste
são marcados como `conversa-errada` em vez de "número não encontrado". O mesmo lead
(Salvador Cell) foi detectado como `numero-invalido` no 1º disparo e como
`conversa-errada` nos seguintes.

**Causa:** a validação de header em `tentarAbrirConversa` usava `primeiro(SELETORES.header)`,
que devolve o header de uma conversa anterior **oculto no DOM** depois que a tela "Nova
conversa" abriu. Comparar esse resíduo antes/depois da busca fazia `textoHeaderDepois ===
textoHeaderAntes` → falso `conversa-errada`, antes de chegar ao `detectarNumeroInvalido`.
`detectarNumeroInvalido` tinha o mesmo problema (lia o header oculto e não achava o padrão
de convite).

**Correções em `content-whatsapp.js`:**
1. Novo helper `headerConversaVisivel()` (mesmo padrão do `primeiroComposeVisivel`): só
   devolve header **visível** (`estaVisivel`).
2. Usado na captura `textoHeaderAntes`/`textoHeaderDepois` (4c) e no `detectarNumeroInvalido`.

**Validação:** `node --check` OK. **Pendente teste real:** disparar de novo com os números
fantasma/teste e confirmar que caem em "número não encontrado" (não `conversa-errada`).

## 🔧 Correção 2026-08-14: envio para o número ERRADO (número inexistente cai em outro chat)

**Sintoma relatado:** números-fantasma/teste que não existem estavam **enviando a
mensagem para outra conversa** (chat errado), em vez de marcar "número não encontrado".

**Causa raiz (fallback perigoso em `clicarPrimeiroResultado`):** quando a busca do
número-fantasma não retornava linha com dígitos, o código caía no fallback que clicava
no **primeiro item VISÍVEL** da lista (`primeiroResultadoVisivel`). Esse item podia ser
uma conversa qualquer (fixada, recente, outro contato) — o chat errado abria, o header
mudava, passava na checagem 4c e a mensagem saía pro destino errado. `buscaSemResultados`
também tratava "qualquer item visível" como "o número existe", alimentando esse caminho.

**Correções em `content-whatsapp.js`:**
1. `clicarPrimeiroResultado`: **removido o fallback de "primeiro item visível"**. Agora
   só clica em resultado que contenha os dígitos do número (`acharResultadoPorNumero`).
2. `buscaSemResultados`: "não existe" = tela de vazio ("nenhum resultado") OU 8s sem
   resultado com os dígitos; **removido** o `primeiroResultadoVisivel()` como sinal de
   existência.
3. Removida a função órfã `primeiroResultadoVisivel` (sem uso restante).

**Validação:** `node --check` OK. **Pendente teste real:** disparar com números-fantasma
e confirmar que caem em "número não encontrado" SEM enviar mensagem a nenhum outro chat.

## 🔧 Correção 2026-08-14: pausa entre leads só após mensagem enviada + detecção de número inexistente mais rápida

**Solicitação:** quando o número não é encontrado, pular direto pro próximo lead — a pausa
entre leads só deve existir quando uma mensagem foi enviada de verdade.

**Correções:**
1. `painel.js` (`processarFila`): flag `ultimoEnviou` (true só quando `resp.ok`). A pausa
   entre leads (`intervaloMin/Max`) só roda depois de um envio bem-sucedido; número não
   encontrado / erro pula imediatamente pro próximo.
2. `content-whatsapp.js` (`buscaSemResultados`): polling reduzido de 400ms → 250ms — a
   confirmação de "nenhum resultado" (mensagem de vazio) é detectada mais rápido.

**Validação:** `node --check` OK em `painel.js` e `content-whatsapp.js`. **Pendente teste
real:** conferir que número inexistente avança rápido pro próximo e que a pausa continua
normal após envios.

## 🔧 Correção 2026-08-13 (madrugada): número REAL salvo por nome era marcado como "não encontrado"

**Sintoma relatado:** após o fix das fixadas, números reais que o usuário salva por **nome**
(ex.: "Soul Iphones", "Palace Store") começaram a ser marcados como **"número não encontrado"**,
mesmo existindo no WhatsApp.

**Causa:** a busca digitada mostra o contato com o **nome** (não os dígitos). `acharResultadoPorNumero`
exigia os dígitos no texto do resultado → não achava → virava "não encontrado". Além disso o
`buscaSemResultados` só esperava 8×400ms (~3,2s), e o WhatsApp às vezes demora mais pra filtrar.

**Lógica simples do usuário (aplicada):** *"pega numero, joga no campo de buscar, verificar se
existe; se não existir dá como não encontrado e vai pro próximo"*.

**Correções em `content-whatsapp.js`:**
1. `buscaSemResultados(telefone)` reescrito: espera até **~8s**; **"existe" = apareceu QUALQUER
   resultado visível** (não exige dígitos — cobre contato salvo por nome); "não encontrado" =
   mensagem de vazio visível ou 8s sem nenhum resultado.
2. `clicarPrimeiroResultado`: **fallback seguro restaurado** — se não bateu dígito, clica o
   1º resultado **visível** (`primeiroResultadoVisivel`), mas só quando NÃO há tela de vazio.
3. Mantida a proteção das fixadas: só clica nós **visíveis** (`estaVisivel`), e o
   `telaComVazioVisivel` descarta antes qualquer fixada oculta.

**Validação:** `node --check` OK + harness passou os cenários: número inexistente c/ fixadas →
`numero-invalido` SEM clicar fixada; **número real salvo por nome (sem dígitos) → abre a
conversa e envia OK**; SEND_SEQ (2 msg + vazia), não-logado e SEND_ONE continuam OK.

## 🔧 Correção 2026-08-13 (noite): loop abrindo conversas fixadas com número inexistente

**Sintoma relatado:** quando o lead tem um número que **não existe no WhatsApp**, o robô
entrava em **loop tentando abrir as conversas fixadas** do usuário (mandava/abria chat errado).

**Causa:** `clicarPrimeiroResultado` tinha um **fallback para o "primeiro item genérico"**
da lista. Sem resultado com o número buscado, ele clicava na 1ª conversa fixada (a 1ª da
lista), o compose abria, a checagem de header passava (header da conversa anterior ≠
fixada) e o loop repetia.

**Correções em `content-whatsapp.js`:**
1. `clicarPrimeiroResultado`: **removido o fallback genérico** — agora só clica o item que
   contém os dígitos do número (`acharResultadoPorNumero`); sem item → `false`.
2. `buscaSemResultados(telefone)` (antes sem arg): agora checa **por número** (nenhum item
   com os dígitos + nenhum resultado na lista) e retorna número inválido **de forma
   definitiva**, evitando gastar tentativas E impedindo o fallback de fixada.
3. `acharResultadoPorNumero`: ignora nós **não visíveis** (conversas fixadas da pane
   maior ficam ocultas na tela "Nova conversa") — não casa com elas.
4. Adicionado `BUSCA_VAZIA` (mensagens "nenhum resultado" pt/en) como confirmação extra.
5. Removida a constante órfã `SELETORES_RESULTADO`.

**Validação:** `node --check` OK + harness de teste com DOM simulado passou o cenário:
número inexistente + conversas fixadas na lista → retorna `{ ok:false, erro:"numero-invalido" }`
sem clicar em fixada. `SEND_SEQ` (2 msg + vazia pulada), não-logado e `SEND_ONE` continuam OK.

## ⚠️ Mudança de plano aplicada em 2026-08-13

O sistema virou um **disparador puro de mensagens prontas**. Nada de IA, nada de geração.

Removidos/desativados:
- `prospeccao-pipeline/` (processar.js, validar.js, output/, SESSIONS) — apagado.
- `extension/pipeline.js` — apagado (painel não chama mais `window.Pipeline`).
- `extension/testes/paridade-pipeline.js` — apagado.
- `index.html` + `app.js` (painel web raiz) — apagados.
- `prospeccao_lojas_iphone_salvador.csv` — apagado.

Novo modelo (mantendo a camada anti-ban):
- CSV aceito: colunas `nome`, `telefone`, `empresa` e **todas** as `mensagem_N`
  (`mensagem`, `mensagem_1`, `mensagem_2`, ..., na ordem do arquivo).
- O conteúdo é enviado **exatamente como está no CSV** — sem `{NOME}`, sem correção,
  sem reescrita. Célula de mensagem vazia é pulada; lead sem telefone ou sem nenhuma
  mensagem fica `ignorado` (fora do disparo).
- Envio por lead via nova ação **`SEND_SEQ`**: abre a conversa uma vez, envia
  mensagem_1 → aguarda intervalo → mensagem_2 → aguarda → mensagem_3 → fecha.
- Status por lead: `pendente`, `enviando`, `enviado`, `erro`, `ignorado`.
- Intervalos: **entre leads** (`cfgIntervaloMin/Max`) e **entre mensagens da mesma
  conversa** (`cfgMsgIntervaloMin/Max`), ambos sorteados humanos.
- Toda a camada anti-ban foi mantida: janela de horário, almoço, limites
  diário/semanal, aquecimento progressivo, embaralhar, simular digitação, pausa
  automática, pausa curta imprevisível, emergência e resume de fila.

## O que o projeto faz

Extensão Chrome (Manifest V3) de prospecção no WhatsApp Web. Carrega um CSV de leads
**já preparado** (mensagens prontas, análise/personalização feitas fora da extensão) e
**dispara automaticamente** as mensagens no `web.whatsapp.com`: abre a conversa pelo
número, digita o conteúdo exato do CSV (simulação humana opcional) e envia — tudo sem
recarregar a página (método "zero reload"). Envia exatamente o que veio na lista, na
ordem das colunas, um lead por vez.

Não cria, reescreve, resume, corrige ou personaliza nenhuma mensagem.

## Estrutura

```
extension/
├── manifest.json            # MV3; content_scripts em web.whatsapp.com/*; permissions storage/scripting
├── protocolo.js             # constantes AC_MSG (mensagens) e AC_STORAGE (chaves do chrome.storage)
├── background.js            # service worker: abre o painel, localiza/injeta o content script
├── content-whatsapp.js      # roda DENTRO do WhatsApp Web: API ping/status/sendOne/sendSeq
├── painel.html / css / js   # painel em aba própria (UI completa do disparo)
└── icons/                   # ícones 16/32/48/128
```

## Como a extensão se conecta (fluxo de mensagens)

`protocolo.js` define as constantes (`AC_MSG`, `AC_STORAGE`), carregado antes de tudo.
É idempotente (`globalThis.__acProtocolo`).

- **background.js** (`chrome.action.onClicked`) → abre `painel.html` em aba própria.
- **`GET_WHATSAPP_TAB`** (painel→background): acha/cria a aba `web.whatsapp.com/*`, faz
  `PING`, e se o content script não responde, injeta via `chrome.scripting.executeScript`
  (`protocolo.js` + `content-whatsapp.js`). A idempotência (`__acContentScript`) evita
  duplo envio.
- **`STATUS`** (painel→content): `{ ok, logado, selectors: {searchInput, compose, send, header} }`.
- **`SEND_ONE`** (painel→content): `{ telefone, mensagem, simulacao }` → `{ ok }` ou `{ ok:false, erro }`.
- **`SEND_SEQ`** (painel→content): `{ telefone, mensagens[], intervaloEntreMsgs, simulacao }` →
  `{ ok, enviadas:n }` ou `{ ok:false, erro, enviadas[] }`. Abre a conversa uma vez e envia as
  mensagens em sequência respeitando o intervalo entre elas (célula vazia já filtrada no painel).

## Arquitetura do content-whatsapp.js (estado atual)

Script IIFE, `"use strict"`, idempotente. Constantes: `TIMEOUT_GERAL_SEND_ONE = 180000`,
`MAX_TENTATIVAS_NAV = 5`, `ocupado` (lock anti-concorrência).

### Seletores (`SELETORES`, linhas ~22-49)

- `login`: `.landing-window`, `[data-testid="qrcode"]` → não logado.
- `searchInput`: contenteditable `data-tab="3"`, `[data-testid="chat-list-search"]` (contenteditable ou input),
  `input[data-testid="search"]`, `input[type="text"]`, `[role="textbox"][data-tab="3"]`, contenteditable `data-tab="2"`.
- `compose` (campo de mensagem): `[data-testid="conversation-compose-box-input"]`,
  contenteditable `data-tab="10"`, `footer div[contenteditable="true"]`,
  `[role="textbox"][contenteditable="true"][data-tab="10"]`.
  > ⚠️ Ajuste recente: o seletor genérico `div[role="textbox"][contenteditable="true"]`
  > (sem `data-tab="10"`) casava também com a **caixa de busca**, causando falso
  > "conversa aberta". Foi restringido.
- `send`: `button[data-testid="send"]`, `span[data-icon="send"]`, `button[aria-label="Enviar"]`.
- `header`: `[data-testid="conversation-info-header"]`, `header`.
- `panelMensagens`: `[data-testid="conversation-panel-messages"]`, `#main`.

### Helpers

- `q(sel)` / `primeiro(arr)` — primeiro seletor que casa.
- `aguardar(fn, timeout, intervalo)` — poll até `fn()` retornar truthy; senão `null`.
- `novoEventoInput()` — `InputEvent("input")` com fallback para `Event`.
- `posicionarCursorNoFim(el)` — coloca cursor no fim (contenteditable).
- `pressionarTecla(el, tecla, codigo, keyCode)` — dispacha `keydown/keypress/keyup`.

### `digitar(el, texto)` (linhas ~116-152) — tipo humano

- **contenteditable**: `document.execCommand("insertText")` char a char, com pausa
  `25–75ms` (3% das vezes `250–700ms`), plus `150–500ms` no fim.
- **`<input>`** (tela "Nova conversa"): usa o **setter nativo**
  (`HTMLInputElement.prototype.value` setter) + `InputEvent("input")` com `data: ch`,
  porque input controlado por React ignora `el.value = ...` direto.
- Fallback se `execCommand` falhar: `textContent += ch` + evento.

### `limparTudo()` (linhas ~168-242) — reset de estado

Idempotente. Passos:
1. Se há **compose** visível (conversa aberta), clica no botão **"Nova conversa"**
   (ícone `+`; seletores `[data-testid="icon-compose"]`, `[title="Nova conversa"]`,
   `[aria-label*="nova conversa" i]`, `[data-testid="chat-list-header"] [role="button"]`,
   `span[data-icon="plus"]`→closest button, `#pane-side [role="button"]`). Se não achar o
   botão, usa atalho nativo `Ctrl+Alt+N`.
   > Motivo da mudança: o Escape sozinho não fechava a conversa "Craft Studio Agência" e
   > as mensagens iam pro chat errado. Clicar em "Nova conversa" abre a tela de busca
   > sem chat ativo — estado garantido. Se o compose sumir, retorna.
2. Fallback: limpa texto da busca (com suporte a `<input>` via setter nativo).
3. Fallback: Escape ×3 + clique na sidebar.

### `detectarNumeroInvalido(iteracoes)` (linhas ~244-262)

Procura no header padrões de número não cadastrado ("não está disponível no whatsapp",
"enviar convite", "convidar", etc.), escopado ao header da conversa ativa.

### `clicarPrimeiroResultado()` (linhas ~266-285)

Após digitar o número na busca, espera até 10s um resultado aparecer
(`[data-testid="chat-list"] [role="listitem"]/[role="button"]`, `#pane-side ...`,
`[data-testid="cell-frame-container"]`) e clica. Retorna `true/false`.

### `tentarAbrirConversa(telefone)` (linhas ~291-348)

Uma tentativa de abrir a conversa pelo número:
1. `limparTudo()`. Só prossegue se a tela "Nova conversa" estiver confirmada —
   caso contrário `{ ok:false, erro:"tela-nova-conversa-nao-confirmada" }` (transitório).
   O compose residual de conversa anterior (oculto no DOM) NÃO bloqueia; o que
   importa é estar na tela de busca que aceita número novo.
2. Captura `header` antes da busca (`textoHeaderAntes`).
3. Clica na busca, `digitar(telefone)`, aguarda `1200–2000ms` (filtragem do WhatsApp).
4. `clicarPrimeiroResultado()` (fallback Enter).
5. Aguarda compose até 12s. Se não vier: `detectarNumeroInvalido()` → `numero-invalido`
   (definitivo) ou `compose-nao-encontrado` (transitório).
6. Valida que o header **mudou** desde antes (se igual e havia conversa aberta antes →
   `conversa-errada`, transitório). Detecta também número inválido pós-abertura (~1s).

### `sendOne({telefone, mensagem, simulacao})` (linhas ~350-410)

- Espera `#app`; `nao-logado` se tela de login.
- **Loop de retry** (até `MAX_TENTATIVAS_NAV = 5`): chama `tentarAbrirConversa`.
  Para em `ok` ou `numero-invalido`; transitórios re-tentam com `1200–2700ms` de espera.
- Sucesso → digita a mensagem (simulação char a char OU `textContent` + evento se `simulacao:false`).
- Clica em enviar (`send`), aguarda até 6s.
- **Confirmação** (até 9s): compose esvaziou OU a mensagem apareceu no `panelMensagens`.
- `limparTudo()` ao final; `sem-confirmacao` se não confirmou.

### Listener e timeout (linhas ~412-453)

- `PING` / `STATUS` respondem síncronos.
- `SEND_ONE` respeita o lock `ocupado` (responde `ocupado` se já rodando); timeout
  proporcional `60000 + mensagem.length*150`, capped em `TIMEOUT_GERAL_SEND_ONE` (3 min).
- `comTimeout(promise, ms, erro)` resolve `{ ok:false, erro:"timeout-geral" }` se estourar.

## Painel (painel.js) — resumo

> ⚠️ Seções abaixo refletem o estado ANTES da mudança de 2026-08-13 (ver nota no topo).
> Hoje o painel: importa CSV de lista pronta (nome/telefone/empresa/mensagem_N), valida
> (sem telefone ou sem mensagem → `ignorado`), envia via `SEND_SEQ` **exatamente** o
> conteúdo do CSV (sem `{NOME}`, sem reescrita), status `pendente/enviando/enviado/erro/ignorado`,
> intervalo entre mensagens (`cfgMsgIntervaloMin/Max`) e entre leads (`cfgIntervaloMin/Max`),
> mantendo toda a camada anti-ban.

- Persistência em `chrome.storage.local`. Chaves em `protocolo.js` (`AC_STORAGE`).
- Perfis anti-ban: conservador/moderado/livre (`PERFIS`), com intervalos, limites
  diário/semanal, pausas. `CONFIG_PADRAO` funde com o salvo.
- CSV: `parseCSV` (aspas/BOM), `detectarColunas`, `formatarTelefone` (adiciona `55`
  para nº local; normaliza), deduplica por telefone.
- Tabela: colunas Nome, Empresa, Telefone, Mensagens (`msgs-multi`), Status (badge),
  Ação. Botões: Abrir manual (modal), Marcar enviada, Número não encontrado.
- Backup/restore JSON (mescla por telefone, sanitiza para evitar XSS).
- **Disparo** (`iniciarDisparo` → `processarFila`): testa conexão, monta fila (retoma
  fila pausada se `STATS` tiver fila), embaralha opcional, e no loop:
  - `checarLimites` (diário com aquecimento `tetoDiarioEfetivo` / semanal);
  - `aguardarJanelaValida` (janela 9h–18h, pausa almoço);
  - `aguardarComControle` para pausas manuais/automáticas;
  - `chrome.tabs.sendMessage(tabId, SEND_SEQ)` com `mensagens[]` + `intervaloEntreMsgs`;
  - sucesso: incrementa daily/weekly **por mensagem enviada**, status `enviado`, log `✓`,
    pausas automáticas (`pausaAuto` a cada N, 8% chance pausa curta);
  - `numero-invalido`/`nao-logado` → `erro` (+ `naoEncontrado`); demais erros → `erro`;
    `persistirEstado()` (uma transação de storage por envio, crash-safe).
- `estado` em memória com `cache` (config/daily/weekly/teto); `salvarStats` persiste
  fila p/ retomada. Guard `iniciando` contra duplo clique.

## Estado do trabalho atual (não commitado)

`git status`:
- `extension/content-whatsapp.js` — modificado (retry de navegação + clique em "Nova conversa" + suporte `<input>` + validação de conversa certa).
- `extension/painel.js` — modificado (log específico para erro `conversa-errada`).

### Problema sendo resolvido

**Sintoma:** mensagens iam parar na conversa errada ("Craft Studio Agência"), com texto
aleatório (restos de busca digitados no compose errado) e mensagens legítimas no chat
errado. O código digitava a busca e dava Enter, mas não validava se a conversa certa
abriu; se a conversa anterior não fechasse, o texto ia pro chat visível.

**Correções aplicadas (em `content-whatsapp.js`):**
1. `limparTudo()` agora usa o botão **"Nova conversa"** (não só Escape) para resetar o estado.
2. `digitar()` suporta `<input>` (tela "Nova conversa") com setter nativo para React.
3. Seletor `compose` restrito para não casar com a busca.
4. Seletores de `searchInput` ampliados (`input[data-testid="search"]`, `input[type="text"]`).
5. `sendOne` refatorado com retry (até 5 tentativas) via `tentarAbrirConversa`.
6. Validação de header (antes/depois) → erro `conversa-errada` se a busca não navegou.
7. Novo tratamento no painel: `✗ Nome — conversa não abriu pelo número (busca falhou)`.
8. Timeout geral subiu para 3 min (5 tentativas × ~20s + folga).

### Status de teste

- Botão "Nova conversa": **clique confirmado funcionando** (usuário viu a tela abrir).
- Pendente: confirmar a parte de **digitar o número na busca + clicar no resultado**
  para abrir o chat certo, digitar a mensagem e enviar.
- Falta validar no WhatsApp real que o resultado da busca é o do número pesquisado
  (validação de header é uma heurística; pode precisar de checagem do próprio número
  no header).

### Última sessão (2026-08-13, tarde) — clique no resultado travado

**Sintoma relatado pelo usuário:** o robô digita o número, o resultado aparece na
busca, mas **fica travado** (sessão "Não mostra erro / fica travado"). Manualmente o
clique no resultado abre a conversa **normal**. Claude resolveu os problemas anteriores;
este ficou: o clique sintético (`el.click()`) no resultado não dispara a navegação do
WhatsApp React, então o compose nunca aparece — e como cada tentativa espera 12s, dava
impressão de travamento (em vez de erro).

**Correções aplicadas em `content-whatsapp.js`:**
1. `clicarDeVerdade(el)` (novo): rola o item até a view, sobe pro contêiner
   `div[role="button"]` e dispara a sequência **mousedown → mouseup → click** (2x) +
   `.click()`. Só esse caminho abre a conversa no WhatsApp Web atual.
2. `clicarPrimeiroResultado(telefone, busca)` reescrito: depois de clicar, **confirma a
   navegação** aguardando o compose (6s), e só se não abriu, tenta **Enter na busca**
   (4s) — comportamento de teclado garantido do WhatsApp. Retorna `true` só se a
   composição abriu de verdade.
3. Chamador em `tentarAbrirConversa` atualizado: passa a `busca`; o fallback de Enter
   passou a ser interno (removido o duplicado).
4. `acharResultadoPorNumero` agora ignora o **campo de busca e seus ancestrais** —
   evita casar com os próprios dígitos digitados e clicar no input (navegação falha).
5. `SELETORES_RESULTADO` prioriza `div[role="button"]` dentro de `[data-testid="chat-list"]`.

**Status pós-correção:** ✅ **TESTE REAL PASSADO** — o usuário confirmou que o clique no
resultado abriu a conversa e o fluxo resolveu. Próximos passos possíveis: o objetivo
"adicionar número sem mandar mensagem" (`OPEN_ONE`) e revisão das mudanças não
commitadas.

### Última sessão (2026-08-13, noite) — botão de emergência / Parar não interrompe o envio em andamento

**Sintoma:** ao clicar em **Parar** ou **EMERGÊNCIA**, o painel parava o loop, mas a
mensagem **já em andamento dentro do WhatsApp** continuava (digita e envia mesmo após o
stop) — porque o painel só sinalizava `estado.parado` pra si mesmo; o content script
terminava o `sendOne` até o fim.

**Solução (sinal de aborto entre painel ↔ content script):**
1. `protocolo.js`: nova mensagem `ABORT` em `AC_MSG`.
2. `content-whatsapp.js`:
   - flag `abortado` (reseta no início de cada `sendOne`);
   - handler `AC_MSG.ABORT` → seta `abortado = true` (resposta imediata);
   - `aguardar()` agora corta na hora se `abortado` (em vez de esperar o timeout todo);
   - checagens de aborto em `sendOne`: após cada tentativa de navegação, antes de
     digitar, **antes de clicar em enviar** (ponto crítico) e na confirmação;
   - `digitar(..., comAborto)` para a digitação no meio se abortado.
   - Abortado → responde `{ ok:false, erro:"abortado" }` em vez de continuar.
3. `painel.js`: `pararDisparo()` e `emergencia()` chamam `avisarAbortAoWhats()`, que
   envia `AC_MSG.ABORT` pra aba do WhatsApp; loga `⏹ <nome> — envio abortado pelo usuário`.

**Status:** sintaxe validada. **Pendente teste real:** disparar, clicar EMERGÊNCIA no meio
da digitação e conferir que a mensagem NÃO é enviada e o log marca `abortado`.

### Última sessão (2026-08-13, noite) — travar no número atual "fechando e abrindo" a Nova conversa

**Sintoma:** depois da correção do clique (que funcionou), em alguns números o robô
ficava preso **alternando a tela "Nova conversa" abrindo/fechando** eternamente, sem
progredir. Não era o sinal de aborto; era instabilidade de estado.

**Causa raiz:** o seletor `compose` cru casava com o compose de uma conversa anterior
que permanecia **oculto no DOM** quando a tela "Nova conversa" abria. Com isso:
- `limparTudo()` achava que ainda havia conversa aberta, então clicava no botão "+" de
  novo — que é um **toggle**: com a tela já aberta, o clique a FECHA;
- `estaNaTelaNovaConversa()` falhava ao detectar a tela (placeholder muda ao digitar),
  e o retry re-clicava — abrindo de novo. Resultado: loop abrir/fechar no mesmo número.

**Correções aplicadas em `content-whatsapp.js`:**
1. `estaVisivel(el)` (novo): valida posição/box de um elemento (offsetParent + rect).
2. `primeiroComposeVisivel()` (novo): busca o compose só entre elementos **visíveis**;
   usa em todos os pontos de decisão (`limparTudo`, guards, esperas de navegação,
   confirmação de envio) no lugar de `primeiro(SELETORES.compose)`.
3. `estaNaTelaNovaConversa()` reforçado: título do header **dentro** da lista/pane
   ("nova conversa|novo chat|new chat"), fallback de qualquer `<header>` da página com
   esse título exato, além de placeholder ("número/username") e item "Novo grupo".
4. `limparTudo()`: após clicar no "+", se a tela não confirmar (o clique fechou em vez
   de abrir), **re-clica na hora** pra reabrir — eliminando a alternância entre retries.

**Status:** sintaxe validada. **Pendente teste real:** disparo com vários números para
confirmar que não há mais loop abrir/fechar e o fluxo avança.

## Sessão — travamento no 2º disparo ("conversa-nao-fechada")

**Sintoma relatado:** a 1ª mensagem envia normalmente, mas o 2º disparo (outro número)
fica travado com erro `conversa-nao-fechada`; o WhatsApp Web permanece na conversa
aberta após o 1º envio.

**Causa raiz:** o guard em `tentarAbrirConversa` exigia `!primeiroComposeVisivel()`
para considerar o estado "pronto" — mas o compose da conversa anterior pode permanecer
no DOM (oculto) depois que a tela "Nova conversa" abre. Quando isso acontecia, o guard
falhava mesmo estando na tela certa, e o retry ficava travado.

**Correções aplicadas em `content-whatsapp.js`:**
1. `limparTudo()`: condição de pronto agora é **apenas** `estaNaTelaNovaConversa()`
   (sem exigir `!primeiroComposeVisivel()`); removido o re-clique duplicado e o fallback
   `#pane-side [role="button"]` que podia clicar no chat errado.
2. `estaNaTelaNovaConversa()`: placeholder da busca virou o sinal mais forte e é checado
   primeiro (é o que só existe na tela "Nova conversa"); "Novo grupo", header da pane e
   fallback de `<header>` exato seguem como sinais secundários.
3. `tentarAbrirConversa()`: removido o erro `conversa-nao-fechada`; agora só verifica
   `estaNaTelaNovaConversa()` (→ `tela-nova-conversa-nao-confirmada`, transitório).

**Status:** validado em teste real pelo usuário — disparos seguidos avançam sem travar.

## Sessão — auditoria de segurança e melhorias (aplicadas)

Re-auditoria de código sênior (MV3) e melhorias aplicadas:

**Correções urgentes**
1. `comTimeout()` (content-whatsapp.js): adicionado 2º `then` para rejeições → resolve
   `{ok:false, erro}` em vez de deixar o disparo pendurado pra sempre (o painel ficava
   travado sem resposta).
2. XSS por atributo (painel.js): `escaparHtml` agora escapa `"`/`'`; `urlSegura` retorna
   o URL normalizado (`u.href`) e o Instagram é validado com `urlSegura` antes de renderizar.
3. `abrirPainel` (background.js): busca a aba do painel iterando `tabs` e prefixando por
   `chrome.runtime.getURL(...)` (filtro `url` de `tabs.query` não casa `chrome-extension://`
   com segurança).
4. `processarFila` (painel.js): loop envolvido em `try/finally` — `estado` sempre resetado
   e botões re-renderizados mesmo com exceção.

**Melhorias redondas (segunda rodada)**
5. `ABORT` pós-clique-enviar (content-whatsapp.js): se o abort chegar logo após clicar em
   "enviar", confirma primeiro (compose vazio/painel) → `{ok:true}` se a msg saiu, senão
   `abortado` — evita reenvio duplicado tratado como erro genérico.
6. `estaNaTelaNovaConversa()` (content-whatsapp.js): removido `document.body.innerText`
   do body inteiro no polling de 200ms (jank) → escopo restrito à pane + nós curtos;
   `acharResultadoPorNumero` também restrito à pane (sem `|| document.body`).
7. Service worker (background.js): `painelTabId` persistido em `chrome.storage.session`
   (sobrevive ao SW adormecido — evita aba duplicada); PING revalidado após `executeScript`.
8. `sender.id === chrome.runtime.id` checado nos listeners de `onMessage` (background e
   content) — só responde à própria extensão.
9. `renderizarLog(logRef)` (painel.js): aceita o log em memória no loop de disparo — elimina
   re-leitura do storage a cada envio.
10. Debounce (400ms) na escrita do modelo; `lerCsv()` deduplica os handlers change/drop;
    PII (telefone) removida do `console.log`.

**Status:** sintaxe validada + paridade do pipeline OK. **Pendente teste real:** disparos
com abort no meio (EMERGÊNCIA logo após enviar) e duplo clique no ícone da extensão.

## Próximo objetivo do usuário

> **"Resolver lógica de adicionar número sem mandar mensagem"**

O usuário quer que o disparo, em vez de (ou além de) enviar a mensagem, **adicione o
número no WhatsApp / abra a conversa sem enviar mensagem** — ou seja, navegar até o
número (busca → resultado → chat aberto) e **parar aí** (sem digitar/enviar), para
validação manual ou para "adicionar o contato".

Ideias de implementação (a validar com o usuário):
- Novo `AC_MSG` (ex.: `ADD_ONE` / `OPEN_ONE`) no `protocolo.js` + `content-whatsapp.js`
  que reusa `tentarAbrirConversa` e **não** executa os passos 5–7 (digitar/enviar);
  retorna `{ ok:true }` assim que o compose estiver visível e a conversa for a certa.
- Possível novo botão no painel (ex.: "Abrir conversa" por lead, não apenas modal `wa.me`)
  e/ou flag no disparo ("só abrir, não enviar") para a fila marcar `aberto:true` sem contar
  envio nos limites diário/semanal.
- Revisar `limparTudo()` no final do `OPEN_ONE`: se o objetivo é deixar a conversa aberta
  para o usuário ver, **não** deve fechá-la (diferente do `SEND_ONE` que fecha ao final).

## Pontos de atenção / riscos

- Selectors do WhatsApp Web mudam com frequência; os atuais foram verificados no
  screenshot recente (não no DOM ao vivo — conferir via DevTools se necessário).
- A validação de "conversa certa" (header antes/depois) não garante que o chat é o do
  número; o ideal é checar o número no header ou usar o `data-testid` do contato.
- Envio duplicado: `sendOne` é idempotente por rodada (`enviados` + `STATS.fila`),
  mas se o `SEND_ONE` estourar timeout no meio do envio real, pode haver reenvio ao retomar.
- `simulacao:false` usa `textContent` + evento — mais rápido, menos "humano".

## 🔧 2026-08-14: número já enviado (registry global) + simplificação busca por data-testid

**Números já enviados (nunca reenviar):**
- `AC_STORAGE.ENVIADOS` readicionado em `protocolo.js` (removido na auditoria como "morto" — agora o usuário quer de volta).
- `painel.js`: `lerEnviados`/`registrarEnviado`/`resetarEnviados` (mapa `{ telefone: ISO }`, mantém data mais antiga).
- Registrado no envio bem-sucedido (`processarFila`) e em "Marcar enviada" (manual).
- **Import de CSV**: telefone no registry força `status: "enviado"` (precedência sobre lead antigo e sobre o statusBase) — cobre número salvo com NOME diferente no CSV.
- Backup agora exporta `{ versao:2, leads, enviados }` (import lê backup antigo = lista pura e o novo; mescla registry por união com data mais antiga; leads `enviado` do backup entram no registry).
- Botão "Resetar enviados" no painel: limpa registry e devolve leads `enviado` → `pendente`.

**Simplificação busca (regra do usuário: "apareceu qualquer coisa = é o número certo"):**
- `BUSCA_VAZIA` += `/nenhum resultado encontrado para/i` (título pt-BR do vazio).
- `telaComVazioVisivel()`: varre `#pane-side`/`chat-list` E (reforço) `h1,h2,h3,span,p` curtos e visíveis no documento.
- `temResultadoVisivel()`: agora só `[data-testid="cell-frame-container"]` (data-testid estável, não roles genéricos).
- `buscaSemResultados()`: vazio → true (número-invalido sem clicar); qualquer `cell-frame-container` visível → false (existe); fim 8s sem nada → true.
- `clicarPrimeiroResultado()`: fallback pro primeiro `cell-frame-container` visível (além de dígito/nome/resultado-novo). Rede de segurança 4c/4e/`detectarNumeroInvalido` mantida.

**Validação:** `node --check` OK nos 4 arquivos. **Pendente teste real:** reimportar `teste.csv` (3 números reais salvos com nome diferente devem abrir/Disparar, 2 fantasmas → `numero-invalido`), reenviar CSV após envio (números devem entrar `enviado`), reset enviados, backup export/import.

## 🔧 2026-08-14 (2º): timeout-geral em número salvo por nome e fantasma

**Sintoma:** Salvador Cell (real) enviou OK; Bahia Tech iPhones (real salvo por nome)
e Smart Salvador (fantasma) caíram em `timeout-geral` (estouro do `comTimeout`).

**Causa:** o fallback cego de "primeiro `cell-frame-container` visível" (adicionado na
simplificação) abria chats errados na tela "Nova conversa" — fixadas/recentes ficam
visíveis e eram clicadas. Com mensagens longas digitadas char-a-char + intervalos, o
envio passava do teto → `timeout-geral`.

**Correção:**
- `buscaSemResultados()` voltou a ser baseado em snapshot + `acharResultadoPorNumero`
  (dígito/nome) + `acharResultadoNovo` (item que surgiu após digitar) + novo
  `listaFiltrada()` (itens pré-existentes sumiram → o que restou é o contato). Vazio
  (`telaComVazioVisivel`, agora com varredura no documento todo) continua sendo o
  sinal DEFINITIVO de número inexistente, checado antes de tudo.
- `clicarPrimeiroResultado()` só usa `primeiroResultadoVisivel()` como fallback quando
  `listaFiltrada()` confirma que a busca filtrou a lista. Sem isso, não clica em nada
  (evita chat errado / envio travado).
- `node --check` OK. **Pendente teste real:** reimportar `teste.csv` e conferir que os
  3 reais (2 salvos por nome) disparam e os 2 fantasmas viram `numero-invalido` rápido.

## 🔧 2026-08-14 (3º): contato salvo por nome marcado como "número não encontrado"

**Sintoma:** com a lógica snapshot de volta, os números REAIS salvos no WhatsApp por
nome diferente do CSV caíram em `numero-invalido` (Bahia Tech, Salvador Cell), enquanto
o próprio número (Teste Loja Real, "message yourself") enviou OK.

**Causa:** o contato salvo mostra SÓ o nome na linha do resultado (sem dígitos) e, por
já ter sido aberto antes, é um chat recente — seu texto já está no snapshot. Então
`acharResultadoPorNumero` (não bate dígito/nome), `acharResultadoNovo` (item não é novo)
e `listaFiltrada` (lista não foi filtrada) todos falhavam, e ao fim dos 8s sem vazio o
`buscaSemResultados` retornava `true` (inexistente). O próprio número funcionou porque
a linha "message yourself" exibe o NÚMERO com dígitos (bate no `acharResultadoPorNumero`).

**Correção (regra do usuário: "apareceu qualquer coisa = é o número certo"):**
- `buscaSemResultados()`: o vazio ("Nenhum resultado encontrado para 'NÚMERO'") é o
  ÚNICO sinal definitivo de inexistência, checado antes de tudo. Se 8s passam SEM vazio
  → retorna `false` (existe) e deixa o clique + rede de segurança (4c/4e/
  `detectarNumeroInvalido`) validarem a conversa certa. Não retorna mais `true` só porque
  nenhum resultado "bateu" — a ausência de vazio já indica que o WhatsApp achou algo.
- `clicarPrimeiroResultado()`: novo fallback `buscaTemNumero()` — se o número digitado
  está no campo de busca, a lista visível é a de RESULTADOS (filtrada) → clica o primeiro
  item visível (o contato certo, mesmo salvo por nome diferente). Continua preferindo
  `acharResultadoPorNumero`/`acharResultadoNovo`/`listaFiltrada` antes desse fallback.
- `node --check` OK. **Pendente teste real:** reimportar `teste.csv` — os 3 reais (incl.
  2 salvos por nome, que já são chats recentes) devem disparar; os 2 fantasmas →
  `numero-invalido` rápido.

### 4ª correção — clique abria chat/grupo aleatório (fallback `buscaTemNumero` prematuro)

**Sintoma (teste 3, log 18:25–18:31):** Teste Loja Real (próprio número) enviou OK; os
2 reais salvos por nome diferente (Salvador Cell → `timeout-geral`, Bahia Tech iPhones →
`conversa-errada`) e o usuário relatou: "está abrindo no chat errado, enviando pra um grupo
aleatório"; só o próprio número (sem contato salvo) funcionou. Os fantasmas continuaram
certos (`numero-invalido`).

**Causa raiz:** o fallback `buscaTemNumero()` adicionado na 3ª correção é `true` **no
instante em que o número é digitado** no campo de busca (o texto já está lá), ANTES de o
WhatsApp filtrar a lista. O `aguardar()` do `clicarPrimeiroResultado` resolvia no 1º poll
com `primeiroResultadoVisivel()` → o primeiro `cell-frame-container` VISÍVEL ainda é um
chat fixado/recente (um grupo aleatório), não o resultado da busca. O próprio número
funcionava porque "message yourself" mostra dígitos → `acharResultadoPorNumero` batia.

**Correção:** removido o fallback `buscaTemNumero()` e a função morta. Agora só clica o
primeiro item visível quando `listaFiltrada()` confirma que a lista REALMENTE foi
filtrada (algum item do snapshot sumiu). "Número digitado na busca" não é mais sinal de
lista filtrada — é só que a digitação começou. Rede de segurança (4c/4e/
`detectarNumeroInvalido`) inalterada.
- `node --check content-whatsapp.js` OK. **Pendente teste real:** recarregar extensão e
  rodar `teste.csv` de novo — os reais salvos por nome devem abrir o chat certo e enviar.

## Comandos úteis

```bash
# Sintaxe dos arquivos principais
node --check extension/content-whatsapp.js
node --check extension/painel.js
node --check extension/background.js
node --check extension/protocolo.js
```
