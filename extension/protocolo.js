// protocolo.js - constantes compartilhadas entre service worker, content script e painel.
// Carregado antes de background.js, content-whatsapp.js e painel.js (mesmo escopo global).
// Usa globalThis (não window) pra funcionar também no service worker (importScripts),
// e é idempotente: se for carregado 2x (ex.: manifest + executeScript), não redeclara.

"use strict";

if (!globalThis.__acProtocolo) {
  globalThis.__acProtocolo = true;

  globalThis.AC_MSG = Object.freeze({
    PING: "ping",
    STATUS: "status",
    SEND_ONE: "sendOne",
    GET_WHATSAPP_TAB: "getWhatsAppTab",
  });

  globalThis.AC_STORAGE = Object.freeze({
    LEADS: "abrirConversasLeads",
    MODELO: "abrirConversasModeloMensagem",
    CONFIG: "abrirConversasConfig",
    STATS: "abrirConversasDisparoStats",
    DAILY: "abrirConversasDaily",
    WEEKLY: "abrirConversasWeekly",
    WARMUP: "abrirConversasWarmup",
    ENVIADOS: "abrirConversasEnviados",
    LOG: "abrirConversasLog",
  });
}
