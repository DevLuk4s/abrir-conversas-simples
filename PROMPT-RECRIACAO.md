# PROMPT DE RECRIAÇÃO — "Abrir Conversas"

> Instrução para reconstruir, do zero, a extensão **"Abrir Conversas"** — uma extensão
> Chrome (Manifest V3) de prospecção automatizada no WhatsApp Web.
>
> **Como usar:** copie TODO o conteúdo deste arquivo e cole em qualquer IA de programação
> (ChatGPT, Claude, Gemini, etc.). A IA deve escrever todo o código a partir desta
> especificação. Não cole o código do projeto original como referência.

---

## 0. Instrução geral para a IA

Você vai reconstruir, do zero, uma extensão Chrome Manifest V3 chamada **"Abrir
Conversas"** — um painel de prospecção que dispara mensagens já prontas no WhatsApp Web.

Regras para o desenvolvimento:

1. **Idioma do código e da interface: pt-BR.**
2. **A extensão NUNCA cria, reescreve, resume, corrige, personaliza ou traduz mensagens.**
   Ela importa o conteúdo pronto de um CSV e envia EXATAMENTE o que está no arquivo, na
   ordem das colunas. Célula vazia não é enviada e o fluxo segue para a próxima.
3. **Não use IA/API de geração de mensagens.** Nenhuma chamada de rede para modelos.
4. Escreva código limpo, sem comentários desnecessários. Comente apenas o essencial
   (lógica não óbvia).
5. Entregue a estrutura de pastas abaixo com todos os arquivos completos.

---

## 1. Visão geral e princípio

Ferramenta de prospecção para WhatsApp Web que envia mensagens prontas de uma lista CSV:

```
LISTA PRONTA → IMPORTAÇÃO → VALIDAÇÃO → FILA → ENVIO SEQUENCIAL → REGISTRO DO STATUS → PRÓXIMO LEAD
```

- Ordem por lead: abre a conversa → envia `mensagem_1` → aguarda intervalo →
  `mensagem_2` → aguarda novamente → `mensagem_3` → próximo lead.
- Fluxo "zero reload": usa a caixa de pesquisa do WhatsApp Web para abrir a conversa,
  digita a mensagem (simulando digitação humana) e clica em enviar. Nunca recarrega a
  página.

---

## 2. Estrutura de arquivos

```
extension/
├── manifest.json
├── background.js            # service worker
├── protocolo.js             # constantes compartilhadas
├── content-whatsapp.js      # roda dentro do WhatsApp Web
├── painel.html / painel.css / painel.js   # painel em aba própria
└── icons/                   # ícones 16/32/48/128
```

---

## 3. Especificação por módulo

### 3.1 `manifest.json`

- `manifest_version: 3`
- `name`: "Abrir Conversas - Prospeccao WhatsApp"
- `version: "1.0.0"`
- `description` em pt-BR.
- `permissions`: `["storage", "scripting", "unlimitedStorage"]`
- `host_permissions`: `["https://web.whatsapp.com/*"]`
- `content_security_policy` de `extension_pages`: `script-src 'self'; object-src 'self'`
- `background`: `{ "service_worker": "background.js" }`
- `action`: com `default_title`
- `content_scripts`: um para `https://web.whatsapp.com/*`, com `js: ["protocolo.js",
  "content-whatsapp.js"]`, `run_at: "document_idle"`
- `icons`: 16/32/48/128

### 3.2 `protocolo.js` — constantes compartilhadas

Carregado ANTES dos demais scripts (mesmo escopo global), no service worker
(`importScripts`) e nos content scripts. Requisitos:

- **Idempotente**: se for carregado 2x (manifest + `executeScript`), não redeclara nada
  (use uma flag em `globalThis`, ex.: `globalThis.__acProtocolo`).
- Usa `globalThis` (não `window`) para funcionar também no service worker.
- Constantes `AC_MSG` (mensagens entre contextos):
  - `PING: "ping"`
  - `STATUS: "status"`
  - `SEND_SEQ: "sendSeq"`
  - `ABORT: "abort"`
  - `GET_WHATSAPP_TAB: "getWhatsAppTab"`
