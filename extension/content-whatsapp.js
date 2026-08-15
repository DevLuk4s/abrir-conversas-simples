// content-whatsapp.js
// Roda dentro do web.whatsapp.com. Expõe uma API por mensagens:
//   ping     -> { ok, logado }
//   status   -> { ok, logado, selectors }
//   sendSeq  -> { telefone, nome, mensagens[], intervaloEntreMsgs, simulacao }
// Método "zero reload": usa a caixa de pesquisa pra abrir a conversa, digita a
// mensagem (simulando digitação humana) e clica em enviar. Nunca recarrega a página.

(() => {
  "use strict";

  // Idempotência: se este script for injetado 2x (manifest + executeScript),
  // evita listener duplicado (que causaria envio duplicado).
  if (globalThis.__acContentScript) return;
  globalThis.__acContentScript = true;

  const MAX_TENTATIVAS_NAV = 5;
  let ocupado = false;
  // Flag de aborto: o painel manda AC_MSG.ABORT pra interromper o envio atual
  // imediatamente (Parar / EMERGÊNCIA). Checada nas esperas e antes de enviar.
  let abortado = false;
  // Diagnóstico da ÚLTIMA navegação (só pra depurar conversa-errada): qual
  // matcher escolheu o resultado, que texto tinha e se o clique/Enter abriu.
  // Preenchido por clicarPrimeiroResultado e consumido no erro 4c/4e.
  let debugNav = null;
  const SELETORES = {
    login: [".landing-window", '[data-testid="qrcode"]'],
    searchInput: [
      'div[contenteditable="true"][data-tab="3"]',
      'div[data-testid="chat-list-search"] [contenteditable="true"]',
      'div[data-testid="chat-list-search"] input',
      'input[data-testid="search"]',
      'input[type="text"]',
      '[role="textbox"][data-tab="3"]',
      'div[contenteditable="true"][data-tab="2"]',
    ],
    compose: [
      'div[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"][data-tab="10"]',
    ],
    send: [
      'button[data-testid="send"]',
      'span[data-icon="send"]',
      'button[aria-label="Enviar"]',
    ],
    header: [
      '[data-testid="conversation-info-header"]',
      'header',
    ],
    panelMensagens: ['[data-testid="conversation-panel-messages"]', "#main"],
  };

  const q = (sel) => document.querySelector(sel);
  const primeiro = (arr) => {
    for (const s of arr || []) {
      const el = q(s);
      if (el) return el;
    }
    return null;
  };

  // Compose box VISÍVEL. O seletor cru pode casar com o compose de uma conversa
  // anterior que ficou oculto no DOM (display:none) quando a tela "Nova
  // conversa" abriu — se o código confundisse esse resíduo com conversa aberta,
  // clicaria no "+" de novo (fechando a tela) e alternaria pra sempre.
  function estaVisivel(el) {
    if (!el) return false;
    try {
      if (el.offsetParent === null) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    } catch (e) {
      return true;
    }
  }

  function primeiroComposeVisivel() {
    for (const s of SELETORES.compose) {
      const el = q(s);
      if (el && estaVisivel(el)) return el;
    }
    return null;
  }

  // Header da conversa ativa e VISÍVEL. O seletor cru pode devolver o header de
  // uma conversa anterior que permaneceu oculto no DOM depois que a tela "Nova
  // conversa" abriu — comparar esse resíduo antes/depois da busca causaria
  // falso "conversa-errada" (e mascararia o número inválido no detectar).
  function headerConversaVisivel() {
    for (const s of SELETORES.header) {
      const el = q(s);
      if (el && estaVisivel(el)) return el;
    }
    return null;
  }

  function lerSelectors() {
    const out = {};
    for (const k of ["searchInput", "compose", "send", "header"]) {
      out[k] = !!primeiro(SELETORES[k]);
    }
    out.logado = estalogado();
    return out;
  }

  function estalogado() {
    return !primeiro(SELETORES.login);
  }

  function aguardar(fn, timeout = 8000, intervalo = 250) {
    return new Promise((resolve) => {
      const ini = Date.now();
      const tick = () => {
        // Aborto (Parar/EMERGÊNCIA): corta a espera na hora em vez de
        // aguardar o timeout todo — o sendSeq vê abortado e desiste já.
        if (abortado) return resolve(null);
        let v = null;
        try {
          v = fn();
        } catch (e) {
          v = null;
        }
        if (v) return resolve(v);
        if (Date.now() - ini > timeout) return resolve(null);
        setTimeout(tick, intervalo);
      };
      tick();
    });
  }

  function novoEventoInput() {
    try {
      return new InputEvent("input", { bubbles: true, inputType: "insertText" });
    } catch (e) {
      return new Event("input", { bubbles: true });
    }
  }

  function posicionarCursorNoFim(el) {
    el.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      /* ignore */
    }
  }

  // Digita caractere por caractere, com delay variável, como uma pessoa.
  // Suporta contenteditable (WhatsApp clássico) e <input> (tela "Nova conversa").
  // Em <input> controlado por React, usa o setter nativo pra disparar onChange.
  async function digitar(el, texto, comAborto) {
    const ehInput = el.tagName === "INPUT";
    const inputSetter = ehInput
      ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      : null;
    if (ehInput) {
      el.focus();
      inputSetter.call(el, "");
      el.dispatchEvent(novoEventoInput());
      await SLEEP(100);
    } else {
      posicionarCursorNoFim(el);
      el.focus();
    }
    for (let i = 0; i < texto.length; i++) {
      if (comAborto && abortado) return;
      const ch = texto[i];
      if (ehInput) {
        inputSetter.call(el, el.value + ch);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }));
      } else {
        let ok = false;
        try {
          ok = document.execCommand("insertText", false, ch);
        } catch (e) {
          ok = false;
        }
        if (!ok) {
          el.textContent += ch;
          el.dispatchEvent(novoEventoInput());
        }
      }
      const base = 25 + Math.random() * 50;
      const pausa = Math.random() < 0.03 ? 250 + Math.random() * 450 : 0;
      await SLEEP(base + pausa);
    }
    await SLEEP(150 + Math.random() * 350);
  }

  function pressionarTecla(el, tecla, codigo, keyCode) {
    const opts = {
      key: tecla,
      code: codigo,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function apenasDigitos(txt) {
    return (txt || "").replace(/\D/g, "");
  }

  // Texto acessível de um elemento (aria-label, title, ou <title> de um SVG
  // interno) — mais estável que data-testid pra achar botões só por ícone.
  function textoAcessivel(elemento) {
    if (!elemento) return "";
    const tituloSvg = elemento.querySelector ? elemento.querySelector("title") : null;
    return [
      elemento.getAttribute && elemento.getAttribute("aria-label"),
      elemento.getAttribute && elemento.getAttribute("title"),
      tituloSvg ? tituloSvg.textContent : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function encontrarBotaoPorRotulo(regex) {
    const candidatos = document.querySelectorAll('[role="button"], button');
    for (const el of candidatos) {
      if (regex.test(textoAcessivel(el))) return el;
    }
    return null;
  }

  // Detecta se estamos na tela "Nova conversa" — a ÚNICA tela cuja busca
  // aceita número novo (a busca da lista principal, "Pesquisar ou começar
  // uma nova conversa", só filtra contatos/conversas que JÁ existem — por
  // isso números novos "não eram encontrados": a busca estava certa, a tela
  // é que estava errada). Reconhece por:
  //   1. placeholder do campo de busca ("pesquisar ... número ... @nomedeusuário");
  //   2. presença do item "Novo grupo", que só aparece nessa tela;
  //   3. título/header da lista de conversas ("Nova conversa").
  // O SINAL MAIS FORTE é o placeholder: ele só existe na tela "Nova conversa".
  function estaNaTelaNovaConversa() {
    const campos = document.querySelectorAll('input, [contenteditable="true"]');
    for (const c of campos) {
      const rotulo =
        c.getAttribute("placeholder") ||
        c.getAttribute("aria-placeholder") ||
        c.getAttribute("data-placeholder") ||
        "";
      if (/n[úu]mero|nomedeusu|@usu[áa]rio|username/i.test(rotulo)) return true;
    }

    // Escopo restrito à lista de conversas (a pane lateral) — evita ler o
    // innerText do body inteiro (histórico de mensagens enorme) a cada polling.
    const pane =
      document.querySelector('[data-testid="chat-list"]') ||
      document.querySelector("#pane-side");
    if (pane) {
      const hdr = pane.querySelector('[data-testid="chat-list-header"], header');
      if (hdr && /nova conversa|novo chat|new chat/i.test(hdr.innerText || "")) return true;
      if (/novo grupo/i.test((pane.textContent || "").slice(0, 3000))) return true;
    }
    // Fallback amplo: qualquer header da página cujo título seja "Nova conversa".
    const hdrs = document.querySelectorAll("header");
    for (const h of hdrs) {
      const t = (h.innerText || "").trim();
      if (/^(nova conversa|novo chat|new chat)$/i.test(t)) return true;
    }
    // Último recurso pro sinal "Novo grupo" (se nem a pane nem os headers
    // apareceram): varre nós curtos da lista — sem ler o histórico inteiro.
    const raiz =
      document.querySelector('[data-testid="chat-list"]') ||
      document.querySelector("#pane-side") ||
      null;
    if (raiz) {
      const nos = raiz.querySelectorAll("span, div");
      for (const no of nos) {
        const txt = (no.textContent || "").trim();
        if (txt.length === 0 || txt.length > 60) continue;
        if (/^novo grupo$/i.test(txt)) return true;
      }
    }
    return false;
  }

  // Deixa tudo pronto pra buscar um número novo: fecha qualquer conversa
  // aberta E garante que estamos na tela "Nova conversa" (clicando no botão
  // "+"/"Nova conversa" do topo, com fallback pro atalho Ctrl+Alt+N).
  // Idempotente: se já estiver na tela certa, não faz nada.
  // A condição de "pronto" é estar NA tela "Nova conversa" — o compose de uma
  // conversa anterior que permaneça oculto no DOM NÃO bloqueia (a busca dessa
  // tela aceita número novo mesmo assim).
  async function limparTudo() {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      if (estaNaTelaNovaConversa()) return;

      const novoChat =
        encontrarBotaoPorRotulo(/nova conversa|novo chat|new chat/i) ||
        document.querySelector('[data-testid="icon-compose"]') ||
        document.querySelector('[title="Nova conversa"]') ||
        document.querySelector('[aria-label*="nova conversa" i]') ||
        document.querySelector('[data-testid="chat-list-header"] [role="button"]') ||
        document.querySelector('span[data-icon="plus"]')?.closest('[role="button"]');

      if (novoChat) {
        novoChat.click();
      } else {
        // Atalho nativo Ctrl+Alt+N abre "Nova conversa" mesmo sem achar o botão.
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "n", code: "KeyN", ctrlKey: true, altKey: true, bubbles: true })
        );
      }
      await aguardar(() => (estaNaTelaNovaConversa() ? true : null), 1500, 200);
    }

    if (estaNaTelaNovaConversa()) return;

    // Fallbacks antigos: limpar texto de alguma busca visível + Escape múltiplo.
    const busca = primeiro(SELETORES.searchInput);
    if (busca) {
      busca.focus();
      if (busca.tagName === "INPUT") {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(busca, "");
        busca.dispatchEvent(novoEventoInput());
      } else {
        posicionarCursorNoFim(busca);
        try {
          const range = document.createRange();
          range.selectNodeContents(busca);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          if (!document.execCommand("delete", false, null)) busca.textContent = "";
        } catch (e) {
          /* ignore */
        }
        busca.dispatchEvent(novoEventoInput());
      }
      await SLEEP(150 + Math.random() * 250);
    }

    for (let tentativa = 0; tentativa < 3; tentativa++) {
      pressionarTecla(busca || document.body, "Escape", "Escape", 27);
      await SLEEP(300 + Math.random() * 200);
      if (!primeiroComposeVisivel()) break;
    }
    await SLEEP(200 + Math.random() * 200);
    if (primeiroComposeVisivel()) {
      const sidebar =
        document.querySelector('[data-testid="chat-list"]') ||
        document.querySelector("#pane-side") ||
        document.querySelector('[role="navigation"]');
      if (sidebar) {
        sidebar.click();
        await SLEEP(300 + Math.random() * 200);
      }
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        pressionarTecla(busca || document.body, "Escape", "Escape", 27);
        await SLEEP(300 + Math.random() * 200);
        if (!primeiroComposeVisivel()) break;
      }
    }
  }

  // Número não cadastrado no WhatsApp abre uma tela de "convidar". Em várias
  // versões do WhatsApp Web esse aviso NÃO aparece no header — aparece no
  // corpo principal (#main), às vezes junto com um compose/campo de texto
  // visível (só que sem botão de enviar de verdade, só "Enviar convite" via
  // SMS). Se checássemos só o header, esse caso passava como conversa válida
  // e o robô ficava "preso" tentando digitar/enviar numa tela que não envia
  // mensagem de WhatsApp nenhuma. Por isso: (1) escopo ampliado pro #main
  // além do header, e (2) sinal independente de idioma via o próprio botão
  // "Enviar convite"/"Invite", que não depende de bater o texto certo.
  async function detectarNumeroInvalido(iteracoes = 15) {
    const padroes = [
      /não está disponível no whatsapp/i,
      /is not available on whatsapp/i,
      /não (é|está) registrado no whatsapp/i,
      /not registered on whatsapp/i,
      /enviar convite/i,
      /send an? invite/i,
      /invite to whatsapp/i,
      /convidar/i,
    ];
    for (let i = 0; i < iteracoes; i++) {
      if (abortado) return false;
      const header = headerConversaVisivel();
      const textoHeader = header ? header.innerText : "";
      if (padroes.some((p) => p.test(textoHeader))) return true;

      // O aviso de número não cadastrado às vezes só aparece no corpo (#main).
      // Lê com texto limitado — forçar o innerText completo do histórico a cada
      // poll causaria reflow desnecessário (usamos textContent, que não reflowa).
      const main = document.querySelector("#main");
      const textoMain = main ? (main.textContent || "").slice(0, 3000) : "";
      if (padroes.some((p) => p.test(textoMain))) return true;

      // Sinal independente de idioma: o botão de convite existe e está visível.
      const btnConvite = encontrarBotaoPorRotulo(/enviar convite|send.*invite|invite to whatsapp/i);
      if (btnConvite && estaVisivel(btnConvite)) return true;

      await SLEEP(300);
    }
    return false;
  }

  // Mensagens de "busca sem resultados" do WhatsApp (pt/en) — usadas como
  // confirmação extra de que o número não está cadastrado.
  const BUSCA_VAZIA = [
    /nenhum resultado encontrado para/i,
    /nenhum resultado/i,
    /sem resultados/i,
    /nenhum contato ou grupo/i,
    /no results?( (found|for))?/i,
    /no (chats?|contacts?|groups?) (found|matched|came up)/i,
    /nothing (here|found)/i,
  ];

  // Tela mostrando "nenhum resultado" para a busca atual (número não
  // cadastrado). O WhatsApp Web pt-BR mostra um título "Nenhum resultado
  // encontrado para 'NÚMERO'" quando a busca não acha contato nenhum — sinal
  // DEFINITIVO de número inexistente. Varre a pane lateral E, como reforço,
  // elementos de texto curtos pelo documento (o título de vazio às vezes fica
  // fora da `#pane-side`).
  function telaComVazioVisivel() {
    const raiz =
      document.querySelector('div[data-testid="chat-list"]') ||
      document.querySelector("#pane-side");
    if (raiz && estaVisivel(raiz)) {
      const t = raiz.innerText || raiz.textContent || "";
      if (t && BUSCA_VAZIA.some((p) => p.test(t))) return true;
    }
    // Reforço: o título de vazio pode viver fora da pane. Só nós de texto
    // curtos (o título tem o número entre aspas, ~40 chars) e visíveis.
    const nos = document.querySelectorAll("h1, h2, h3, span, p");
    for (const no of nos) {
      if (!estaVisivel(no)) continue;
      const t = (no.textContent || "").trim();
      if (!t || t.length > 80) continue;
      if (BUSCA_VAZIA.some((p) => p.test(t))) return true;
    }
    return false;
  }

  // Snapshot do estado da lista ANTES de digitar o número: coleta os textos
  // normalizados dos itens visíveis (conversas fixadas/recentes que existem
  // na tela "Nova conversa"). Serve pra distinguir "resultado que apareceu
  // por causa da busca" de "item que já estava lá" — sem isso, um número
  // fantasma não poderia ser marcado como inexistente se houvesse conversas
  // fixadas/recentes na lista (elas seriam confundidas com "resultado").
  function snapshotResultadosVisiveis() {
    const raiz =
      document.querySelector('[data-testid="chat-list"]') ||
      document.querySelector("#pane-side");
    const set = new Set();
    if (!raiz) return set;
    const itens = raiz.querySelectorAll(
      '[role="listitem"], [role="button"], [data-testid="cell-frame-container"]'
    );
    for (const it of itens) {
      if (!estaVisivel(it)) continue;
      const t = (it.textContent || "").trim();
      if (t && t.length <= 120) set.add(t);
    }
    return set;
  }

  // Primeiro item de resultado VISÍVEL que surgiu DEPOIS de digitar o número
  // (não estava no snapshot pré-digitação). Cobre o contato salvo no WhatsApp
  // com nome diferente do CSV: a linha do resultado mostra o nome salvo (sem
  // dígitos), então `acharResultadoPorNumero` não bate — mas o item é "novo".
  function acharResultadoNovo(itensAntes) {
    const raiz =
      document.querySelector('[data-testid="chat-list"]') ||
      document.querySelector("#pane-side");
    if (!raiz || !itensAntes) return null;
    const itens = raiz.querySelectorAll(
      '[role="listitem"], [role="button"], [data-testid="cell-frame-container"]'
    );
    for (const it of itens) {
      if (!estaVisivel(it)) continue;
      const t = (it.textContent || "").trim();
      if (!t || t.length > 120) continue;
      if (itensAntes.has(t)) continue;
      return it;
    }
    return null;
  }

  // Checa se a busca assentou SEM resultado pra o número digitado. O sinal de
  // "não existe" é a tela de vazio ("Nenhum resultado encontrado para 'NÚMERO'")
  // — verificado ANTES de qualquer item visível, porque um item residual/fixado
  // da lista não pode ser tratado como "o número existe". É o ÚNICO sinal
  // definitivo de inexistência: se não aparecer vazio em 8s, o WhatsApp
  // encontrou algo pro número (contato salvo mostra só o nome, sem dígitos —
  // `acharResultadoPorNumero`/`acharResultadoNovo` são otimizações pra pegar a
  // linha certa, mas a ausência de vazio já basta pra existir).
  async function buscaSemResultados(telefone, nome, itensAntes) {
    const fim = Date.now() + 8000;
    while (Date.now() < fim) {
      if (telaComVazioVisivel()) return true;
      if (acharResultadoPorNumero(telefone, nome)) return false;
      if (acharResultadoNovo(itensAntes)) return false;
      await SLEEP(250);
    }
    if (telaComVazioVisivel()) return true;
    // 8s sem o vazio: o número existe. Deixa o clique + rede de segurança
    // (header 4c/4e + detectarNumeroInvalido) validarem a conversa certa.
    return false;
  }

  // Normaliza texto pra comparação de nome: minúsculo, sem acentos, sem pontuação.
  function normalizarNome(texto) {
    return (texto || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  // Acha o item da lista de resultados que contém o número buscado (bate os
  // últimos 8 dígitos do texto do nó com o telefone) OU o nome do contato
  // (contato salvo por nome mostra só o nome na linha) — mais confiável que
  // "clicar no primeiro item genérico", que às vezes pega um elemento que
  // não navega de verdade (ficando na tela padrão "nenhuma conversa aberta").
  // Só considera nós VISÍVEIS: conversas fixadas ocultas (do painel principal
  // atrás da tela "Nova conversa") não entram.
  // NOTA: ignora o próprio campo de busca e seus ancestrais, porque o número
  // digitado apareceria ali e o clique cairia no input (navegação falha).
  function acharResultadoPorNumero(telefone, nome) {
    const alvo = apenasDigitos(telefone).slice(-8);
    if (alvo.length < 8) return null;
    // O CSV pode ter anotações entre parênteses ("Salvador Cell (Teste)") que
    // NÃO existem no nome salvo no WhatsApp ("Salvador Cell"). Remover o
    // conteúdo entre parênteses antes de tokenizar evita que o token "teste"
    // quebre o match de um contato REAL salvo por nome.
    const nomeNorm = normalizarNome((nome || "").replace(/\([^)]*\)/g, " "));
    const tokensNome = nomeNorm.split(/\s+/).filter((t) => t.length >= 2);
    // Escopo restrito à lista de resultados (a pane lateral) — evita varrer o
    // documento inteiro (histórico de mensagens) a cada 300ms.
    const raiz =
      document.querySelector('[data-testid="chat-list"]') ||
      document.querySelector("#pane-side");
    if (!raiz) return null;
    const buscaEl = primeiro(SELETORES.searchInput);
    const nos = raiz.querySelectorAll("span, div");
    for (const no of nos) {
      if (!estaVisivel(no)) continue; // ignora conversas fixadas/compose ocultos
      const txt = no.textContent || "";
      if (!txt || txt.length > 40) continue; // ignora nós grandes (o painel inteiro etc.)
      const d = apenasDigitos(txt);
      const bateDigito = d.length >= 8 && d.endsWith(alvo);
      const bateNome =
        tokensNome.length > 0 &&
        tokensNome.every((tk) => normalizarNome(txt).includes(tk));
      if (bateDigito || bateNome) {
        if (buscaEl && (no === buscaEl || buscaEl.contains(no))) continue;
        return (
          no.closest('[role="listitem"], [role="button"], [data-testid="cell-frame-container"]') || no
        );
      }
    }
    return null;
  }

  // Clique "de verdade" num item da lista de busca. O WhatsApp Web não
  // navega com um simples el.click() sintético — precisa da sequência
  // completa (mousedown -> mouseup -> click) disparada no contêiner clicável
  // (role="button"), com foco e scroll antes. Sem isso o robô clica mas fica
  // travado na tela de busca, sem composição nem erro.
  async function clicarDeVerdade(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch (e) {
      /* ignore */
    }
    const clicavel = el.closest('div[role="button"]') || el;
    for (let i = 0; i < 2; i++) {
      const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
      clicavel.dispatchEvent(new MouseEvent("mousedown", opts));
      clicavel.dispatchEvent(new MouseEvent("mouseup", opts));
      clicavel.dispatchEvent(new MouseEvent("click", opts));
      clicavel.click();
      await SLEEP(120 + Math.random() * 180);
    }
  }

  // Abre a conversa pelo resultado da busca. Retorna true se a composição
  // abriu, false se não abriu (tela de busca ainda na frente).
  //
  // SEGURANÇA: `buscaSemResultados` já garantiu que o número existe (vazio não
  // apareceu em 8s — a sua regra: vazio = não existe; apareceu algo = é o
  // número certo). Preferência por clique num resultado que bate com o
  // número/nome do CSV (`acharResultadoPorNumero`) ou num resultado NOVO
  // (`acharResultadoNovo`). Se nenhum resultado confiável for encontrado (caso
  // do contato salvo por nome diferente do CSV que já é chat recente: a linha
  // mostra o nome salvo, sem dígitos, e o texto já estava no snapshot pré-
  // digitação — então NENHUM matcher dispara e `el` fica null), entra o
  // fallback de ENTER na busca: comportamento nativo da tela "Nova conversa"
  // que abre a conversa do número digitado, não importa se salvo por nome ou
  // não. O que NÃO pode ser usado como sinal é "o número está digitado na
  // busca": isso é verdade no instante em que se digita, ANTES de o WhatsApp
  // filtrar a lista. A rede de segurança (header 4c/4e +
  // `detectarNumeroInvalido`) continua valendo depois que a conversa abre,
  // então um clique/Enter errado não dispara mensagem.
  async function clicarPrimeiroResultado(telefone, nome, busca, itensAntes) {
    debugNav = { metodo: null, textoAlvo: null, abriu: false };
    const el = await aguardar(
      () => {
        const porNumero = acharResultadoPorNumero(telefone, nome);
        if (porNumero) {
          debugNav.metodo = "numero/nome";
          return porNumero;
        }
        const novo = acharResultadoNovo(itensAntes);
        if (novo) {
          debugNav.metodo = "resultado-novo";
          return novo;
        }
        return null;
      },
      8000,
      300
    );

    if (el) {
      debugNav.textoAlvo = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
      await clicarDeVerdade(el);

      // Confirma a navegação: compose visível (fechando o aviso de privacidade
      // se o WhatsApp cobrir o chat na 1ª conversa com o número).
      const abriu = await aguardar(() => {
        if (!primeiroComposeVisivel()) fecharAvisoCriptografia();
        return primeiroComposeVisivel();
      }, 6000, 300);
      if (abriu) {
        debugNav.abriu = true;
        return true;
      }
    }

    // Fallback: Enter na busca abre a conversa do número digitado —
    // comportamento nativo da tela "Nova conversa" (contato salvo por nome
    // diferente do CSV ou número novo). `buscaSemResultados` já confirmou que
    // o número existe (sem tela de vazio), então o Enter abre exatamente a
    // conversa daquele número. A rede de segurança 4c/4e valida o header
    // depois, então um Enter que caia no chat errado não dispara mensagem.
    if (busca && !telaComVazioVisivel()) {
      debugNav.metodo = "enter";
      pressionarTecla(busca, "Enter", "Enter", 13);
      const abriuEnter = await aguardar(() => {
        if (!primeiroComposeVisivel()) fecharAvisoCriptografia();
        return primeiroComposeVisivel();
      }, 8000, 300);
      if (abriuEnter) {
        debugNav.abriu = true;
        return true;
      }
    }
    return false;
  }

  // Fecha o aviso "Suas conversas e ligações são privadas" (criptografia),
  // que o WhatsApp mostra cobrindo o chat na primeira conversa com um número
  // novo — sem fechar, o compose nunca aparece. Procura um botão "OK" visível.
  function fecharAvisoCriptografia() {
    const candidatos = document.querySelectorAll('button, [role="button"]');
    for (const b of candidatos) {
      const texto = (b.innerText || b.textContent || "").trim();
      if (/^ok$/i.test(texto)) {
        b.click();
        return true;
      }
    }
    return false;
  }

  // Se o header da conversa aberta mostrar um número de telefone (contato
  // salvo exibe o número), confirma que é o do lead. Retorna true (bate),
  // false (header tem número e NÃO bate — conversa errada) ou null
  // (inconclusivo: sem número visível — contatos por nome não exibem).
  function validarNumeroNoHeader(telefone, textoHeader) {
    const alvo = apenasDigitos(telefone).slice(-8);
    if (alvo.length < 8) return null;
    const achados = (textoHeader || "").match(/\+?\d[\d\s()-]{7,}\d/g) || [];
    if (!achados.length) return null;
    for (const m of achados) {
      const d = apenasDigitos(m);
      if (d.length >= 8 && (d.endsWith(alvo) || alvo.endsWith(d.slice(-8)))) return true;
    }
    return false;
  }

  // Tentativa única de abrir a conversa pelo número. Retorna:
  //   { ok:true, compose }                          -> conversa certa aberta
  //   { ok:false, erro:"numero-invalido" }          -> definitivo, não tenta de novo
  //   { ok:false, erro:<transitório>, header }      -> pode ser tentado de novo
  async function tentarAbrirConversa(telefone, nome) {
    await limparTudo();
    // O estado correto pra buscar número novo É a tela "Nova conversa". Se
    // limparTudo confirmou ela, um compose residual de conversa anterior
    // (oculto no DOM) NÃO bloqueia — o placeholder da busca é o que importa.
    if (!estaNaTelaNovaConversa()) {
      // Sem a tela "Nova conversa" confirmada, a busca cairia no filtro da lista
      // principal (só existentes) — igual ao bug original. Falha transitória: o
      // retry chama limparTudo() de novo.
      return { ok: false, erro: "tela-nova-conversa-nao-confirmada" };
    }

    // Captura o header atual antes da busca (pra validar se a conversa mudou depois).
    const headerAntes = headerConversaVisivel();
    const textoHeaderAntes = headerAntes ? headerAntes.innerText.trim() : "";

    // 1. Abrir a caixa de pesquisa.
    const busca = primeiro(SELETORES.searchInput);
    if (!busca) return { ok: false, erro: "busca-nao-encontrada" };
    busca.click();
    await SLEEP(300 + Math.random() * 400);

    // 1b. Snapshot da lista ANTES de digitar: conversas fixadas/recentes que
    // já existem na tela "Nova conversa". Usado pra distinguir resultado
    // novo (do número digitado) de item pré-existente.
    const itensAntes = snapshotResultadosVisiveis();

    // 2. Digitar o número (internacional).
    await digitar(busca, telefone);
    // Delay maior: WhatsApp precisa de tempo pra filtrar a busca por número.
    await SLEEP(1200 + Math.random() * 800);

    // 2b. Se a busca assentou sem nenhum resultado, é sinal forte de número
    // inválido — retorna já como definitivo, sem gastar as 5 tentativas
    // completas (cada uma esperando até 12s pelo compose) nesse número.
    if (await buscaSemResultados(telefone, nome, itensAntes)) {
      await limparTudo();
      return { ok: false, erro: "numero-invalido" };
    }

    // 3. Abrir a conversa: clica no primeiro resultado da busca (com fallback
    // de Enter interno). Retorna true só se a composição realmente abriu.
    const abriu = await clicarPrimeiroResultado(telefone, nome, busca, itensAntes);
    if (!abriu) await SLEEP(1000 + Math.random() * 700);

    // 4. Aguardar o campo de mensagem (compose box). Se aparecer o aviso de
    // criptografia (comum na 1ª conversa com um número novo), fecha sozinho
    // clicando em "OK" a cada checagem, até o compose ficar visível.
    const compose = await aguardar(() => {
      if (!primeiroComposeVisivel()) fecharAvisoCriptografia();
      return primeiroComposeVisivel();
    }, 12000);
    if (!compose) {
      const invalido = await detectarNumeroInvalido();
      await limparTudo();
      if (invalido) return { ok: false, erro: "numero-invalido" };
      return { ok: false, erro: "compose-nao-encontrado" };
    }

    // 4c. Validar que a conversa aberta é diferente da que estava antes.
    // Se o header não mudou (e havia uma conversa aberta antes), a busca não
    // navegou — a mensagem iria pro chat errado.
    const headerDepois = headerConversaVisivel();
    const textoHeaderDepois = headerDepois ? headerDepois.innerText.trim() : "";
    if (textoHeaderAntes && textoHeaderDepois === textoHeaderAntes) {
      await limparTudo();
      console.debug("[AbrirConversas] conversa-errada (4c header não mudou)", {
        telefone, nome, textoHeaderAntes, textoHeaderDepois, debugNav,
      });
      return {
        ok: false,
        erro: "conversa-errada",
        motivo: "header-nao-mudou",
        headerAntes: textoHeaderAntes.slice(0, 80),
        headerDepois: textoHeaderDepois.slice(0, 80),
        nav: debugNav,
      };
    }
    // 4e. Se o header mostra um número de telefone que NÃO é o do lead,
    // abriu a conversa errada — não envia.
    const bateHeader = validarNumeroNoHeader(telefone, textoHeaderDepois);
    if (bateHeader === false) {
      await limparTudo();
      console.debug("[AbrirConversas] conversa-errada (4e número diferente no header)", {
        telefone, nome, textoHeaderDepois, debugNav,
      });
      return {
        ok: false,
        erro: "conversa-errada",
        motivo: "numero-diferente-no-header",
        headerDepois: textoHeaderDepois.slice(0, 80),
        nav: debugNav,
      };
    }
    // 4b. Algumas versões do WhatsApp mostram o compose mesmo na tela de convite
    // (número não cadastrado): checagem curta (~1s) pra evitar falso "enviada".
    if (await detectarNumeroInvalido(4)) {
      await limparTudo();
      return { ok: false, erro: "numero-invalido" };
    }

    return { ok: true, compose };
  }

  // Abre a conversa certa com retry (até MAX_TENTATIVAS_NAV), persistindo nas
  // falhas transitórias. Só para em erro definitivo (número inválido) ou
  // sucesso. Retorna { compose } | { erro, header } | { abortado:true }.
  async function abrirConversaComRetry(telefone, nome) {
    let navegou = null;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_NAV; tentativa++) {
      navegou = await tentarAbrirConversa(telefone, nome);
      if (abortado) {
        await limparTudo();
        return { abortado: true };
      }
      if (navegou.ok || navegou.erro === "numero-invalido") break;
      await SLEEP(1200 + Math.random() * 1500);
    }
    if (!navegou || !navegou.ok) {
      await limparTudo();
      if (abortado) return { abortado: true };
      if (navegou && navegou.erro === "numero-invalido") {
        return { erro: "numero-invalido" };
      }
      const ultimoErro = navegou && navegou.erro ? navegou.erro : "sem-resposta";
      return {
        erro: ultimoErro,
        motivo: navegou && navegou.motivo,
        headerAntes: navegou && navegou.headerAntes,
        headerDepois: navegou && navegou.headerDepois,
        nav: navegou && navegou.nav,
      };
    }
    return { compose: navegou.compose };
  }

  // Prelúdio comum de qualquer envio: limpa o sinal de aborto da rodada
  // anterior, aguarda o app e abre a conversa certa.
  async function iniciarConversa(telefone, nome) {
    abortado = false;
    await aguardar(() => q("#app"), 15000);
    if (!estalogado()) return { erro: "nao-logado" };
    return abrirConversaComRetry(telefone, nome);
  }

  // Última mensagem VISÍVEL no painel de mensagens. Tem fallback entre
  // `data-testid*="msg-container"` (WhatsApp atual) e as classes `.message-in`/
  // `.message-out` (estáveis há anos) — se o WhatsApp trocar o testid, a
  // confirmação de envio continua funcionando em vez de depender só do compose.
  function ultimaMensagemVisivel(panel) {
    if (!panel) return null;
    for (const sel of ['[data-testid*="msg-container"]', ".message-in", ".message-out"]) {
      const nos = panel.querySelectorAll(sel);
      if (nos.length) return nos[nos.length - 1];
    }
    return null;
  }

  // A mensagem foi ACEITA pelo servidor do WhatsApp? Procura o tique nativo
  // dentro da bolha, com fallback entre as variações que o WhatsApp já usou:
  // `data-icon`/`data-testid` (msg-check/msg-dblcheck/msg-dblcheck-ack/msg-sent)
  // nas versões antigas, e `aria-label` (" Enviada / Entregue / Lida ") ou o
  // `<title>` do SVG (wds-ic-sent/wds-ic-delivered/wds-ic-read) nas versões
  // atuais. Qualquer estado de tique basta: Enviada (✓) já garante envio ao
  // servidor — não precisa esperar Entregue/Lida.
  function mensagemComTique(bubble) {
    if (!bubble) return false;
    for (const sel of [
      '[data-icon*="msg-check"]',
      '[data-icon*="msg-dblcheck"]',
      '[data-icon="msg-sent"]',
      '[data-testid="msg-check"]',
      '[data-testid="msg-dblcheck"]',
      '[data-testid="msg-dblcheck-ack"]',
    ]) {
      if (bubble.querySelector(sel)) return true;
    }
    const nos = bubble.querySelectorAll("[aria-label], title");
    for (const no of nos) {
      const texto =
        (no.getAttribute && no.getAttribute("aria-label")) || no.textContent || "";
      if (/enviada|entregue|lida/i.test(texto)) return true;
      if (/sent|delivered|read/i.test(texto)) return true;
      if (/wds-ic-(sent|delivered|read)/i.test(texto)) return true;
    }
    return false;
  }

  // Digita a mensagem no compose box, clica em enviar e confirma o envio.
  // Não mexe no estado da conversa (não chama limparTudo) — o sendSeq chama
  // limparTudo ao final (depois de enviar todas as mensagens).
  async function enviarNoCompose(compose, mensagem, simulacao) {
    // O WhatsApp React pode trocar/re-renderizar o nó do compose após cada
    // envio — a referência capturada na abertura da conversa fica desanexada e
    // digitar nela não chega ao campo real (a 2ª mensagem da sequência falhava:
    // texto "digitava", botão de enviar nem habilitava). Re-adquire um compose
    // VISÍVEL a cada envio; usa o recebido só como fallback.
    const box = primeiroComposeVisivel() || compose;
    if (simulacao) {
      await digitar(box, mensagem, true);
    } else {
      // Insere via execCommand (mesmo mecanismo de input que o WhatsApp usa)
      // em vez de setar textContent direto — React pode ignorar a mutação e o
      // botão de enviar nem habilitaria. Fallback pro modo direto se falhar.
      posicionarCursorNoFim(box);
      let inseriu = false;
      try {
        inseriu = document.execCommand("insertText", false, mensagem);
      } catch (e) {
        inseriu = false;
      }
      if (!inseriu) {
        box.textContent = mensagem;
        box.dispatchEvent(novoEventoInput());
      }
      await SLEEP(300 + Math.random() * 300);
    }
    if (abortado) return { ok: false, erro: "abortado" };

    // Clicar em enviar.
    const enviar = await aguardar(() => primeiro(SELETORES.send), 6000);
    if (abortado) return { ok: false, erro: "abortado" };
    if (!enviar) return { ok: false, erro: "send-nao-encontrado" };
    if (enviar.disabled) {
      // Botão de enviar desabilitado = o React não registrou o texto (ex.:
      // compose re-renderizado no meio da sequência). Enter envia no WhatsApp
      // quando o campo tem foco e conteúdo — fallback pra não travar a rodada.
      box.focus();
      pressionarTecla(box, "Enter", "Enter", 13);
    } else {
      const alvo =
        enviar.tagName === "BUTTON" ? enviar : enviar.closest("button") || enviar;
      alvo.click();
    }
    await SLEEP(700 + Math.random() * 600);

    // Se o abort chegou logo após clicar em enviar, a mensagem pode já ter
    // saído — não trata como erro genérico (evita reenvio duplicado no resume).
    // Tenta confirmar primeiro; sem tique + trecho nem compose vazio, aborta.
    if (abortado) {
      const box = primeiroComposeVisivel();
      const panel = primeiro(SELETORES.panelMensagens);
      const trechoAbort = mensagem.slice(0, 30).trim();
      // Ancorado na ÚLTIMA mensagem visível (não no histórico inteiro):
      // evita falso positivo de "enviado" com mensagem repetida antiga.
      const ultimaAbort = ultimaMensagemVisivel(panel);
      const enviadoAbort =
        (box && box.textContent.trim() === "") ||
        (ultimaAbort &&
          trechoAbort &&
          ultimaAbort.textContent.includes(trechoAbort) &&
          mensagemComTique(ultimaAbort));
      if (enviadoAbort) return { ok: true };
      return { ok: false, erro: "abortado" };
    }

    // Confirmar envio: compose box esvaziou OU a ÚLTIMA mensagem visível no
    // chat é o trecho enviado COM o tique nativo (aceita pelo servidor). Não
    // usa o innerText do painel inteiro: uma mensagem repetida num histórico
    // antigo daria falso positivo de "enviado". O tique é o sinal forte — o
    // trecho sem tique (ex.: sincronização pausada) NÃO confirma.
    const trecho = mensagem.slice(0, 30).trim();
    const enviado = await aguardar(
      () => {
        const box = primeiroComposeVisivel();
        if (box && box.textContent.trim() === "") return true;
        const panel = primeiro(SELETORES.panelMensagens);
        if (panel && trecho) {
          const ultima = ultimaMensagemVisivel(panel);
          if (
            ultima &&
            ultima.textContent &&
            ultima.textContent.includes(trecho) &&
            mensagemComTique(ultima)
          )
            return true;
        }
        return null;
      },
      9000,
      300
    );
    if (!enviado) {
      if (abortado) return { ok: false, erro: "abortado" };
      return { ok: false, erro: "sem-confirmacao" };
    }
    return { ok: true };
  }

  // Abre a conversa uma única vez e envia as mensagens em sequência,
  // aguardando `intervaloEntreMsgs` ms entre cada uma. Célula vazia é pulada.
  // Fecha (limparTudo) apenas ao final de todas as mensagens.
  async function sendSeq({ telefone, nome, mensagens, intervaloEntreMsgs, simulacao }) {
    const lista = (mensagens || []).filter(
      (m) => typeof m === "string" && m.trim().length > 0
    );
    if (!lista.length) return { ok: false, erro: "sem-mensagens" };

    const aberta = await iniciarConversa(telefone, nome);
    if (aberta.abortado) return { ok: false, erro: "abortado" };
    if (aberta.erro)
      return {
        ok: false,
        erro: aberta.erro,
        motivo: aberta.motivo,
        headerAntes: aberta.headerAntes,
        headerDepois: aberta.headerDepois,
        nav: aberta.nav,
      };

    const compose = aberta.compose;
    const enviadas = [];
    for (let i = 0; i < lista.length; i++) {
      if (abortado) {
        await limparTudo();
        return { ok: false, erro: "abortado", enviadas };
      }
      const r = await enviarNoCompose(compose, lista[i], simulacao);
      if (r.ok) enviadas.push(i);
      else {
        await limparTudo();
        return { ok: false, erro: r.erro || "sem-resposta", enviadas };
      }

      // Intervalo entre mensagens da mesma conversa (checa aborto durante a espera).
      const proxima = lista[i + 1];
      if (proxima !== undefined && intervaloEntreMsgs > 0) {
        const fim = Date.now() + intervaloEntreMsgs;
        while (Date.now() < fim) {
          if (abortado) {
            await limparTudo();
            return { ok: false, erro: "abortado", enviadas };
          }
          await SLEEP(500);
        }
      }
    }

    await limparTudo();
    return { ok: true, enviadas: enviadas.length };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;
    // Só responde a mensagens da própria extensão (não a outros remetentes).
    if (sender && sender.id !== chrome.runtime.id) return;
    if (msg.action === AC_MSG.PING) {
      sendResponse({ ok: true, logado: estalogado() });
      return;
    }
    if (msg.action === AC_MSG.STATUS) {
      sendResponse({ ok: true, logado: estalogado(), selectors: lerSelectors() });
      return;
    }
    if (msg.action === AC_MSG.ABORT) {
      // Parar/EMERGÊNCIA: sinaliza o envio em andamento pra ele desistir
      // imediatamente (antes de clicar em enviar). Respondido na hora; a
      // resposta do SEND_SEQ pendente chegará com { ok:false, erro:"abortado" }.
      abortado = true;
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === AC_MSG.SEND_SEQ) {
      if (ocupado) {
        sendResponse({ ok: false, erro: "ocupado" });
        return;
      }
      ocupado = true;
      const fn = sendSeq({
        telefone: msg.telefone,
        nome: msg.nome,
        mensagens: msg.mensagens,
        intervaloEntreMsgs: msg.intervaloEntreMsgs || 0,
        simulacao: msg.simulacao,
      });
      const tamanho = (msg.mensagens || []).reduce((s, m) => s + (m ? m.length : 0), 0);
      const extra = msg.mensagens && msg.mensagens.length > 1
        ? msg.intervaloEntreMsgs * (msg.mensagens.length - 1)
        : 0;
      const ms = 60000 + tamanho * 150 + extra;
      // Sequência com intervalos largos entre mensagens pode passar de 3 min;
      // o teto acompanha a necessidade real (ms) com folga, em vez de um valor
      // fixo que cortaria a sequência no meio.
      const teto = Math.max(900000, ms + 120000);
      comTimeout(fn, teto, "timeout-geral")
        .then((r) => {
          // Timeout geral estourou enquanto o envio ainda rodava: aborta a
          // operação em andamento (o sendSeq desiste nas checagens de
          // aborto) e só libera o lock quando ela terminar — sem isso, o
          // próximo SEND_SEQ dispararia CONCORRENTE ao anterior. Um teto
          // extra de 10s garante que o lock SEMPRE libere e o painel SEMPRE
          // receba resposta, mesmo se a promise do sendSeq nunca assentar
          // (falha defensiva — o aborto já a faz resolver rapidamente).
          if (r && r.erro === "timeout-geral") abortado = true;
          const fim = Promise.race([
            Promise.resolve(fn).catch(() => {}),
            new Promise((res) => setTimeout(() => res(), 10000)),
          ]);
          fim.then(() => {
            ocupado = false;
            sendResponse(r);
          });
        })
        .catch((e) => {
          ocupado = false;
          sendResponse({ ok: false, erro: String(e) });
        });
      return true; // resposta assíncrona
    }
  });

  function comTimeout(promise, ms, erro) {
    return new Promise((resolve) => {
      let t = setTimeout(() => resolve({ ok: false, erro }), ms);
      promise.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          resolve({ ok: false, erro: String(e) });
        }
      );
    });
  }
})();
