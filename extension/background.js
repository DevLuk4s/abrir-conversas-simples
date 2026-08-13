// background.js - service worker
// Orquestra a abertura do painel e localiza/injeta o content script no WhatsApp Web.

importScripts("protocolo.js");

const PAINEL_URL = chrome.runtime.getURL("painel.html");

async function abrirPainel() {
  const tabs = await chrome.tabs.query({ url: PAINEL_URL });
  if (tabs.length) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return tab.id;
  }
  const nova = await chrome.tabs.create({ url: PAINEL_URL });
  return nova.id;
}

let abrindoPainel = false;
chrome.action.onClicked.addListener(() => {
  if (abrindoPainel) return;
  abrindoPainel = true;
  abrirPainel()
    .catch(console.error)
    .finally(() => {
      abrindoPainel = false;
    });
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

async function getWhatsAppTab() {
  let tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  let tab = tabs.find((t) => t.url && t.url.startsWith("https://web.whatsapp.com/"));
  if (!tab) {
    tab = await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
    // Garante o DOM pronto antes do PING/injeção (evita falso "content script não respondeu").
    await aguardarAbaCompleta(tab.id);
  }
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { action: AC_MSG.PING });
    if (!resp || !resp.ok) throw new Error("sem-resposta");
  } catch (e) {
    // Sem content script na aba: injeta manualmente (a idempotência evita duplo envio).
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["protocolo.js", "content-whatsapp.js"],
    });
  }
  return tab.id;
}

chrome.runtime.onInstalled.addListener((details) => {
  const versao = chrome.runtime.getManifest().version;
  if (details.reason === "install") {
    console.log("Abrir Conversas instalado v" + versao);
  } else if (details.reason === "update") {
    console.log("Abrir Conversas atualizado: v" + details.previousVersion + " -> v" + versao);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.action) return;
  if (msg.action === AC_MSG.GET_WHATSAPP_TAB) {
    getWhatsAppTab()
      .then((id) => sendResponse({ ok: true, tabId: id }))
      .catch((e) => sendResponse({ ok: false, erro: String(e) }));
    return true;
  }
});
