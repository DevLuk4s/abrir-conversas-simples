# Abrir Conversas — Disparo de Mensagens via WhatsApp

Extensão Chrome (Manifest V3) de prospecção para WhatsApp Web que **envia mensagens já
prontas** de uma lista CSV. A extensão não cria, reescreve, resume, corrige ou personaliza
nenhuma mensagem — ela importa o conteúdo pronto e apenas executa o envio, na ordem do
arquivo, um lead por vez, com camada anti-ban.

**Versão:** 1.0.0 · **Idioma:** pt-BR

## Princípio

```
LISTA PRONTA → IMPORTAÇÃO → VALIDAÇÃO → FILA → ENVIO SEQUENCIAL → REGISTRO DO STATUS → PRÓXIMO LEAD
```

- As mensagens chegam prontas no CSV (colunas `mensagem_1`, `mensagem_2`, ...).
- A extensão envia **exatamente** o que está no CSV: sem corrigir português, trocar
  palavras, adicionar/remover emojis, adicionar saudação, juntar/dividir mensagens ou
  modificar o CTA. Célula vazia não é enviada e o fluxo segue para a próxima.
- Ordem por lead: abre a conversa → envia `mensagem_1` → aguarda intervalo →
  `mensagem_2` → aguarda novamente → `mensagem_3` → próximo lead.
- Não usa IA para geração. Nenhuma chamada de rede para modelos.

## Como funciona o envio (zero reload)

1. **Limpa tudo** — fecha qualquer conversa aberta e garante a tela **"Nova conversa"**
   (a única cuja busca aceita número novo; a busca da lista principal só filtra o que
   já existe). Fallback: atalho nativo Ctrl+Alt+N.
2. **Digita o número internacional** no campo de busca (simulando digitação humana).
3. **Vazio = não existe** — se a tela "Nenhum resultado encontrado para 'NÚMERO'"
   aparecer em até 8s, o lead é classificado como **número não encontrado** (cinza ✗).
   Regra do usuário: **vazio = não existe; qualquer resultado que aparecer = é o número
   certo.**
4. **Abre a conversa** — clica no resultado que bate com o número/nome do CSV (suporta
   contato salvo por nome diferente do CSV, inclusive com anotações entre parênteses como
   "Salvador Cell (Teste)"), ou no resultado novo que surgiu após a digitação; fallback
   de **Enter** na busca (comportamento nativo).
5. **Valida a conversa** — só envia se o header mudou desde antes da busca e, se o header
   mostrar um número de telefone, se ele for o do lead. Senão: `conversa-errada`.
6. **Envia a sequência** — digita a mensagem, clica em enviar e confirma (compose vazio
   OU última mensagem visível contém o trecho). Repete para as demais mensagens da célula,
   aguardando o intervalo entre mensagens. Fecha (limpa) ao final.

## "Número não encontrado" vs. erro

- **número não encontrado** (cinza ✗, nunca entra no registro de enviados): só quando a
  tela de vazio confirma que o número não está cadastrado (`numero-invalido`).
- **erro**: falha de navegação (`compose-nao-encontrado`, `tela-nova-conversa-nao-confirmada`),
  de envio (`sem-confirmacao`, `send-nao-encontrado`, `timeout-geral`, `abortado`) ou de
  comunicação — vira `erro` para **revisão manual** (não é prova de inexistência).

## Estrutura da lista (CSV)

Colunas aceitas (na ordem do CSV):

| nome | telefone | empresa | mensagem_1 | mensagem_2 | mensagem_3 |
|---|---|---|---|---|---|
| João | 5571999999999 | Loja Papua | Oii! Tava olhando a Loja Papua... | Pensei numa ideia... | Quer ver? |

- `mensagem_N` dinâmico: aceita `mensagem`, `mensagem_1`, `mensagem_2`, ... na ordem do CSV.
- Separação por `,` ou `;` (autodetectada); campos com quebras/aspas usam aspas duplas.
- **Encoding autodetectado**: UTF-8 estrito com fallback para ANSI/CP1252 (CSVs de
  Excel/planilhas brasileiras não quebram acentos).
