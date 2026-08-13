// painel.js - painel livre da extensão.
// Porta do app.js (painel web) + disparo automático com camada anti-ban.

(() => {
  "use strict";

  // ---------- Constantes e storage ----------

  const MODELO_PADRAO =
    "Oi! Vi que a {NOME} não tem site próprio ainda — só o Google Maps mesmo. Posso te mandar um exemplo?";

  const Storage = {
    async get(key, fallback) {
      const o = await chrome.storage.local.get(key);
      return o[key] !== undefined ? o[key] : fallback;
    },
    async set(key, val) {
      await chrome.storage.local.set({ [key]: val });
    },
    async remove(key) {
      await chrome.storage.local.remove(key);
    },
  };

  const PERFIS = {
    conservador: { intervaloMin: 45, intervaloMax: 120, limiteDiario: 20, limiteSemanal: 120, pausaCada: 6, pausaMin: 4, pausaMax: 8 },
    moderado: { intervaloMin: 30, intervaloMax: 75, limiteDiario: 40, limiteSemanal: 250, pausaCada: 10, pausaMin: 5, pausaMax: 10 },
    livre: { intervaloMin: 20, intervaloMax: 45, limiteDiario: 60, limiteSemanal: 400, pausaCada: 20, pausaMin: 5, pausaMax: 10 },
  };

  const CONFIG_PADRAO = Object.assign(
    {
      perfil: "conservador",
      janelaInicio: "09:00",
      janelaFim: "18:00",
      janelaInvalida: false,
      pausaAlmoco: true,
      almocoInicio: "12:00",
      almocoFim: "13:30",
      pausaAuto: true,
      embaralhar: true,
      simularDigitacao: true,
      aquecimento: true,
    },
    PERFIS.conservador
  );

  const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Elementos ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    modeloMensagem: $("modeloMensagem"),
    areaUpload: $("areaUpload"),
    inputCsv: $("inputCsv"),
    textoUpload: $("textoUpload"),
    btnGerarMensagens: $("btnGerarMensagens"),
    hintGerar: $("hintGerar"),
    inputImportar: $("inputImportar"),
    btnExportar: $("btnExportar"),
    btnLimpar: $("btnLimpar"),
    tabela: $("tabela"),
    corpoTabela: $("corpoTabela"),
    vazio: $("vazio"),
    contador: $("contador"),
    disparoProgresso: $("disparoProgresso"),
    statsLinha: $("statsLinha"),
    logConteudo: $("logConteudo"),
    modal: $("modalMensagem"),
    modalTitulo: $("modalTitulo"),
    modalMsg: $("modalMsg"),
    modalBtnAbrir: $("modalBtnAbrir"),
    modalBtnFechar: $("modalBtnFechar"),
    btnTestar: $("btnTestar"),
    btnDisparar: $("btnDisparar"),
    btnPausar: $("btnPausar"),
    btnRetomar: $("btnRetomar"),
    btnParar: $("btnParar"),
    btnEmergencia: $("btnEmergencia"),
    cfg: {
      perfil: $("cfgPerfil"),
      intervaloMin: $("cfgIntervaloMin"),
      intervaloMax: $("cfgIntervaloMax"),
      limiteDiario: $("cfgLimiteDiario"),
      limiteSemanal: $("cfgLimiteSemanal"),
      janelaInicio: $("cfgJanelaInicio"),
      janelaFim: $("cfgJanelaFim"),
      pausaAlmoco: $("cfgPausaAlmoco"),
      almocoInicio: $("cfgAlmocoInicio"),
      almocoFim: $("cfgAlmocoFim"),
      pausaAuto: $("cfgPausaAuto"),
      pausaCada: $("cfgPausaCada"),
      pausaMin: $("cfgPausaMin"),
      pausaMax: $("cfgPausaMax"),
      embaralhar: $("cfgEmbaralhar"),
      simularDigitacao: $("cfgSimularDigitacao"),
      aquecimento: $("cfgAquecimento"),
    },
  };

  let ultimosBrutos = null;

  // ---------- Config ----------

  async function lerConfig() {
    const c = await Storage.get(AC_STORAGE.CONFIG, null);
    return Object.assign({}, CONFIG_PADRAO, c || {});
  }
  async function salvarConfig(c) {
    await Storage.set(AC_STORAGE.CONFIG, c);
  }

  async function preencherConfig() {
    const c = await lerConfig();
    for (const [k, input] of Object.entries(el.cfg)) {
      const val = c[k];
      if (input.type === "checkbox") input.checked = !!val;
      else input.value = val !== undefined ? val : "";
    }
  }

  async function aplicarPerfil() {
    const p = el.cfg.perfil.value;
    const prof = PERFIS[p] || PERFIS.conservador;
    const c = await lerConfig();
    Object.assign(c, prof, { perfil: p });
    await salvarConfig(c);
    await preencherConfig();
    adicionarLog("Perfil de segurança: " + p, false);
  }

  async function salvarCamposConfig() {
    const c = await lerConfig();
    const ini = el.cfg.janelaInicio.value || "09:00";
    const fim = el.cfg.janelaFim.value || "18:00";
    c.perfil = el.cfg.perfil.value;
    c.intervaloMin = parseInt(el.cfg.intervaloMin.value, 10) || 45;
    c.intervaloMax = parseInt(el.cfg.intervaloMax.value, 10) || 120;
    c.limiteDiario = parseInt(el.cfg.limiteDiario.value, 10) || 20;
    c.limiteSemanal = parseInt(el.cfg.limiteSemanal.value, 10) || 120;
    c.janelaInicio = ini;
    c.janelaFim = fim;
    c.janelaInvalida = hhmmParaMin(ini) >= hhmmParaMin(fim);
    c.pausaAlmoco = el.cfg.pausaAlmoco.checked;
    c.almocoInicio = el.cfg.almocoInicio.value || "12:00";
    c.almocoFim = el.cfg.almocoFim.value || "13:30";
    c.pausaAuto = el.cfg.pausaAuto.checked;
    c.pausaCada = parseInt(el.cfg.pausaCada.value, 10) || 6;
    c.pausaMin = parseInt(el.cfg.pausaMin.value, 10) || 4;
    c.pausaMax = parseInt(el.cfg.pausaMax.value, 10) || 8;
    c.embaralhar = el.cfg.embaralhar.checked;
    c.simularDigitacao = el.cfg.simularDigitacao.checked;
    c.aquecimento = el.cfg.aquecimento.checked;
    await salvarConfig(c);
  }

  // ---------- CSV e leads (porta do app.js) ----------

  function parseCSV(texto) {
    const primeira = texto.split(/\r?\n/, 1)[0] || "";
    const sep =
      (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ";" : ",";
    const linhas = [];
    let campo = "";
    let linha = [];
    let dentroDeAspas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (dentroDeAspas) {
        if (c === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i++; }
          else dentroDeAspas = false;
        } else campo += c;
      } else {
        if (c === '"') dentroDeAspas = true;
        else if (c === sep) { linha.push(campo); campo = ""; }
        else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
        else if (c !== "\r") campo += c;
      }
    }
    if (campo.length || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas;
  }

  function detectarColunas(cabecalho) {
    const minusculo = cabecalho.map((h) => String(h).trim().toLowerCase());
    const find = (arr) => minusculo.findIndex((h) => arr.includes(h));
    return {
      idxNome: find(["nome", "title", "name"]),
      idxTelefone: find(["telefone", "phoneunformatted", "phone", "telefone_formatado"]),
      idxAvaliacoes: find(["avaliações", "avaliacoes", "reviewscount"]),
      idxUrl: find(["url", "link", "googlemapsurl", "link maps", "link_maps"]),
      idxInstagram: minusculo.findIndex((h) => h.includes("instagram")),
      idxMensagem: find(["mensagem"]),
      idxAngulo: find(["ângulo", "angulo"]),
      idxBairro: find(["bairro/região", "bairro", "region", "neighborhood"]),
      idxNota: find(["nota"]),
    };
  }

  function formatarTelefone(telefone) {
    let numeros = (telefone || "").replace(/\D/g, "");
    if (!numeros) return null;
    if (numeros.startsWith("0")) numeros = numeros.slice(1);
    if (numeros.startsWith("55")) return numeros;
    if (numeros.length >= 10 && numeros.length <= 11) numeros = "55" + numeros;
    return numeros;
  }

  function escaparHtml(texto) {
    const div = document.createElement("div");
    div.textContent = texto;
    return div.innerHTML;
  }

  function urlSegura(valor) {
    if (!valor) return null;
    try {
      const u = new URL(valor);
      return u.protocol === "http:" || u.protocol === "https:" ? valor : null;
    } catch (e) {
      return null;
    }
  }

  function formatarLinkInstagram(valor) {
    if (/^https?:\/\//i.test(valor)) return valor;
    return "https://instagram.com/" + valor.replace(/^@/, "");
  }

  async function lerLeads() {
    return await Storage.get(AC_STORAGE.LEADS, []);
  }
  async function salvarLeads(leads) {
    await Storage.set(AC_STORAGE.LEADS, leads);
  }

  async function lerEnviados() {
    return await Storage.get(AC_STORAGE.ENVIADOS, []);
  }

  async function processarCSV(texto) {
    texto = texto.replace(/^\uFEFF/, "");
    const linhas = parseCSV(texto);
    if (linhas.length < 2) {
      el.textoUpload.textContent = "Erro: CSV vazio ou sem dados";
      return;
    }
    const cabecalho = linhas[0];
    const cols = detectarColunas(cabecalho);
    if (cols.idxNome === -1 || cols.idxTelefone === -1) {
      el.textoUpload.textContent = "Erro: não encontrei colunas de nome/telefone.";
      return;
    }

    ultimosBrutos = linhas;
    const temMensagem = cols.idxMensagem !== -1;
    el.btnGerarMensagens.style.display = temMensagem ? "none" : "inline-block";
    el.hintGerar.style.display = temMensagem ? "none" : "block";

    const atuais = await lerLeads();
    const statusAntigo = {};
    for (const l of atuais) statusAntigo[l.telefone] = l;
    const enviadosSet = new Set(await lerEnviados());

    const leads = [];
    const vistos = new Set();
    for (let i = 1; i < linhas.length; i++) {
      const linha = linhas[i];
      const nome = (linha[cols.idxNome] || "").trim();
      const telefone = formatarTelefone(linha[cols.idxTelefone]);
      if (!nome || !telefone) continue;
      if (vistos.has(telefone)) continue;
      vistos.add(telefone);
      const antigo = statusAntigo[telefone];
      leads.push({
        id: telefone + "-" + i,
        nome,
        telefone,
        avaliacoes: cols.idxAvaliacoes !== -1 ? parseInt((linha[cols.idxAvaliacoes] || "0").replace(/\D/g, ""), 10) || 0 : 0,
        mapsUrl: cols.idxUrl !== -1 ? (linha[cols.idxUrl] || "").trim() || null : null,
        instagram: cols.idxInstagram !== -1 ? (linha[cols.idxInstagram] || "").trim() || null : null,
        mensagem: cols.idxMensagem !== -1 ? (linha[cols.idxMensagem] || "").trim() || null : null,
        angulo: cols.idxAngulo !== -1 ? (linha[cols.idxAngulo] || "").trim() || null : null,
        bairroRegiao: cols.idxBairro !== -1 ? (linha[cols.idxBairro] || "").trim() || null : null,
        nota: cols.idxNota !== -1 ? (linha[cols.idxNota] || "").trim() || null : null,
        aberto: antigo ? antigo.aberto : false,
        abertoEm: antigo ? antigo.abertoEm : null,
        enviada: antigo ? antigo.enviada : false,
        enviadaEm: antigo ? antigo.enviadaEm : null,
        naoEncontrado: antigo ? antigo.naoEncontrado : false,
        naoEncontradoEm: antigo ? antigo.naoEncontradoEm : null,
        jaEnviado: enviadosSet.has(telefone),
      });
    }

    await salvarLeads(leads);
    el.textoUpload.textContent = "Clique aqui ou arraste outro CSV pra substituir a lista";
    await renderizarLeads();
  }

  async function gerarMensagens() {
    if (!ultimosBrutos) return;
    const pipelineLeads = window.Pipeline.processar(ultimosBrutos);
    const leads = await lerLeads();
    const porTelefone = new Map();
    for (const p of pipelineLeads) {
      const num = (p.link || "").replace("https://wa.me/", "");
      if (num) porTelefone.set(num, p);
    }
    let preenchidos = 0;
    for (const l of leads) {
      const p = porTelefone.get(l.telefone);
      if (p) {
        l.mensagem = p.mensagem;
        l.angulo = p.angulo;
        if (!l.bairroRegiao && p.bairro) l.bairroRegiao = p.bairro;
        if (!l.nota && p.nota && p.nota !== "—") l.nota = p.nota;
        if (!l.avaliacoes && p.avaliacoes !== "—") l.avaliacoes = parseInt(p.avaliacoes, 10) || 0;
        preenchidos++;
      }
    }
    await salvarLeads(leads);
    el.btnGerarMensagens.style.display = "none";
    el.hintGerar.style.display = "none";
    adicionarLog("Mensagens geradas pelo pipeline para " + preenchidos + " leads.", false);
    await renderizarLeads();
  }

  // ---------- Renderização ----------

  function montarLinha(lead) {
    const tr = document.createElement("tr");
    tr.dataset.id = lead.id;
    if (lead.aberto) tr.classList.add("aberto");
    if (lead.enviada) tr.classList.add("enviada");
    if (lead.naoEncontrado) tr.classList.add("nao-encontrado");
    if (lead.jaEnviado) tr.classList.add("ja-enviado");

    let acao;
    if (lead.naoEncontrado) {
      acao = `<button class="nao-encontrado" disabled>Número inválido ✗</button>`;
    } else {
      const abrir = lead.enviada
        ? ""
        : `<button class="reabrir" data-acao="abrir" data-id="${lead.id}">${lead.aberto ? "Reabrir" : "Abrir"} conversa</button>`;
      const enviar = `<button class="enviar" data-acao="enviar" data-id="${lead.id}" ${lead.enviada ? "disabled" : ""}>${lead.enviada ? "Enviada ✓" : "Marcar enviada"}</button>`;
      const invalido = lead.enviada ? "" : `<button class="nao-encontrado" data-acao="invalido" data-id="${lead.id}">Número não encontrado</button>`;
      acao = abrir + enviar + invalido;
    }

    const mapsUrl = urlSegura(lead.mapsUrl);
    const maps = mapsUrl ? `<a href="${escaparHtml(mapsUrl)}" target="_blank" rel="noopener">Ver no Maps</a>` : "-";
    const insta = lead.instagram ? `<a href="${escaparHtml(formatarLinkInstagram(lead.instagram))}" target="_blank" rel="noopener">${escaparHtml(lead.instagram)}</a>` : "-";
    const msg = lead.mensagem ? `<div class="mensagem-prev" title="${escaparHtml(lead.mensagem)}">${escaparHtml(lead.mensagem.slice(0, 90))}${lead.mensagem.length > 90 ? "…" : ""}</div>` : "-";

    tr.innerHTML = `
      <td data-label="Nome">${escaparHtml(lead.nome)}${lead.angulo ? `<div class="angulo">${escaparHtml(lead.angulo)}</div>` : ""}</td>
      <td data-label="Bairro/Região">${escaparHtml(lead.bairroRegiao || "-")}</td>
      <td data-label="Telefone">${lead.telefone}</td>
      <td data-label="Nota">${escaparHtml(lead.nota || "-")}</td>
      <td data-label="Avaliações">${lead.avaliacoes || 0}</td>
      <td data-label="Google Maps">${maps}</td>
      <td data-label="Instagram">${insta}</td>
      <td data-label="Mensagem">${msg}</td>
      <td data-label="Ação">${acao}</td>
    `;
    return tr;
  }

  async function renderizarLeads() {
    const leads = await lerLeads();
    if (!leads.length) {
      el.tabela.style.display = "none";
      el.vazio.style.display = "block";
      el.contador.textContent = "";
      return;
    }
    el.vazio.style.display = "none";
    el.tabela.style.display = "table";

    const abertos = leads.filter((l) => l.aberto).length;
    const enviados = leads.filter((l) => l.enviada).length;
    el.contador.textContent = `${abertos} de ${leads.length} conversas abertas · ${enviados} mensagens marcadas como enviadas`;

    const notaNum = (l) => parseFloat((l.nota || "").replace(",", ".")) || 0;
    const ordenados = leads
      .slice()
      .sort((a, b) => notaNum(b) - notaNum(a) || (b.avaliacoes || 0) - (a.avaliacoes || 0));

    el.corpoTabela.innerHTML = "";
    for (const lead of ordenados) {
      el.corpoTabela.appendChild(montarLinha(lead));
    }
  }

  // Atualiza só a linha de um lead (usado no loop de disparo pra evitar
  // re-render de toda a tabela a cada envio).
  async function atualizarLinha(id) {
    const leads = await lerLeads();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    const existente = el.corpoTabela.querySelector(`tr[data-id="${id}"]`);
    if (existente) existente.replaceWith(montarLinha(lead));
  }

  // Salva o lead sem re-renderizar (o loop chama atualizarLinha depois).
  async function persistirLead(id, campos) {
    const leads = await lerLeads();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return null;
    Object.assign(lead, campos);
    await salvarLeads(leads);
    return lead;
  }

  // ---------- Modal manual (fallback) ----------

  async function abrirModal(id) {
    const leads = await lerLeads();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    const modelo = await lerModelo();
    el.modalMsg.value = lead.mensagem || modelo || MODELO_PADRAO;
    el.modalTitulo.textContent = "Conversa com " + lead.nome;
    el.modalBtnAbrir.dataset.id = id;
    if (typeof el.modal.showModal === "function") el.modal.showModal();
    else el.modal.setAttribute("open", "");
    el.modalMsg.focus();
  }

  async function lerModelo() {
    return await Storage.get(AC_STORAGE.MODELO, null);
  }

  function fecharModal() {
    if (typeof el.modal.close === "function") el.modal.close();
    else el.modal.removeAttribute("open");
  }

  async function abrirWhatsAppManual(id) {
    const leads = await lerLeads();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    const mensagem = el.modalMsg.value.replace(/\{NOME\}/g, lead.nome).replace(/\{NOME_CURTO\}/g, lead.nome);
    const link = `https://wa.me/${lead.telefone}?text=${encodeURIComponent(mensagem)}`;
    window.open(link, "_blank");
    fecharModal();
    await persistirLead(id, { aberto: true, abertoEm: new Date().toISOString() });
    await renderizarLeads();
  }

  async function marcarEnviada(id) {
    await persistirLead(id, { enviada: true, enviadaEm: new Date().toISOString() });
    await renderizarLeads();
  }
  async function marcarInvalido(id) {
    await persistirLead(id, { naoEncontrado: true, naoEncontradoEm: new Date().toISOString() });
    await renderizarLeads();
  }

  // ---------- Backup ----------

  async function exportarBackup() {
    const leads = await lerLeads();
    const conteudo = JSON.stringify(leads, null, 2);
    const blob = new Blob([conteudo], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const data = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = "abrir-conversas-backup-" + data + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function importarBackup(arquivo) {
    const texto = await arquivo.text();
    let importados;
    try {
      importados = JSON.parse(texto);
    } catch (e) {
      alert("Erro: arquivo não é um JSON válido.");
      return;
    }
    if (!Array.isArray(importados)) {
      alert("Erro: formato inesperado (esperava uma lista de leads).");
      return;
    }
    const atuais = await lerLeads();
    const porTelefone = {};
    for (const l of atuais) porTelefone[l.telefone] = l;
    for (const imp of importados) {
      if (!imp || !imp.telefone) continue;
      const ex = porTelefone[imp.telefone];
      if (!ex) porTelefone[imp.telefone] = imp;
      else {
        porTelefone[imp.telefone] = {
          ...imp,
          aberto: ex.aberto || imp.aberto,
          abertoEm: ex.abertoEm || imp.abertoEm,
          enviada: ex.enviada || imp.enviada,
          enviadaEm: ex.enviadaEm || imp.enviadaEm,
          naoEncontrado: ex.naoEncontrado || imp.naoEncontrado,
          naoEncontradoEm: ex.naoEncontradoEm || imp.naoEncontradoEm,
        };
      }
    }
    const final = Object.values(porTelefone);
    await salvarLeads(final);
    adicionarLog("Backup importado: " + importados.length + " leads mesclados.", false);
    await renderizarLeads();
  }

  async function limparLista() {
    if (!confirm("Limpar a lista de leads atual?")) return;
    await salvarLeads([]);
    await renderizarLeads();
  }

  // ---------- Log ----------

  async function adicionarLog(txt, erro) {
    const log = await Storage.get(AC_STORAGE.LOG, []);
    log.unshift({ t: new Date().toLocaleTimeString("pt-BR"), txt, erro: !!erro });
    if (log.length > 80) log.length = 80;
    await Storage.set(AC_STORAGE.LOG, log);
    await renderizarLog();
  }

  async function renderizarLog() {
    const log = await Storage.get(AC_STORAGE.LOG, []);
    el.logConteudo.innerHTML = log
      .map((e) => `<div class="${e.erro ? "erro" : ""}">[${escaparHtml(e.t)}] ${escaparHtml(e.txt)}</div>`)
      .join("\n") || "(sem registros ainda)";
  }

  // ---------- Contadores de limites ----------

  function hojeStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function semanaStr() {
    const d = new Date();
    const dia = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dia);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function lerDiario() {
    const d = await Storage.get(AC_STORAGE.DAILY, { data: hojeStr(), count: 0 });
    return d.data === hojeStr() ? d : { data: hojeStr(), count: 0 };
  }
  async function lerSemana() {
    const s = await Storage.get(AC_STORAGE.WEEKLY, { data: semanaStr(), count: 0 });
    return s.data === semanaStr() ? s : { data: semanaStr(), count: 0 };
  }

  async function tetoDiarioEfetivo(config) {
    config = config || CONFIG_PADRAO;
    if (!config.aquecimento) return config.limiteDiario;
    let w = await Storage.get(AC_STORAGE.WARMUP, null);
    if (!w) {
      w = { inicio: new Date().toISOString() };
      await Storage.set(AC_STORAGE.WARMUP, w);
    }
    const dias = Math.floor((Date.now() - new Date(w.inicio).getTime()) / 86400000) + 1;
    return Math.max(1, Math.min(config.limiteDiario, 8 + (dias - 1) * 3));
  }

  // ---------- Tempo (janela, almoço, intervalo humano) ----------

  function hhmmParaMin(t) {
    const [h, m] = (t || "00:00").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  function agoraMin() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  function segParaHm(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return (h ? h + "h " : "") + (m ? m + "m " : "") + (h || m ? String(sec).padStart(2, "0") + "s" : s + "s");
  }

  function intervaloHumano(min, max) {
    const media = (min + max) / 2;
    const desvio = (max - min) / 4;
    let v = media + (Math.random() + Math.random() + Math.random() - 1.5) * desvio;
    v = Math.max(min, Math.min(max, v));
    return Math.round(v * 1000);
  }

  // ---------- Disparo ----------

  const estado = {
    rodando: false,
    parado: false,
    pausado: false,
    fila: [],
    enviadosRodada: 0,
    totalRodada: 0,
    whatsTabId: null,
    cache: {
      config: null,
      modelo: null,
      daily: null,
      weekly: null,
      teto: null,
    },
  };

  function atualizarProgresso(msg, tipo) {
    el.disparoProgresso.textContent = msg;
    el.disparoProgresso.className = "progresso" + (tipo ? " " + tipo : "");
    renderizarBotoes();
  }

  function renderizarBotoes() {
    const rodando = estado.rodando;
    el.btnDisparar.style.display = rodando ? "none" : "inline-block";
    el.btnPausar.style.display = rodando && !estado.pausado ? "inline-block" : "none";
    el.btnRetomar.style.display = rodando && estado.pausado ? "inline-block" : "none";
    el.btnParar.style.display = rodando ? "inline-block" : "none";
    el.btnEmergencia.style.display = rodando ? "inline-block" : "none";
  }

  async function salvarStats() {
    await Storage.set(AC_STORAGE.STATS, {
      fila: estado.fila.slice(),
      total: estado.totalRodada,
      enviados: estado.enviadosRodada,
      ativo: estado.rodando,
    });
  }

  // Carrega config/modelo/contadores uma única vez por rodada (evita leituras
  // repetidas de chrome.storage dentro do loop).
  async function prepararRodada() {
    const config = await lerConfig();
    estado.cache.config = config;
    estado.cache.modelo = (await lerModelo()) || MODELO_PADRAO;
    estado.cache.daily = await lerDiario();
    estado.cache.weekly = await lerSemana();
    estado.cache.teto = await tetoDiarioEfetivo(config);
    if (config.janelaInvalida) {
      await adicionarLog("Janela de horário inválida (início >= fim) — ignorando janela neste disparo.", true);
    }
    return config;
  }

  function checarLimites() {
    const c = estado.cache;
    if (c.daily.count >= c.teto) return { ok: false, motivo: `Limite diário atingido (${c.daily.count}/${c.teto}).` };
    if (c.weekly.count >= c.config.limiteSemanal) return { ok: false, motivo: `Limite semanal atingido (${c.weekly.count}/${c.config.limiteSemanal}).` };
    return { ok: true };
  }

  // Registra um envio nos contadores em memória e persiste (crash-safe).
  async function registrarEnvio() {
    estado.cache.daily.count++;
    estado.cache.weekly.count++;
    await Storage.set(AC_STORAGE.DAILY, estado.cache.daily);
    await Storage.set(AC_STORAGE.WEEKLY, estado.cache.weekly);
  }

  async function obterTabWhats() {
    const r = await chrome.runtime.sendMessage({ action: AC_MSG.GET_WHATSAPP_TAB });
    return r && r.ok ? r.tabId : null;
  }

  async function testarConexao() {
    const tabId = await obterTabWhats();
    if (!tabId) return { ok: false, erro: "Não consegui abrir/achar a aba do WhatsApp." };
    try {
      const r = await chrome.tabs.sendMessage(tabId, { action: AC_MSG.STATUS });
      if (!r || !r.ok) return { ok: false, erro: "Content script não respondeu. Recarregue a aba do WhatsApp." };
      if (!r.logado) return { ok: false, erro: "WhatsApp Web não está logado. Escaneie o QR code e tente de novo." };
      return { ok: true, tabId, selectors: r.selectors };
    } catch (e) {
      return { ok: false, erro: String(e) };
    }
  }

  async function aguardarComControle(ms, statusTxt) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      if (estado.parado) return false;
      if (estado.pausado) {
        atualizarProgresso("Pausado manualmente — clique em Retomar.", "pausado");
        await SLEEP(1000);
        continue;
      }
      const rest = Math.max(1, Math.round((fim - Date.now()) / 1000));
      atualizarProgresso(`${statusTxt} ${segParaHm(rest)}`, "pausado");
      await SLEEP(1000);
    }
    return !estado.parado;
  }

  async function aguardarJanelaValida() {
    const config = estado.cache.config;
    if (config.janelaInvalida) return; // configuração inválida → não bloqueia
    while (!estado.parado) {
      const agora = agoraMin();
      const ini = hhmmParaMin(config.janelaInicio);
      const fim = hhmmParaMin(config.janelaFim);
      const aI = hhmmParaMin(config.almocoInicio);
      const aF = hhmmParaMin(config.almocoFim);
      let motivo = null;
      let prox = null;
      if (agora < ini) { motivo = `Janela começa às ${config.janelaInicio}`; prox = ini; }
      else if (agora >= fim) { motivo = `Janela terminou às ${config.janelaFim}`; prox = ini + 1440; }
      else if (config.pausaAlmoco && agora >= aI && agora < aF) { motivo = `Pausa de almoço até ${config.almocoFim}`; prox = aF; }
      if (!motivo) return;
      const esperaMs = (prox - agora) * 60000;
      const ok = await aguardarComControle(esperaMs, motivo + " — aguardando");
      if (!ok) return;
    }
  }

  async function processarFila(filaIds, total, jaEnviados) {
    estado.fila = filaIds.slice();
    estado.enviadosRodada = jaEnviados || 0;
    estado.totalRodada = total;
    const tabId = estado.whatsTabId;
    const config = estado.cache.config;
    let desdeAuto = 0;

    while (estado.fila.length && !estado.parado) {
      const lim = checarLimites();
      if (!lim.ok) {
        await adicionarLog(lim.motivo, true);
        atualizarProgresso(lim.motivo + " Encerrando a rodada.", "erro");
        break;
      }

      await aguardarJanelaValida();
      if (estado.parado) break;
      if (estado.pausado) {
        atualizarProgresso("Pausado manualmente — clique em Retomar.", "pausado");
        while (estado.pausado && !estado.parado) await SLEEP(500);
        if (estado.parado) break;
      }

      const id = estado.fila[0];
      const leads = await lerLeads();
      const lead = leads.find((l) => l.id === id);
      if (!lead || lead.enviada || lead.naoEncontrado) {
        estado.fila.shift();
        continue;
      }

      const mensagem = (lead.mensagem || estado.cache.modelo)
        .replace(/\{NOME_CURTO\}/g, lead.nome)
        .replace(/\{NOME\}/g, lead.nome);

      atualizarProgresso(`Enviando para ${lead.nome} (${estado.enviadosRodada + 1} de ${total})…`, "disparando");

      let resp;
      try {
        resp = await chrome.tabs.sendMessage(tabId, {
          action: AC_MSG.SEND_ONE,
          telefone: lead.telefone,
          mensagem,
          simulacao: config.simularDigitacao,
        });
      } catch (e) {
        resp = { ok: false, erro: "comunicacao-" + String(e) };
      }

      estado.fila.shift();

      if (resp && resp.ok) {
        await registrarEnvio();
        const enviados = await lerEnviados();
        if (!enviados.includes(lead.telefone)) {
          enviados.push(lead.telefone);
          await Storage.set(AC_STORAGE.ENVIADOS, enviados);
        }
        await persistirLead(id, { enviada: true, enviadaEm: new Date().toISOString(), aberto: true, abertoEm: new Date().toISOString() });
        await atualizarLinha(id);
        estado.enviadosRodada++;
        await adicionarLog(`✓ ${lead.nome} (${lead.telefone}) — enviada`);
        await atualizarStats();

        desdeAuto++;
        if (estado.fila.length) {
          if (config.pausaAuto && desdeAuto >= config.pausaCada) {
            desdeAuto = 0;
            const pauseMs = (config.pausaMin + Math.random() * (config.pausaMax - config.pausaMin)) * 60000;
            const okPause = await aguardarComControle(pauseMs, "Pausa automática — continuando em");
            if (!okPause) break;
          } else if (Math.random() < 0.08) {
            const okPause = await aguardarComControle((1 + Math.random() * 2) * 60000, "Pausa curta — continuando em");
            if (!okPause) break;
          }
        }
      } else if (resp && resp.erro === "numero-invalido") {
        await persistirLead(id, { naoEncontrado: true, naoEncontradoEm: new Date().toISOString() });
        await atualizarLinha(id);
        await adicionarLog(`✗ ${lead.nome} — número inválido`, true);
      } else {
        await adicionarLog(`✗ ${lead.nome} — erro: ${resp && resp.erro ? resp.erro : "sem resposta"}`, true);
      }

      await salvarStats();

      if (estado.fila.length && !estado.parado) {
        const waitMs = intervaloHumano(config.intervaloMin, config.intervaloMax);
        const okInt = await aguardarComControle(waitMs, `Próximo em`);
        if (!okInt) break;
      }
    }

    estado.rodando = false;
    estado.parado = false;
    estado.pausado = false;
    atualizarProgresso("Disparo concluído ou interrompido.", "");
    await salvarStats();
    await atualizarStats();
    renderizarBotoes();
  }

  async function atualizarStats() {
    if (!estado.cache.config) await prepararRodada();
    const c = estado.cache;
    el.statsLinha.textContent =
      `Hoje: ${c.daily.count}/${c.teto} · Semana: ${c.weekly.count}/${c.config.limiteSemanal} · ` +
      `Rodada: ${estado.enviadosRodada} de ${estado.totalRodada || 0}`;
  }

  async function iniciarDisparo() {
    if (estado.rodando) return;

    await salvarCamposConfig();

    const test = await testarConexao();
    if (!test.ok) {
      atualizarProgresso(test.erro, "erro");
      return;
    }
    estado.whatsTabId = test.tabId;
    await prepararRodada();

    const config = estado.cache.config;
    const leads = await lerLeads();
    const enviadosSet = new Set(await lerEnviados());

    let pendentes = leads.filter((l) => !l.enviada && !l.naoEncontrado && !enviadosSet.has(l.telefone));
    if (!pendentes.length) {
      atualizarProgresso("Nenhum lead pendente pra disparar (todos enviados, inválidos ou já disparados).", "");
      return;
    }
    if (config.embaralhar) {
      for (let i = pendentes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pendentes[i], pendentes[j]] = [pendentes[j], pendentes[i]];
      }
    }

    const filaIds = pendentes.map((l) => l.id);
    estado.rodando = true;
    estado.parado = false;
    estado.pausado = false;
    await adicionarLog(`Iniciando disparo com ${filaIds.length} leads.`, false);
    await salvarStats();
    await atualizarStats();
    await processarFila(filaIds, filaIds.length, 0);
  }

  async function pausarDisparo() {
    estado.pausado = true;
    atualizarProgresso("Pausado manualmente — clique em Retomar.", "pausado");
    await salvarStats();
  }

  async function retomarDisparo() {
    if (estado.rodando && estado.pausado) {
      estado.pausado = false;
      atualizarProgresso("Retomando…", "disparando");
      return;
    }
    const stats = await Storage.get(AC_STORAGE.STATS, null);
    if (!stats || !stats.fila || !stats.fila.length) {
      atualizarProgresso("Nada pra retomar. Inicie um novo disparo.", "");
      return;
    }
    const leads = await lerLeads();
    const enviadosSet = new Set(await lerEnviados());
    const fila = stats.fila.filter((id) => {
      const l = leads.find((x) => x.id === id);
      return l && !l.enviada && !l.naoEncontrado && !enviadosSet.has(l.telefone);
    });
    if (!fila.length) {
      atualizarProgresso("Tudo já foi enviado desde a última pausa.", "");
      return;
    }
    const test = await testarConexao();
    if (!test.ok) {
      atualizarProgresso(test.erro, "erro");
      return;
    }
    estado.whatsTabId = test.tabId;
    await prepararRodada();
    estado.rodando = true;
    estado.parado = false;
    estado.pausado = false;
    await adicionarLog("Retomando disparo.", false);
    await processarFila(fila, stats.total || fila.length, stats.enviados || 0);
  }

  function pararDisparo() {
    estado.parado = true;
    estado.pausado = false;
    atualizarProgresso("Parando…", "erro");
  }

  function emergencia() {
    estado.parado = true;
    estado.pausado = false;
    atualizarProgresso("EMERGÊNCIA — disparo interrompido instantaneamente.", "erro");
  }

  // ---------- Eventos ----------

  async function init() {
    el.modeloMensagem.value = (await lerModelo()) || MODELO_PADRAO;
    el.modeloMensagem.addEventListener("input", () => {
      chrome.storage.local.set({ [AC_STORAGE.MODELO]: el.modeloMensagem.value });
    });

    el.inputCsv.addEventListener("change", () => {
      if (el.inputCsv.files[0]) {
        const r = new FileReader();
        r.onload = () => processarCSV(String(r.result));
        r.readAsText(el.inputCsv.files[0], "utf-8");
      }
    });

    el.areaUpload.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.areaUpload.classList.add("arrastando");
    });
    el.areaUpload.addEventListener("dragleave", () => el.areaUpload.classList.remove("arrastando"));
    el.areaUpload.addEventListener("drop", (e) => {
      e.preventDefault();
      el.areaUpload.classList.remove("arrastando");
      const f = e.dataTransfer.files[0];
      if (f) {
        const r = new FileReader();
        r.onload = () => processarCSV(String(r.result));
        r.readAsText(f, "utf-8");
      }
    });

    el.btnGerarMensagens.addEventListener("click", gerarMensagens);

    el.inputImportar.addEventListener("change", () => {
      if (el.inputImportar.files[0]) importarBackup(el.inputImportar.files[0]);
    });
    el.btnExportar.addEventListener("click", exportarBackup);
    el.btnLimpar.addEventListener("click", limparLista);

    // Delegação de eventos (CSP de páginas de extensão bloqueia onclick inline).
    el.corpoTabela.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-acao]");
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id) return;
      if (btn.dataset.acao === "abrir") abrirModal(id);
      else if (btn.dataset.acao === "enviar") marcarEnviada(id);
      else if (btn.dataset.acao === "invalido") marcarInvalido(id);
    });

    el.modalBtnAbrir.addEventListener("click", () => abrirWhatsAppManual(el.modalBtnAbrir.dataset.id));
    el.modalBtnFechar.addEventListener("click", fecharModal);
    el.modal.addEventListener("click", (e) => {
      if (e.target === el.modal) fecharModal();
    });

    el.cfg.perfil.addEventListener("change", aplicarPerfil);
    for (const input of Object.values(el.cfg)) {
      if (input.id && input.id.startsWith("cfg") && input.id !== "cfgPerfil") {
        input.addEventListener("change", salvarCamposConfig);
      }
    }

    el.btnTestar.addEventListener("click", async () => {
      const r = await testarConexao();
      if (r.ok) {
        const sel = r.selectors || {};
        atualizarProgresso(
          `Conexão OK. Logado no WhatsApp. Selectors: busca ${sel.searchInput ? "✓" : "✗"}, campo ${sel.compose ? "✓" : "✗"}, enviar ${sel.send ? "✓" : "✗"}`,
          ""
        );
      } else {
        atualizarProgresso("Teste falhou: " + r.erro, "erro");
      }
    });

    el.btnDisparar.addEventListener("click", iniciarDisparo);
    el.btnPausar.addEventListener("click", pausarDisparo);
    el.btnRetomar.addEventListener("click", retomarDisparo);
    el.btnParar.addEventListener("click", pararDisparo);
    el.btnEmergencia.addEventListener("click", emergencia);

    await preencherConfig();
    await renderizarLeads();
    await renderizarLog();
    await atualizarStats();

    const stats = await Storage.get(AC_STORAGE.STATS, null);
    if (stats && stats.fila && stats.fila.length && stats.total > (stats.enviados || 0)) {
      atualizarProgresso(`Disparo pausado em ${stats.enviados || 0} de ${stats.total}. Clique em "Disparar fila" pra retomar.`, "pausado");
    } else {
      atualizarProgresso("Pronto pra disparar.", "");
    }
  }

  init().catch((e) => {
    console.error(e);
    alert("Erro ao iniciar o painel: " + e.message);
  });
})();
