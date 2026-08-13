// protocolo.js - constantes compartilhadas entre service worker, content script e painel.
// Carregado antes de background.js, content-whatsapp.js e painel.js (mesmo escopo global).

"use strict";

const AC_MSG = Object.freeze({
  PING: "ping",
  STATUS: "status",
  SEND_ONE: "sendOne",
  GET_WHATSAPP_TAB: "getWhatsAppTab",
  OPEN_PAINEL: "openPainel",
});

const AC_STORAGE = Object.freeze({
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
