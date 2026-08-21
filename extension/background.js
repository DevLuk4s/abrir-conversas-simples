// background.js - service worker
// Orquestra a abertura do painel e localiza/injeta o content script no WhatsApp Web.

importScripts("protocolo.js");

const PAINEL_URL = chrome.runtime.getURL("painel.html");

async function abrirPainel() {
  // chrome.storage.session sobrevive ao ciclo de vida do service worker (MV3
  // mata o SW quando ocioso): evita abrir aba duplicada do painel.
  const { painelTabId, abrindoPainel } = await chrome.storage.session.get(["painelTabId", "abrindoPainel"]);
  // Corrida: dois cliques rápidos disparariam 2 abas entre os dois awaits
  // abaixo. Um flag "abrindoPainel" (timestamp) no storage.session cobre a
  // janela entre criar a aba e gravar o id — o segundo clique espera e reusa.
  if (abrindoPainel && Date.now() - abrindoPainel < 10000) {
    // Espera só a janela REAL de criação (~2s). Se não resolveu, cai de volta
    // no fluxo abaixo e abre de novo — evita espera morta de 10s e abrir
    // painel nenhum quando a criação falha (SW morto no meio, aba recusada).
    const id = await new Promise((resolve) => {
      const fim = Date.now() + 2000;
      const tick = async () => {
        const { painelTabId: pid } = await chrome.storage.session.get("painelTabId");
        if (pid) return resolve(pid);
        if (Date.now() >= fim) return resolve(null);
        setTimeout(tick, 200);
      };
      tick();
    });
    if (id) {
      try {
        const t = await chrome.tabs.get(id);
        if (t && t.url && t.url.startsWith(PAINEL_URL)) {
          await chrome.tabs.update(t.id, { active: true }).catch(() => {});
          if (t.windowId) await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
        }
      } catch (e) {
        /* aba fechada no meio — segue pra abrir de novo abaixo */
      }
      return id;
    }
    // expirou ou painelTabId não foi gravado — segue o fluxo normal
  }
  if (painelTabId) {
    try {
      const t = await chrome.tabs.get(painelTabId);
      if (t && t.url && t.url.startsWith(PAINEL_URL)) {
        await chrome.tabs.update(t.id, { active: true }).catch(() => {});
        if (t.windowId) await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
        return t.id;
      }
    } catch (e) {
      // aba fechada/inválida -> remove o registro e abre nova
      await chrome.storage.session.remove("painelTabId");
    }
  }
  await chrome.storage.session.set({ abrindoPainel: Date.now() });
  try {
    const nova = await chrome.tabs.create({ url: PAINEL_URL });
    await chrome.storage.session.set({ painelTabId: nova.id });
    return nova.id;
  } finally {
    await chrome.storage.session.remove("abrindoPainel");
  }
}

// A dedupe de aba duplicada é feita pelo `chrome.storage.session.painelTabId`
// dentro de abrirPainel() — que sobrevive ao ciclo de vida do SW (MV3 mata o
// SW quando ocioso). Sem flag global: ele se perderia entre "dormidas".
chrome.action.onClicked.addListener(() => {
  abrirPainel().catch(console.error);
});

// Espera a aba terminar de carregar antes de falar com o content script.
function aguardarAbaCompleta(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let finalizado = false;
    const cleanup = () => {
      if (finalizado) return;
      finalizado = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") {
        cleanup();
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Se já estiver completa, resolve direto.
    chrome.tabs.get(tabId)
      .then((t) => {
        if (t && t.status === "complete") {
          cleanup();
          resolve(true);
        }
      })
      .catch(() => {});
  });
}

// Garante que o content script está injetado e respondendo na aba. Usado
// pela aba criada nova (que ainda não carregou o content script via manifest)
// e pelas abas existentes pré-carregadas (abertas antes da extensão).
async function garantirContentScript(tabId) {
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action: AC_MSG.PING });
    if (resp && resp.ok) return;
  } catch (e) {
    /* sem content script ainda — injeta abaixo */
  }
  // A idempotência do content script evita duplo envio se já estiver lá.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["protocolo.js", "content-whatsapp.js"],
  });
  // Revalida a injeção: se ainda não responde, falha com mensagem clara em
  // vez de deixar o painel descobrir depois.
  const resp2 = await chrome.tabs.sendMessage(tabId, { action: AC_MSG.PING }).catch(() => null);
  if (!resp2 || !resp2.ok) throw new Error("content script não respondeu após injeção");
}