- Constantes `AC_STORAGE` (chaves do `chrome.storage.local`):
  - `LEADS`, `ENVIADOS`, `CONFIG`, `STATS`, `DAILY`, `WEEKLY`, `WARMUP`, `LOG`
- Helper global `SLEEP(ms)` = `new Promise(r => setTimeout(r, ms))`.

### 3.3 `background.js` — service worker

1. **Abrir o painel** (`chrome.action.onClicked` → `abrirPainel()`):
   - Abre `painel.html` em aba própria e FOCALIZA a aba.
   - **Dedupe de aba duplicada**: o `chrome.storage.session` sobrevive ao ciclo de vida do
     service worker (MV3 mata o SW quando ocioso). Use `painelTabId` para não abrir 2 abas.
   - **Proteção contra corrida de clique duplo**: flag `abrindoPainel` (timestamp) no
     `storage.session` cobre a janela entre criar a aba e gravar o id. Se um segundo clique
     chegar durante a criação, ESPERA ~2s (não 10s) e reusa a aba criada; se não resolver,
     cai no fluxo normal e abre de novo. Limpe a flag no `finally`.
   - Se a aba gravada foi fechada/inválida, remova o registro e abra nova.

2. **`getWhatsAppTab`** (responde a `AC_MSG.GET_WHATSAPP_TAB` do painel):
   - Consulta abas `https://web.whatsapp.com/*`.
   - Com mais de uma aba, escolhe a que responde `PING` com `ok` E `logado: true` —
     mandar mensagem pra aba errada (ex.: antiga deslogada) faria o envio ir pro lugar
     errado.
   - Se nenhuma responde: tenta **injetar** o content script (`garantirContentScript`) na
     primeira aba existente (cobre WhatsApp aberto antes da extensão ser carregada) e
     revalida com PING. Evita acumular abas órfãs.
   - Se ainda nada: cria aba nova `https://web.whatsapp.com/`, aguarda o DOM ficar
     `complete` (listener `tabs.onUpdated` com timeout) e injeta o content script.
   - Retorna `{ ok, tabId }` ou `{ ok: false, erro }`.

3. **`garantirContentScript(tabId)`**:
   - Envia `PING`; se responder `ok`, já está injetado.
   - Senão, `chrome.scripting.executeScript` com `["protocolo.js", "content-whatsapp.js"]`
     (a idempotência do content script evita duplo envio se já estiver lá).
   - Revalida com `PING`; se não responder, lança erro claro.

4. **Saneamento `onInstalled` (update)**:
   - Converte leads com `status === "enviando"` para `"erro"` (com `erroEm`). **NUNCA para
     `"pendente"`** — o content script pode ter enviado sem atualizar o registro;
     reenviar duplicaria a mensagem.
   - Zera `STATS` órfão: `{ fila: [], total: 0, enviados: 0, ativo: false }`.

5. **`onMessage`**: só responde mensagens com `sender.id === chrome.runtime.id`.

### 3.4 `content-whatsapp.js` — execução dentro do WhatsApp Web

Roda dentro do `web.whatsapp.com`. Expõe API por mensagens. Idempotente (flag
`globalThis.__acContentScript` — se injetado 2x, não registra listener duplicado, que
causaria envio duplicado).

**Fluxo principal `sendSeq({ telefone, nome, mensagens[], intervaloEntreMsgs, simulacao })`:**
abre a conversa certa UMA vez e envia as mensagens em sequência, aguardando
`intervaloEntreMsgs` ms entre cada uma. Ao final de TODAS as mensagens, limpa a tela.
Retorna `{ ok, enviadas }` (quantidade real enviada) ou `{ ok: false, erro, enviadas }`.

#### 3.4.1 Detecção e navegação (os pontos críticos)

**Selectors (lista atualizada do WhatsApp Web):**