- Telefone: só dígitos, remove `0` inicial e prefixa `55` se tiver 10–11 dígitos.
- Leads **sem telefone** ou **sem nenhuma mensagem** ficam com status `ignorado`.
- Status por lead: `pendente`, `enviando`, `enviado`, `erro`, `ignorado`. O campo
  `naoEncontrado` (bool) marca os leads com número não encontrado (status `erro` + cinza ✗).

## Anti-duplicação (registro global)

- Todo envio bem-sucedido grava o telefone no registro **ENVIADOS** (storage local),
  independente do CSV. Número já enviado em qualquer CSV anterior **nunca** volta para
  `pendente` — fica `enviado` (evita reenvio duplicado).
- `número não encontrado` **nunca** entra nesse registro.
- Leads presos em `enviando` (painel recarregado/atualização no meio do disparo) viram
  `erro` para revisão manual — **nunca** `pendente` (o content script pode ter enviado
  sem atualizar o registro).

## Camada anti-ban

- Perfis (Conservador/Moderado/Livre) com limites padrão diário/semanal.
- Aquecimento progressivo: número novo começa com poucos envios/dia e aumenta
  (8 + 3 por dia, até o limite).
- Janela de horário com pausa de almoço.
- Intervalos sorteados de forma humana (concentrados no meio), pausa automática a cada
  N envios e pausa curta imprevisível.
- Fila embaralhada, simulação de digitação opcional, botão de EMERGÊNCIA (aborta na hora).
- Se o WhatsApp devolver erro/desconexão/número inválido, o envio é registrado e o
  sistema para, informando o usuário — não tenta contornar bloqueios.

## Como usar

1. Instale a extensão (Chrome → `chrome://extensions` → modo desenvolvedor →
   "Carregar sem compactação" → pasta `extension/`).
2. Abra a extensão (ícone) — o painel abre em aba própria. Mantenha o WhatsApp Web
   aberto e logado numa aba.
3. Arraste o CSV (ou clique para escolher).
4. Ajuste as configurações de segurança (perfil, intervalos, janela, limites).
5. "Testar conexão WhatsApp" → "Disparar fila".

Intervalos configuráveis:
- **Entre mensagens da mesma conversa** (`msgIntervaloMin/Max`): tempo entre
  `mensagem_1`, `_2` e `_3` de um mesmo lead.
- **Entre leads** (`intervaloMin/Max`): tempo entre um contato e o próximo.

Controles durante o disparo: **Pausar / Retomar**, **Parar** e **EMERGÊNCIA**
(interrompe instantaneamente e aborta o envio em andamento). O painel também permite
"Marcar enviada", "Número não encontrado" e "Abrir manual" (via `wa.me`) por linha, além
de exportar/importar backup (JSON) e resetar o histórico de enviados.

## Estrutura

```
extension/
├── manifest.json            # MV3; permissions storage/scripting/unlimitedStorage; host web.whatsapp.com
├── background.js            # service worker: abre o painel (dedupe por storage.session), localiza/injeta o content script
├── protocolo.js             # constantes compartilhadas (AC_MSG e AC_STORAGE) + SLEEP
├── content-whatsapp.js      # roda dentro do WhatsApp Web: ping/status/sendSeq/abort
├── painel.html / painel.css / painel.js   # painel em aba própria (importa CSV + dispara)
├── SESSIONS.md              # documentação de estado/sessões e histórico de correções
└── icons/                   # ícones 16/32/48/128
```

## Mensagens entre os contextos (AC_MSG)

| Ação | Origem → Destino | Uso |
|---|---|---|
| `ping` | background → content | verifica injeção + login |
| `status` | painel → content | testa conexão e selectors |
| `sendSeq` | painel → content | envia a sequência de mensagens (com lock `ocupado`) |
| `abort` | painel → content | aborta o envio em andamento (Parar/EMERGÊNCIA) |
| `getWhatsAppTab` | painel → background | localiza/abre a aba do WhatsApp |

## Histórico de correções

Ver `extension/SESSIONS.md` para o detalhamento das sessões e correções aplicadas
(incluindo: match de contato salvo por nome com anotações no CSV, compose desanexado na
2ª mensagem, encoding do CSV, classificação de "não encontrado", lock de envio).