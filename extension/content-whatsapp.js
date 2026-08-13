// content-whatsapp.js
// Roda dentro do web.whatsapp.com. Expõe uma API por mensagens:
//   ping     -> { ok, logado }
//   status   -> { ok, logado, selectors }
//   sendOne  -> { telefone, mensagem, simulacao } -> { ok } ou { ok:false, erro }
// Método "zero reload": usa a caixa de pesquisa pra abrir a conversa, digita a
// mensagem (simulando digitação humana) e clica em enviar. Nunca recarrega a página.

(() => {
  "use strict";

  const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
  const TIMEOUT_GERAL_SEND_ONE = 90000;

  const SELETORES = {
    login: [".landing-window", '[data-testid="qrcode"]'],
    searchInput: [
      'div[contenteditable="true"][data-tab="3"]',
      'div[data-testid="chat-list-search"] [contenteditable="true"]',
      'div[data-testid="chat-list-search"] input',
      '[role="textbox"][data-tab="3"]',
      'div[contenteditable="true"][data-tab="2"]',
    ],
    compose: [
      'div[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      'footer [contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
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
  async function digitar(el, texto) {
    posicionarCursorNoFim(el);
    el.focus();
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
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

  // Fecha a conversa atual e limpa a pesquisa, deixando tudo pronto pro próximo envio.
  async function limparTudo() {
    const busca = primeiro(SELETORES.searchInput);
    if (busca) {
      busca.focus();
      posicionarCursorNoFim(busca);
      try {
        const range = document.createRange();
        range.selectNodeContents(busca);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("delete", false, null);
      } catch (e) {
        /* ignore */
      }
      busca.dispatchEvent(novoEventoInput());
      await SLEEP(150 + Math.random() * 250);
      // Escape fecha a conversa e sai da pesquisa.
      pressionarTecla(busca, "Escape", "Escape", 27);
    }
    await SLEEP(250 + Math.random() * 350);
  }

  // Número não cadastrado no WhatsApp abre tela de "convidar" no header da conversa.
  async function detectarNumeroInvalido() {
    const padroes = [
      /não está disponível no whatsapp/i,
      /is not available on whatsapp/i,
      /enviar convite/i,
      /send an invite/i,
      /convidar/i,
    ];
    for (let i = 0; i < 20; i++) {
      const header = primeiro(SELETORES.header);
      // Escopo restrito ao header da conversa ativa pra evitar falsos positivos
      // vindos de outras conversas na lista.
      const texto = header ? header.innerText : "";
      if (padroes.some((p) => p.test(texto))) return true;
      await SLEEP(250);
    }
    return false;
  }

  async function sendOne({ telefone, mensagem, simulacao }) {
    await aguardar(() => q("#app"), 15000);
    if (!estalogado()) return { ok: false, erro: "nao-logado" };

    await limparTudo();

    // 1. Abrir a caixa de pesquisa.
    const busca = primeiro(SELETORES.searchInput);
    if (!busca) return { ok: false, erro: "busca-nao-encontrada" };
    busca.click();
    await SLEEP(300 + Math.random() * 400);

    // 2. Digitar o número (internacional).
    await digitar(busca, telefone);
    await SLEEP(600 + Math.random() * 800);

    // 3. Abrir a conversa.
    pressionarTecla(busca, "Enter", "Enter", 13);
    await SLEEP(800 + Math.random() * 700);

    // 4. Aguardar o campo de mensagem (compose box).
    const compose = await aguardar(() => primeiro(SELETORES.compose), 12000);
    if (!compose) {
      const invalido = await detectarNumeroInvalido();
      await limparTudo();
      if (invalido) return { ok: false, erro: "numero-invalido" };
      return { ok: false, erro: "compose-nao-encontrado" };
    }

    // 5. Digitar a mensagem.
    if (simulacao) {
      await digitar(compose, mensagem);
    } else {
      compose.textContent = mensagem;
      compose.dispatchEvent(novoEventoInput());
      await SLEEP(300 + Math.random() * 300);
    }

    // 6. Clicar em enviar.
    const enviar = await aguardar(() => primeiro(SELETORES.send), 6000);
    if (!enviar) {
      await limparTudo();
      return { ok: false, erro: "send-nao-encontrado" };
    }
    const alvo =
      enviar.tagName === "BUTTON" ? enviar : enviar.closest("button") || enviar;
    alvo.click();
    await SLEEP(700 + Math.random() * 600);

    // 7. Confirmar envio: compose box esvaziou OU a mensagem apareceu no chat.
    // (o fallback evita falso negativo quando o WhatsApp demora a limpar o campo)
    const trecho = mensagem.slice(0, 30).trim();
    const enviado = await aguardar(
      () => {
        const box = primeiro(SELETORES.compose);
        if (box && box.textContent.trim() === "") return true;
        const panel = primeiro(SELETORES.panelMensagens);
        if (panel && trecho && panel.innerText.includes(trecho)) return true;
        return null;
      },
      9000,
      300
    );

    await limparTudo();
    if (!enviado) return { ok: false, erro: "sem-confirmacao" };
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.action) return;
    if (msg.action === AC_MSG.PING) {
      sendResponse({ ok: true, logado: estalogado() });
      return;
    }
    if (msg.action === AC_MSG.STATUS) {
      sendResponse({ ok: true, logado: estalogado(), selectors: lerSelectors() });
      return;
    }
    if (msg.action === AC_MSG.SEND_ONE) {
      // Timeout global de segurança: se tudo travar, responde e não pendura o painel.
      comTimeout(sendOne(msg), TIMEOUT_GERAL_SEND_ONE, "timeout-geral")
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, erro: String(e) }));
      return true; // resposta assíncrona
    }
  });

  function comTimeout(promise, ms, erro) {
    return new Promise((resolve) => {
      let t = setTimeout(() => resolve({ ok: false, erro }), ms);
      promise.then((v) => {
        clearTimeout(t);
        resolve(v);
      });
    });
  }
})();