- `login`: `.landing-window`, `[data-testid="qrcode"]` → se existe, NÃO está logado.
- `searchInput` (campo de busca): `div[contenteditable="true"][data-tab="3"]`,
  `div[data-testid="chat-list-search"] [contenteditable="true"]`,
  `div[data-testid="chat-list-search"] input`, `input[data-testid="search"]`,
  `input[type="text"]`, `[role="textbox"][data-tab="3"]`,
  `div[contenteditable="true"][data-tab="2"]`.
- `compose` (campo de mensagem): `div[data-testid="conversation-compose-box-input"]`,
  `div[contenteditable="true"][data-tab="10"]`, `footer div[contenteditable="true"]`,
  `div[role="textbox"][contenteditable="true"][data-tab="10"]`.
- `send`: `button[data-testid="send"]`, `span[data-icon="send"]`,
  `button[aria-label="Enviar"]`.
- `header`: `[data-testid="conversation-info-header"]`, `header`.
- `panelMensagens`: `[data-testid="conversation-panel-messages"]`, `#main`.

**Visibilidade (crítico):** os selectores crus podem casar com elementos de uma conversa
ANTERIOR que ficaram ocultos no DOM (`display:none`) quando a tela "Nova conversa" abriu.
Sempre checar visibilidade de verdade: `offsetParent !== null` E `getBoundingClientRect()`
com largura/altura > 0 e dentro da viewport. Implementar `estaVisivel(el)`,
`primeiroComposeVisivel()` e `headerConversaVisivel()` usando essa checagem. Comparar
resíduos ocultos causaria falso "conversa-errada" e mascararia número inválido.

**Tela "Nova conversa" (`estaNaTelaNovaConversa`):** é a ÚNICA tela cuja busca aceita
número novo (a busca da lista principal só filtra o que já existe). Reconhecer por:
1. placeholder do campo de busca com `/n[úu]mero|nomedeusu|@usu[áa]rio|username/i`
   (sinal mais forte);
2. presença do item "Novo grupo" (só existe nessa tela) — escopo restrito à pane lateral
   `[data-testid="chat-list"]`/`#pane-side`, sem ler o histórico inteiro;
3. header da lista "Nova conversa"/"New chat".

**`limparTudo()`:** fecha qualquer conversa aberta e garante estar na tela "Nova
conversa". Idempotente. Clica no botão "+"/"Nova conversa" (fallback: atalho nativo
Ctrl+Alt+N via `KeyboardEvent`). Se não confirmar, fallbacks antigos: limpar texto da
busca (setter nativo React + evento input) e pressionar Escape múltiplas vezes. Um compose
residual oculto de conversa anterior NÃO bloqueia — o placeholder da busca é o que conta.

**Digitação (`digitar`):** caractere por caractere, com delay variável (~25-75ms por
caractere, com pausas ocasionais maiores), como uma pessoa.
- Em `<input>` (tela "Nova conversa", controlado por React): usa o setter nativo de valor
  via `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set` + dispara
  `InputEvent("input", { bubbles:true, inputType:"insertText" })` para o React onChange
  registrar. Limpa o campo antes de digitar.
- Em `contenteditable` (compose): foca, posiciona cursor no fim (`document.createRange()`),
  e usa `document.execCommand("insertText", false, ch)` por caractere; fallback para
  `textContent += ch` + evento input se execCommand falhar.
- Checa sinal de aborto entre caracteres.

**`pressionarTecla(el, key, code, keyCode)`:** dispara keydown/keypress/keyup.

#### 3.4.2 Busca e decisão de "número não encontrado"

**Snapshot pré-digitação (`snapshotResultadosVisiveis`):** coleta os textos normalizados
dos itens visíveis (`[role="listitem"]`, `[role="button"]`,
`[data-testid="cell-frame-container"]`, texto curto ≤ 60 chars) da pane lateral ANTES de
digitar o número. Serve para distinguir "resultado que surgiu por causa da busca" de
"item que já estava lá" (fixadas/recentes).