async function pingAba(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { action: AC_MSG.PING });
  } catch (e) {
    return null;
  }
}

async function getWhatsAppTab() {
  let tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  tabs = tabs.filter((t) => t.url && t.url.startsWith("https://web.whatsapp.com/"));
  const candidatas = [];
  for (const t of tabs) {
    const r = await pingAba(t.id);
    if (r && r.ok && r.logado) candidatas.push(t);
  }
  // Sem aba respondendo (abertas antes da extensão ser carregada): injeta o
  // content script nas existentes antes de abrir uma aba nova — evita abas
  // órfãs a cada disparo.
  if (!candidatas.length) {
    for (const t of tabs) {
      try {
        await garantirContentScript(t.id);
        const r = await pingAba(t.id);
        if (r && r.ok && r.logado) candidatas.push(t);
      } catch (e) {
        // sem content script/injeção falhou nessa aba — tenta a próxima
      }
    }
  }
  let tab = null;
  if (candidatas.length) {
    // Várias abas logadas = risco de disparar pra conta errada. Prioridade:
    // aba escolhida em disparo anterior (waTabEscolhida) > aba ativa > mais
    // recentemente acessada. Sinaliza ambiguidade pro painel avisar o usuário.
    const { waTabEscolhida } = await chrome.storage.session.get("waTabEscolhida");
    const pref = (t) =>
      t.id === waTabEscolhida ? 0 : t.active ? 1 : t.lastAccessed ? 2 : 3;
    candidatas.sort((a, b) => pref(a) - pref(b));
    tab = candidatas[0];
    await chrome.storage.session.set({ waTabEscolhida: tab.id, waTabAmbiguo: candidatas.length > 1 });
  }
  if (!tab) {
    tab = await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
    await chrome.storage.session.set({ waTabEscolhida: tab.id, waTabAmbiguo: false });
    // Garante o DOM pronto antes do PING/injeção (evita falso "content script
    // não respondeu"); se a aba demorar, espera mais antes de injetar.
    const completa = await aguardarAbaCompleta(tab.id);
    if (!completa) await SLEEP(3000);
  }
  await garantirContentScript(tab.id);
  return tab.id;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const versao = chrome.runtime.getManifest().version;
  if (details.reason === "install") {
    if (AC_DEBUG) console.log("Abrir Conversas instalado v" + versao);
  } else if (details.reason === "update") {
    if (AC_DEBUG) console.log("Abrir Conversas atualizado: v" + details.previousVersion + " -> v" + versao);
    // Saneamento pós-update: um disparo que estava rodando quando a extensão
    // foi atualizada deixa leads em "enviando" (que o resume não pega) e STATS
    // com fila pendente. Converte pra "erro" (NUNCA pra "pendente" — o content
    // script pode ter enviado sem atualizar o registry; reenviar duplicaria) e
    // zera a fila órfã, sem depender do usuário abrir o painel.
    try {
      const o = await chrome.storage.local.get(AC_STORAGE.LEADS);
      const leads = o[AC_STORAGE.LEADS] || [];
      let ressinc = false;
      for (const l of leads) {
        if (l && l.status === "enviando") {
          l.status = "erro";
          l.erroEm = new Date().toISOString();
          ressinc = true;
        }
      }
      if (ressinc) await chrome.storage.local.set({ [AC_STORAGE.LEADS]: leads });
      await chrome.storage.local.set({ [AC_STORAGE.STATS]: { fila: [], total: 0, enviados: 0, ativo: false } });
    } catch (e) {
      console.error("[AbrirConversas] saneamento pós-update falhou:", e);
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;
  // Só responde a mensagens da própria extensão.
  if (sender && sender.id !== chrome.runtime.id) return;
  if (msg.action === AC_MSG.GET_WHATSAPP_TAB) {
    getWhatsAppTab()
      .then(async (id) => {
        const { waTabAmbiguo } = await chrome.storage.session.get("waTabAmbiguo");
        sendResponse({ ok: true, tabId: id, ambiguo: !!waTabAmbiguo });
      })
      .catch((e) => sendResponse({ ok: false, erro: String(e) }));
    return true;
  }
});