**Match do resultado (`acharResultadoPorNumero(telefone, nome)`):**
- Alvo = últimos 8 dígitos do telefone. Um nó bate por dígitos se o texto dele tem ≥ 8
  dígitos terminando no alvo.
- **Match por nome**: normalizar o nome do CSV (minúsculo, sem acentos via NFD, sem
  pontuação) e — importante — **remover o conteúdo entre parênteses ANTES de tokenizar**
  (ex.: "Salvador Cell (Teste)" → tokens `["salvador","cell"]`). Um nó bate por nome se
  TODOS os tokens (≥ 2 chars) aparecem no texto normalizado do nó. Isso cobre contato
  salvo por nome DIFERENTE do CSV.
- Só nós VISÍVEIS; ignora o campo de busca e ancestrais. Retorna o item clicável
  (`closest('[role="listitem"], [role="button"], [data-testid="cell-frame-container"]')`).

**Resultado novo (`acharResultadoNovo(itensAntes)`):** primeiro item visível cujo texto
curto NÃO estava no snapshot — cobre o contato salvo por nome sem dígitos que não bate o
match por nome.

**Vazio = não existe (`buscaSemResultados`):** durante até 8s, se a tela de vazio
aparecer (regex `/nenhum resultado encontrado para|nenhum resultado|sem resultados|
nenhum contato ou grupo|no results?|no (chats?|contacts?|groups?) (found|matched|came up)|
nothing (here|found)/i`, na pane E em nós curtos visíveis do documento), retorna `true`
(inexistente). É o ÚNICO sinal definitivo. Se não aparecer vazio em 8s → o número existe
(deixa clique + rede de segurança validarem).

#### 3.4.3 Abrir a conversa (`clicarPrimeiroResultado`)

1. `clicarDeVerdade(el)`: scroll + sequência `mousedown → mouseup → click` + `el.click()`
   no contêiner `div[role="button"]` — o WhatsApp Web não navega com `el.click()` simples.
2. Confirma navegação: compose visível em até ~6s (fechando o aviso de criptografia se
   necessário).
3. Fallback: se nenhum resultado confiável foi encontrado, **Enter** na busca — o
   comportamento nativo da tela "Nova conversa" abre a conversa do número digitado,
   mesmo salvo por nome. `buscaSemResultados` já confirmou que o número existe.

**Aviso de criptografia (`fecharAvisoCriptografia`):** o WhatsApp mostra "Suas conversas e
ligações são privadas" cobrindo o chat na primeira conversa com número novo — sem fechar,
o compose nunca aparece. Clicar em botão `button`/`[role="button"]` com texto exato "OK".

#### 3.4.4 Rede de segurança ANTES de enviar (evita chat/grupo errado)

Após o compose abrir (aguardar até ~12s; checar criptografia a cada poll):
- **Header mudou (4c):** se havia conversa aberta antes e o header atual é IGUAL ao de
  antes da busca → não navegou → `conversa-errada` (não envia).
- **Número no header (4e):** se o header mostra um número de telefone (`\+?\d[\d\s()-]{7,}\d`)
  e NENHUM bate (últimos 8 dígitos) com o telefone do lead → `conversa-errada`.
  Inconclusivo (sem número visível) → segue.
- **Número inválido (`detectarNumeroInvalido`):** o aviso de número não cadastrado pode
  aparecer só no corpo (`#main`, texto limitado a ~3000 chars) e/ou no header; regex
  `/não está disponível no whatsapp|is not available on whatsapp|não (é|está) registrado|
  not registered|enviar convite|send an? invite|invite to whatsapp|convidar/i`. Também
  sinal independente de idioma: botão "Enviar convite"/"Invite" visível. Se detectado →
  `numero-invalido` (definitivo).

**Retry (`abrirConversaComRetry`):** até 5 tentativas. Persiste nas falhas transitórias
(`busca-nao-encontrada`, `conversa-errada`, `compose-nao-encontrado`,
`tela-nova-conversa-nao-confirmada`). Só para em `numero-invalido` (definitivo) ou
sucesso. Em `abortado`, limpa e retorna.

#### 3.4.5 Envio e confirmação (`enviarNoCompose`)

1. **Re-adquire o compose VISÍVEL a cada envio** (`primeiroComposeVisivel() || compose`):
   o WhatsApp React pode trocar/re-renderizar o nó do compose após cada envio — a
   referência capturada na abertura fica desanexada e digitar nela não chega ao campo
   real (a 2ª mensagem da sequência falhava: texto "digitava", botão nem habilitava).
   Este é um ponto CRÍTICO.
2. Digita a mensagem (simulação caractere a caractere OU inserção via `execCommand("insertText")`
   com fallback a `textContent` + evento input).
3. Clica em enviar (`button[data-testid="send"]` etc., preferindo `closest("button")`).
   **Se o botão de enviar estiver `disabled`** (React não registrou o texto), fallback:
   focar o box e pressionar **Enter** (o WhatsApp envia com Enter quando o campo tem foco
   e conteúdo).
4. **Confirmação** (até ~9s, polling a cada 300ms): o envio foi confirmado se o compose
   esvaziou OU a **última mensagem visível** no painel (`[data-testid*="msg-container"]`,
   `.message-in`, `.message-out`) contém o trecho inicial da mensagem (~30 chars). Ancorar
   na ÚLTIMA mensagem (não no histórico inteiro) evita falso positivo com mensagem
   repetida antiga.
5. Se abortado logo após clicar em enviar: tentar confirmar antes (a mensagem pode já ter
   saído — não tratar como erro genérico, evitaria reenvio duplicado no resume).

**Aborto (`ABORT`):** flag `abortado` checada em todas as esperas e entre caracteres.
`sendSeq` devolve `{ ok:false, erro:"abortado" }` quando interrompido.

#### 3.4.6 Lock de envio e timeout (evita travamento do painel)

- Flag `ocupado`: enquanto um `sendSeq` roda, outro recebe `{ ok:false, erro:"ocupado" }`.
- Timeout geral (`comTimeout`): teto = `max(900000, ms + 120000)` onde
  `ms = 60000 + (soma dos tamanhos das mensagens)*150 + intervaloEntreMsgs*(n-1)`
  (sequências com intervalos largos podem passar de 3 min; o teto acompanha a necessidade).
- **CRÍTICO:** ao estourar o timeout, marcar `abortado = true` (o sendSeq desiste nas
  checagens de aborto) e só liberar o lock quando a promise do sendSeq terminar. Use um
  `Promise.race` entre a promise real e um teto extra de ~10s para **garantir que o lock
  SEMPRE libere e o painel SEMPRE receba resposta** — sem isso, se a promise nunca
  assentar, o painel trava para sempre (sintoma "timeout-geral/travamento").

### 3.5 `painel.js` + `painel.html` + `painel.css` — o painel

#### 3.5.1 Tela (`painel.html`)

- Seção de dados: área de upload (clique ou arraste) para CSV; botões **Exportar backup**,
  **Importar backup**, **Limpar lista**, **Resetar enviados**; contador de status.
- Seção de disparo com o grid de configurações:
  - Perfil de segurança (Conservador/Moderado/Livre)
  - Intervalo entre envios entre leads (s): `intervaloMin`–`intervaloMax`
  - Intervalo entre mensagens da mesma conversa (s): `msgIntervaloMin`–`msgIntervaloMax`
  - Limite diário, Limite semanal, checkbox "Ignorar limites (testes)"
  - Janela de horário (início/fim) + checkbox "Ignorar janela (testes)"
  - Pausa de almoço (início/fim)
  - Pausa automática (a cada N envios, por X a Y min)
  - Checkboxes: Embaralhar fila, Simular digitação, Aquecimento progressivo
- Botões: **Testar conexão WhatsApp**, **Disparar fila**, **Pausar**, **Retomar**,
  **Parar**, **EMERGÊNCIA** (visíveis conforme o estado).
- Área de progresso, linha de stats (Hoje/Semana/Rodada), `<details>` de log.
- Tabela de leads (Nome, Empresa, Telefone, Mensagens, Status, Ação) e estado vazio.
- Modal `<dialog>` para abrir manualmente (via `wa.me`) com edição da mensagem.

#### 3.5.2 Perfis de segurança (padrões)

| Perfil | intervaloMin–Max (s) | limiteDiario | limiteSemanal | pausaCada | pausaMin–Max (min) | msgIntervaloMin–Max (s) |
|---|---|---|---|---|---|---|
| conservador | 45–120 | 20 | 120 | 6 | 4–8 | 60–180 |
| moderado | 30–75 | 40 | 250 | 10 | 5–10 | 45–120 |
| livre | 20–45 | 60 | 400 | 20 | 5–10 | 30–75 |

Config padrão (conservador): janela 09:00–18:00, pausa de almoço 12:00–13:30, pausa
automática ligada, embaralhar ligado, simular digitação ligado, aquecimento ligado,
ignorar limites desligado, ignorar janela desligado.

#### 3.5.3 Importação de CSV (pontos críticos)

- **Encoding autodetectado:** ler como `ArrayBuffer` e decodificar primeiro com
  `new TextDecoder("utf-8", { fatal: true })`; se lançar erro, decodificar com
  `windows-1252` (CSVs de Excel/planilhas brasileiras costumam vir em ANSI/CP1252 e
  quebrariam acentos como UTF-8 estrito).
- Remover BOM (`\uFEFF`).
- Parser próprio: autodetecta separador `,` ou `;` (comparar ocorrências na 1ª linha),
  suporta aspas duplas com escapes (`""`) e campos multilinha.
- **Detecção de colunas:** `nome`/`title`/`name`, `telefone`/`phone`/`phoneUnformatted`,
  `empresa`/`company`/`negocio`/`business`, e TODAS as colunas que casam
  `/^mensagem(?:_?\d+)?$/` (mensagem, mensagem_1, mensagem_2, ...) **na ordem do CSV**.
- Formatação de telefone: só dígitos; remove `0` inicial; prefixa `55` se tiver 10–11
  dígitos; mantém como está se já começar com `55`.
- Leads sem telefone ou sem nenhuma mensagem → status `ignorado` (fora do disparo).
- **Preservar estado em reimportação:** mapear por telefone; o registro global ENVIADOS
  tem precedência (número já enviado fica `enviado`, nunca volta a `pendente`); preservar
  `naoEncontrado`, `erroEm`, `enviadaEm` etc.

#### 3.5.4 Registro de enviados (anti-duplicação global)

- `ENVIADOS`: `{ telefone: "ISO" }` — data da primeira vez que o número foi enviado.
- `registrarEnviado(telefone)`: só grava se o telefone ainda não está (mantém a data mais
  antiga).
- **Número não encontrado NUNCA entra no registro** nem conta nos limites diário/semanal.
- `Resetar enviados`: zera o registro e volta leads `enviado` para `pendente` (com
  confirmação do usuário).

#### 3.5.5 Limites e aquecimento (camada anti-ban)

- Contadores diário (por data ISO `YYYY-MM-DD`) e semanal (segunda-feira como início da
  semana). Se a data guardada não é a atual, reinicia — inclusive NO MEIO da rodada
  (disparo noturno que cruza 00:00).
- **Aquecimento progressivo:** guarda `WARMUP.inicio` (ISO). Teto diário efetivo =
  `min(limiteDiario, 8 + (diasDesdeInicio) * 3)`, mínimo 1. (Dia 1: 8, dia 2: 11, ...)
- `checarLimites`: se `ignorarLimites` (modo testes), pula. Senão para a rodada se
  `daily.count >= tetoEfetivo` ou `weekly.count >= limiteSemanal`.
- **Intervalo humano:** sorteio concentrado no meio (soma de 3 uniformes) e clamp no
  [min, max].

#### 3.5.6 O loop de disparo (`processarFila`) — comportamento e persistência

- Snapshot local de `leads` (Map por id), log em memória, e **registro de enviados
  acumulado** em memória para evitar O(n²) de leitura/gravação a cada envio.
- **Persistência com debounce** (~400ms) agrupando LEADS+LOG+ENVIADOS+STATS+DAILY+WEEKLY
  numa única transação; **flush forçado por lead** (garante o status `enviado` persistido
  antes do próximo — se o painel morrer, o resume não reenvia) e **flush no `finally`**.
- Ao enviar com sucesso: incrementa `daily.count` e `weekly.count` pela quantidade REAL de
  mensagens enviadas, marca lead `enviado`, registra no ENVIADOS, loga `✓ nome (telefone)
  — N mensagem(ns) enviada(s)`.
- **Número não encontrado** (`erro === "numero-invalido"` — ÚNICO caso definitivo): marca
  `naoEncontrado: true` + `status: "erro"` + cinza ✗ na tabela. Loga `✗ nome — número não
  encontrado`. NÃO incrementa limites, NÃO entra no registro.
  - **IMPORTANTE:** `compose-nao-encontrado` e `tela-nova-conversa-nao-confirmada` são
    falhas de NAVEGAÇÃO, NÃO prova de inexistência → caem em erro normal (revisão manual),
    nunca cinza ✗.
- Qualquer outro erro: `marcarErro` (status `erro` + `erroEm`), sair do status
  `enviando` (senão o resume não pega o lead).
- `nao-logado` no meio: para a rodada e avisa.
- **"ocupado"** (content script finalizando envio anterior, ex.: painel recarregado):
  retry com backoff (até 5x, ~3s→11s) usando espera controlável (Parar/Pausar respondem
  na hora).
- **Aba do WhatsApp inacessível** (mensagem `Receiving end does not exist`/`Could not
  establish connection`): marca erro, loga, encerra a rodada.
- Pausa automática a cada N envios (minutos); pausa curta imprevisível (~8% de chance,
  1–3 min); intervalo humano entre leads SÓ depois de um envio REAL (número não
  encontrado/erro pula direto para o próximo).
- Controles: **Pausar/Retomar** (esperas reagem em ~1s), **Parar** (sinaliza e aborta o
  envio em andamento via `AC_MSG.ABORT`), **EMERGÊNCIA** (interrompe instantaneamente).

#### 3.5.7 Retomada de fila (STATS)

- `STATS` guarda `{ fila, total, enviados, ativo }`.
- Ao iniciar disparo: se há fila salva, filtra apenas os leads ainda `pendente` (exclui
  os que já foram enviados/erro) e retoma com `total` e `enviados` salvos. Senão, monta
  nova fila com os `pendente` (embaralhada se configurado).

#### 3.5.8 Saneamento no init do painel

- Leads em `enviando` (painel fechado/recarregado no meio do disparo) viram `erro` —
  **NUNCA** `pendente` (o content script pode ter enviado sem atualizar o registro).
- Bloqueia importação CSV/backup durante o disparo (o snapshot local sobrescreveria).

#### 3.5.9 Backup

- Exportar: JSON `{ versao: 2, leads, enviados }`.
- Importar: aceita lista antiga de leads OU `{ leads, enviados }`; sanitiza campos;
  mescla por telefone (união, mantém data mais antiga no registro; status "enviado" domina);
  leads importados com status `enviado` entram no registro.

#### 3.5.10 Log

- Entradas `{ t, txt, erro }`, teto de 80, mais recentes no topo.
- Re-renderiza só quando o `<details>` está aberto (o loop chama a cada lead; reconstruir
  o innerHTML todo era caro).

#### 3.5.11 Estilos (`painel.css`)

- Limpo, pt-BR, classes de status coloridas (pendente/enviando/enviado/erro/nao-encontrado/
  ignorado), linha não encontrada cinza com `text-decoration: line-through`, linha enviada
  azul, erro vermelho, sem telefone laranja. Botão EMERGÊNCIA piscando. Responsivo
  (tabela vira cards em telas estreitas). Mulheres de mensagens múltiplas com cores por
  índice. Use a paleta do WhatsApp (`#25D366`).

---

## 4. Armadilhas e lições aprendidas (NÃO reintroduzir)

Estes bugs reais já foram corrigidos no projeto original. A IA deve ter isso em mente:

1. **Nome do CSV com sufixo entre parênteses** (ex.: "Salvador Cell (Teste)") quebrava o
   match de um contato REAL salvo por nome ("Salvador Cell") porque o match exigia TODOS
   os tokens. → Remover conteúdo entre parênteses antes de tokenizar.
2. **Compose desanexado**: o React do WhatsApp troca/re-renderiza o nó do compose após
   cada envio; reutilizar a referência da abertura fazia a 2ª mensagem "digitar" num nó
   morto (botão nem habilita) e a sequência estourava `sem-confirmacao`. → Re-adquirir
   compose VISÍVEL a cada envio; botão desabilitado → fallback de Enter.
3. **Encoding ANSI/CP1252** no CSV quebrava acentos (ã → "Ã£") e o nome não batia mais.
   → UTF-8 estrito com fallback windows-1252.
4. **`compose-nao-encontrado`/`tela-nova-conversa-nao-confirmada` não são "número não
   encontrado"** — são falhas de navegação. Só o vazio na busca prova inexistência.
   Marcar real como cinza ✗ (fora do registro) é irreversível e errado.
5. **Lock de envio sem teto**: se a promise do sendSeq nunca assentasse, o lock `ocupado`
   nunca liberava e o painel travava para sempre. → `Promise.race` com teto extra.
6. **Nós ocultos no DOM** (compose/header de conversa anterior que ficam `display:none`
   atrás da tela "Nova conversa") eram confundidos com conversa aberta. → Sempre checar
   visibilidade real.
7. **Dedupe do painel**: flag global em memória se perde quando o SW dorme (MV3). →
   `chrome.storage.session`.
8. **Contato salvo por nome que já é chat recente**: a linha mostra só o nome (sem
   dígitos) e já estava no snapshot pré-digitação → nem match por número nem por nome nem
   "novo" disparam. → Fallback de **Enter** na busca (comportamento nativo).
9. **Clique que não navega**: o WhatsApp não navega com `el.click()` simples em item de
   busca. → Sequência `mousedown/mouseup/click` + `click()` no `role="button"`.
10. **Número fantasma abria outra conversa** (o WhatsApp às vezes "navega" para um chat
    diferente quando o número não existe). → Vazio na busca primeiro; rede de segurança
    de header; detecção de número inválido antes de enviar.

---

## 5. Critérios de aceite e plano de teste

Monte um CSV de teste (`teste.csv`) com:
- **3 contatos REAIS** (pode ser você/contatos próximos), incluindo um **salvo por nome
  com sufixo no CSV** (ex.: CSV "Salvador Cell (Teste)", WhatsApp "Salvador Cell"), cada
  um com **3 mensagens** (`mensagem_1`, `_2`, `_3`).
- **2 números FANTASMA** (numeração inexistente, ex.: "Conecta Express (Fantasma 1)",
  "Smart Salvador (Fantasma 2)").

Valide que:
1. Os 2 fantasmas caem em **"Número não encontrado" (cinza ✗)**; **não entram** no
   registro ENVIADOS nem contam no diário/semanal.
2. Os 3 reais enviam a **sequência completa de 3 mensagens**, abrindo o chat CERTO
   (inclusive o salvo por nome com sufixo entre parênteses).
3. Lead com erro de navegação aparece como `erro` (revisável), não como cinza ✗.
4. Parar/EMERGÊNCIA aborta na hora; Retomar continua da fila salva.
5. Re-importar o mesmo CSV não reenvia quem já consta no registro ENVIADOS.
6. `node --check` passa em todos os `.js`.