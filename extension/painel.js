// painel.js - painel da extensão.
// Disparador puro de mensagens prontas: importa CSV (nome, telefone, empresa,
// mensagem_1..N), envia exatamente o conteúdo do arquivo, na ordem das colunas,
// sem criar/reescrever/adaptar nenhuma mensagem. Mantém a camada anti-ban.

(() => {
  "use strict";

  // ---------- Constantes e storage ----------

  const Storage = {
    async get(key, fallback) {
      try {
        const o = await chrome.storage.local.get(key);
        return o[key] !== undefined ? o[key] : fallback;
      } catch (e) {
        console.error("[AbrirConversas] falha ao ler storage:", e);
        return fallback;
      }
    },
    async set(key, val) {
      try {
        await chrome.storage.local.set({ [key]: val });
      } catch (e) {
        console.error("[AbrirConversas] falha ao gravar storage:", e);
        throw e;
      }
    },
  };

  const PERFIS = {
    conservador: { intervaloMin: 45, intervaloMax: 120, limiteDiario: 20, limiteSemanal: 120, pausaCada: 6, pausaMin: 4, pausaMax: 8, msgIntervaloMin: 60, msgIntervaloMax: 180 },
    moderado: { intervaloMin: 30, intervaloMax: 75, limiteDiario: 40, limiteSemanal: 250, pausaCada: 10, pausaMin: 5, pausaMax: 10, msgIntervaloMin: 45, msgIntervaloMax: 120 },
    livre: { intervaloMin: 20, intervaloMax: 45, limiteDiario: 60, limiteSemanal: 400, pausaCada: 20, pausaMin: 5, pausaMax: 10, msgIntervaloMin: 30, msgIntervaloMax: 75 },
  };

  const CONFIG_PADRAO = Object.assign(
    {
      perfil: "conservador",
      janelaInicio: "09:00",
      janelaFim: "18:00",
      janelaInvalida: false,
      ignorarJanela: false,
      pausaAlmoco: true,
      almocoInicio: "12:00",
      almocoFim: "13:30",
      pausaAuto: true,
      embaralhar: true,
      simularDigitacao: true,
      aquecimento: true,
      ignorarLimites: false,
    },
    PERFIS.conservador
  );

  // ---------- Elementos ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    areaUpload: $("areaUpload"),
    inputCsv: $("inputCsv"),
    textoUpload: $("textoUpload"),
    inputImportar: $("inputImportar"),
    btnExportar: $("btnExportar"),
    btnLimpar: $("btnLimpar"),
    btnResetarEnviados: $("btnResetarEnviados"),
    tabela: $("tabela"),
    corpoTabela: $("corpoTabela"),
    vazio: $("vazio"),
    contador: $("contador"),
    disparoProgresso: $("disparoProgresso"),
    statsLinha: $("statsLinha"),
    logBox: $("logBox"),
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
      msgIntervaloMin: $("cfgMsgIntervaloMin"),
      msgIntervaloMax: $("cfgMsgIntervaloMax"),
      limiteDiario: $("cfgLimiteDiario"),
      limiteSemanal: $("cfgLimiteSemanal"),
      ignorarLimites: $("cfgIgnorarLimites"),
      janelaInicio: $("cfgJanelaInicio"),
      janelaFim: $("cfgJanelaFim"),
      ignorarJanela: $("cfgIgnorarJanela"),
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
    c.msgIntervaloMin = parseInt(el.cfg.msgIntervaloMin.value, 10) || 60;
    c.msgIntervaloMax = parseInt(el.cfg.msgIntervaloMax.value, 10) || 180;
    c.limiteDiario = parseInt(el.cfg.limiteDiario.value, 10) || 20;
    c.limiteSemanal = parseInt(el.cfg.limiteSemanal.value, 10) || 120;
    c.janelaInicio = ini;
    c.janelaFim = fim;
    c.ignorarJanela = el.cfg.ignorarJanela.checked;
    c.janelaInvalida = c.ignorarJanela || hhmmParaMin(ini) >= hhmmParaMin(fim);
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
    c.ignorarLimites = el.cfg.ignorarLimites.checked;
    await salvarConfig(c);
  }

  // ---------- CSV e leads (lista pronta) ----------

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

  // Detecta nome, telefone, empresa e TODAS as colunas de mensagem
  // (mensagem, mensagem_1, mensagem_2 ... mensagem_N), na ordem do CSV.
  function detectarColunas(cabecalho) {
    const minusculo = cabecalho.map((h) => String(h).trim().toLowerCase());
    const find = (arr) => minusculo.findIndex((h) => arr.includes(h));
    const idxMsg = [];
    for (let i = 0; i < minusculo.length; i++) {
      if (/^mensagem(?:_?\d+)?$/.test(minusculo[i])) idxMsg.push(i);
    }
    return {
      idxNome: find(["nome", "title", "name"]),
      idxTelefone: find(["telefone", "phoneunformatted", "phone", "telefone_formatado"]),
      idxEmpresa: find(["empresa", "company", "negocio", "negócio", "business"]),
      idxMsg,
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
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  async function lerLeads() {
    return await Storage.get(AC_STORAGE.LEADS, []);
  }
  async function salvarLeads(leads) {
    await Storage.set(AC_STORAGE.LEADS, leads);
  }

  // ---------- Números já enviados (registry global, independente do CSV) ----------

  // { telefone: "ISO" } — data em que a mensagem foi enviada pela primeira vez.
  async function lerEnviados() {
    const o = await Storage.get(AC_STORAGE.ENVIADOS, {});
    return o && typeof o === "object" ? o : {};
  }
  // Registra o telefone como "já enviado" mantendo a data mais antiga (não
  // sobrescreve um envio anterior).
  async function registrarEnviado(telefone) {
    if (!telefone) return;
    const o = await lerEnviados();
    if (o[telefone]) return;
    o[telefone] = new Date().toISOString();
    await Storage.set(AC_STORAGE.ENVIADOS, o);
  }
  async function resetarEnviados() {
    if (!confirm("Resetar o histórico de 'já enviados'? Os leads marcados como enviado voltam pra pendente e poderão ser reenviados.")) return;
    await Storage.set(AC_STORAGE.ENVIADOS, {});
    const leads = await lerLeads();
    let resetados = 0;
    for (const l of leads) {
      if (l.telefone && l.status === "enviado" && (l.mensagens || []).length) {
        l.status = "pendente";
        l.enviada = false;
        l.enviadaEm = null;
        resetados++;
      }
    }
    await salvarLeads(leads);
    await adicionarLog("Histórico de enviados resetado — " + resetados + " lead(s) voltaram pra pendente.", false);
    await renderizarLeads();
    return resetados;
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
    if (!cols.idxMsg.length) {
      el.textoUpload.textContent = "Erro: não encontrei colunas de mensagem (mensagem_1, mensagem_2, ...).";
      return;
    }

    const atuais = await lerLeads();
    const statusAntigo = {};
    for (const l of atuais) if (l.telefone) statusAntigo[l.telefone] = l;

    const leads = [];
    const vistos = new Set();
    let semTelefoneCount = 0;
    let semMensagemCount = 0;
    // Números já enviados em algum CSV anterior (registry global) — mesmo se o
    // lead não estiver mais na lista, o telefone não pode ser reenviado.
    const enviados = await lerEnviados();
    for (let i = 1; i < linhas.length; i++) {
      const linha = linhas[i];
      const nome = (linha[cols.idxNome] || "").trim();
      if (!nome) continue;
      const telefone = formatarTelefone(linha[cols.idxTelefone]);
      const semTelefone = !telefone;
      if (semTelefone) {
        semTelefoneCount++;
      } else {
        if (vistos.has(telefone)) continue;
        vistos.add(telefone);
      }
      // Mensagens: somente o conteúdo real das células, na ordem das colunas.
      const mensagens = cols.idxMsg
        .map((j) => (linha[j] || "").trim())
        .filter((m) => m.length > 0);
      if (!mensagens.length) semMensagemCount++;
      const antigo = !semTelefone ? statusAntigo[telefone] : null;
      const statusBase =
        semTelefone || !mensagens.length ? "ignorado" : "pendente";
      const jaEnviado = !semTelefone && enviados[telefone];
      leads.push({
        id: (telefone || "semtel-" + i) + "-" + i,
        nome,
        empresa: cols.idxEmpresa !== -1 ? (linha[cols.idxEmpresa] || "").trim() || null : null,
        telefone: telefone || null,
        semTelefone,
        mensagens,
        // Registry global tem precedência: número já enviado antes (em outro
        // CSV/nome) fica "enviado", nunca volta pra "pendente".
        status: jaEnviado
          ? "enviado"
          : antigo && antigo.status !== "pendente" && antigo.status !== undefined
            ? antigo.status
            : statusBase,
        erroEm: antigo ? antigo.erroEm : null,
        enviada: !!jaEnviado || !!(antigo && antigo.enviada) || (antigo && antigo.status === "enviado"),
        enviadaEm: jaEnviado ? enviados[telefone] : antigo ? antigo.enviadaEm : null,
        naoEncontrado: !!(antigo && antigo.naoEncontrado),
        naoEncontradoEm: antigo ? antigo.naoEncontradoEm : null,
      });
    }

    await salvarLeads(leads);
    const avisos = [];
    if (semTelefoneCount) avisos.push(semTelefoneCount + " sem telefone");
    if (semMensagemCount) avisos.push(semMensagemCount + " sem mensagem");
    el.textoUpload.textContent =
      "Clique aqui ou arraste outro CSV pra substituir a lista" +
      (avisos.length ? " (" + avisos.join(" · ") + " ficam fora do disparo)" : "");
    await renderizarLeads();
  }

  // ---------- Renderização ----------

  const STATUS_RENDER = {
    pendente: { rotulo: "Pendente", cls: "st-pendente" },
    enviando: { rotulo: "Enviando…", cls: "st-enviando" },
    enviado: { rotulo: "Enviado", cls: "st-enviado" },
    erro: { rotulo: "Erro", cls: "st-erro" },
    ignorado: { rotulo: "Ignorado", cls: "st-ignorado" },
  };

  function montarLinha(lead) {
    const tr = document.createElement("tr");
    tr.dataset.id = lead.id;
    const naoAchado = !!lead.naoEncontrado;
    if (lead.status === "enviado") tr.classList.add("enviada");
    if (naoAchado) tr.classList.add("nao-encontrado");
    else if (lead.status === "erro") tr.classList.add("erro-envio");
    if (lead.status === "ignorado" || lead.semTelefone) tr.classList.add("sem-telefone");

    const stay = (lead.status || "pendente") in STATUS_RENDER ? lead.status : "pendente";
    const badge = naoAchado
      ? { rotulo: "Número não encontrado ✗", cls: "st-nao-encontrado" }
      : STATUS_RENDER[stay];
    const statusTxt = lead.semTelefone
      ? "Ignorado (sem telefone)"
      : lead.status === "ignorado" && !lead.mensagens.length
        ? "Ignorado (sem mensagem)"
        : badge ? badge.rotulo : stay;

    const msgsHtml =
      lead.mensagens && lead.mensagens.length
        ? `<div class="msgs-multi">${lead.mensagens
            .map((m, idx) => `<div>${idx + 1}. ${escaparHtml(m.length > 90 ? m.slice(0, 90) + "…" : m)}</div>`)
            .join("")}</div>`
        : "-";

    let acao;
    if (lead.semTelefone || lead.status === "ignorado") {
      acao = `<button class="nao-encontrado" disabled>Fora do disparo</button>`;
    } else if (lead.status === "enviado" || naoAchado) {
      acao = `<button class="nao-encontrado" disabled>${naoAchado ? "Número não encontrado ✗" : "Enviada ✓"}</button>`;
    } else if (estado.rodando) {
      // Durante o disparo, os botões de linha ficam desabilitados — editar um
      // lead manualmente no meio da rodada seria sobrescrito pelo snapshot
      // local do processarFila no próximo gravarEstado.
      acao = `<button class="nao-encontrado" disabled>Em disparo…</button>`;
    } else {
      const abrir = `<button class="reabrir" data-acao="abrir" data-id="${escaparHtml(lead.id)}">${lead.aberto ? "Reabrir" : "Abrir"} manual</button>`;
      const enviar = `<button class="enviar" data-acao="enviar" data-id="${escaparHtml(lead.id)}">Marcar enviada</button>`;
      const invalido = `<button class="nao-encontrado" data-acao="invalido" data-id="${escaparHtml(lead.id)}">Número não encontrado</button>`;
      acao = abrir + enviar + invalido;
    }

    tr.innerHTML = `
      <td data-label="Nome">${escaparHtml(lead.nome)}</td>
      <td data-label="Empresa">${escaparHtml(lead.empresa || "-")}</td>
      <td data-label="Telefone">${escaparHtml(lead.telefone || "sem telefone")}</td>
      <td data-label="Mensagens">${msgsHtml}</td>
      <td data-label="Status"><span class="status ${badge ? badge.cls : ""}">${escaparHtml(statusTxt)}</span></td>
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

    const enviados = leads.filter((l) => l.status === "enviado").length;
    const pendentes = leads.filter((l) => l.status === "pendente").length;
    const naoAchados = leads.filter((l) => l.naoEncontrado).length;
    const erros = leads.filter((l) => l.status === "erro" && !l.naoEncontrado).length;
    const ignorados = leads.filter((l) => l.status === "ignorado").length;
    el.contador.textContent =
      `${enviados} enviados · ${pendentes} pendentes · ${erros} com erro · ${naoAchados} não encontrados · ${ignorados} ignorados · ${leads.length} no total`;

    el.corpoTabela.innerHTML = "";
    for (const lead of leads) {
      el.corpoTabela.appendChild(montarLinha(lead));
    }
  }

  async function atualizarLinha(id, leadsRef) {
    const leads = leadsRef || (await lerLeads());
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    const existente = el.corpoTabela.querySelector(`tr[data-id="${id}"]`);
    if (existente) existente.replaceWith(montarLinha(lead));
  }

  // Marca o lead como erro e atualiza a linha — sai do status "enviando" (o
  // resume só pega "pendente"; sem isso o lead ficaria preso pra sempre).
  function marcarErro(lead, id, leads) {
    Object.assign(lead, { status: "erro", erroEm: new Date().toISOString() });
    atualizarLinha(id, leads);
  }

  // Detalha a resposta de "conversa-errada" (vinda do content-whatsapp com
  // motivo/headers/nav) pra o log indicar se a busca não navegou (4c) ou se
  // abriu um chat com número diferente no header (4e) — sem isso o log só
  // mostrava "conversa-errada" sem como distinguir as causas.
  function detalharConversaErrada(resp) {
    const motivo =
      resp && resp.motivo === "header-nao-mudou"
        ? "header não mudou (busca não navegou)"
        : resp && resp.motivo === "numero-diferente-no-header"
          ? "header mostra número diferente do lead"
          : "causa desconhecida";
    const partes = [motivo];
    if (resp && resp.headerAntes) partes.push("antes=" + JSON.stringify(resp.headerAntes));
    if (resp && resp.headerDepois) partes.push("depois=" + JSON.stringify(resp.headerDepois));
    const nav = resp && resp.nav;
    if (nav) {
      partes.push("clique=" + (nav.metodo || "nenhum") + (nav.abriu ? " (abriu)" : " (não abriu)"));
      if (nav.textoAlvo) partes.push("alvo=" + JSON.stringify(nav.textoAlvo));
    }
    return partes.join(" · ");
  }

  async function persistirLead(id, campos) {
    const leads = await lerLeads();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return null;
    Object.assign(lead, campos);
    await salvarLeads(leads);
    return lead;
  }

  // ---------- Modal manual (aplica-se normalmente pra 1ª mensagem) ----------

  async function abrirModal(id) {
    const leads = await lerLeads();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    el.modalMsg.value = (lead.mensagens && lead.mensagens[0]) || "";
    el.modalTitulo.textContent = "Conversa com " + lead.nome;
    el.modalBtnAbrir.dataset.id = id;
    if (typeof el.modal.showModal === "function") el.modal.showModal();
    else el.modal.setAttribute("open", "");
    el.modalMsg.focus();
  }

  function fecharModal() {
    if (typeof el.modal.close === "function") el.modal.close();
    else el.modal.removeAttribute("open");
  }

  async function abrirWhatsAppManual(id) {
    const leads = await lerLeads();
    const lead = leads.find((l) => l.id === id);
    if (!lead || !lead.telefone) return;
    const mensagem = el.modalMsg.value;
    const link = `https://wa.me/${lead.telefone}?text=${encodeURIComponent(mensagem)}`;
    window.open(link, "_blank");
    fecharModal();
    await persistirLead(id, { aberto: true, abertoEm: new Date().toISOString() });
    await renderizarLeads();
  }

  async function marcarEnviada(id) {
    const lead = await persistirLead(id, { status: "enviado", enviada: true, enviadaEm: new Date().toISOString() });
    if (lead && lead.telefone) await registrarEnviado(lead.telefone);
    await renderizarLeads();
  }
  async function marcarInvalido(id) {
    await persistirLead(id, {
      status: "erro",
      naoEncontrado: true,
      naoEncontradoEm: new Date().toISOString(),
      erroEm: new Date().toISOString(),
    });
    await renderizarLeads();
  }

  // ---------- Backup ----------

  async function exportarBackup() {
    const leads = await lerLeads();
    const enviados = await lerEnviados();
    const conteudo = JSON.stringify({ versao: 2, leads, enviados }, null, 2);
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
    let texto;
    try {
      texto = await arquivo.text();
    } catch (e) {
      alert("Erro: não consegui ler o arquivo.");
      return;
    }
    let importados;
    let enviadosImport = null;
    try {
      const parsed = JSON.parse(texto);
      if (Array.isArray(parsed)) {
        importados = parsed; // backup antigo: lista direta de leads
      } else if (parsed && Array.isArray(parsed.leads)) {
        importados = parsed.leads;
        if (parsed.enviados && typeof parsed.enviados === "object") enviadosImport = parsed.enviados;
      } else {
        alert("Erro: formato inesperado (esperava uma lista de leads).");
        return;
      }
    } catch (e) {
      alert("Erro: arquivo não é um JSON válido.");
      return;
    }
    const sanitizar = (imp) => {
      const mensagens = Array.isArray(imp && imp.mensagens)
        ? imp.mensagens.filter((m) => typeof m === "string" && m.trim()).map((m) => String(m).trim())
        : [String((imp && imp.mensagem) || "").trim()].filter(Boolean);
      const telefone = String((imp && imp.telefone) || "").replace(/\D/g, "");
      return {
        id: String((imp && imp.id) || "").replace(/[^A-Za-z0-9-]/g, "") || "lead-" + Math.random().toString(36).slice(2, 8),
        nome: String((imp && imp.nome) || "").slice(0, 300),
        empresa: String((imp && imp.empresa) || "").slice(0, 300) || null,
        telefone,
        semTelefone: !telefone,
        mensagens,
        status: ["pendente", "enviado", "erro", "ignorado"].includes(imp && imp.status)
          ? imp.status
          : telefone && mensagens.length
            ? "pendente"
            : "ignorado",
        erroEm: (imp && imp.erroEm) || null,
        enviada: !!(imp && (imp.enviada || imp.status === "enviado")),
        enviadaEm: (imp && imp.enviadaEm) || null,
        naoEncontrado: !!(imp && imp.naoEncontrado),
        naoEncontradoEm: (imp && imp.naoEncontradoEm) || null,
        aberto: !!(imp && imp.aberto),
        abertoEm: (imp && imp.abertoEm) || null,
      };
    };
    const atuais = await lerLeads();
    const porTelefone = {};
    for (const l of atuais) if (l.telefone) porTelefone[l.telefone] = l;
    for (const imp of importados) {
      const limpo = sanitizar(imp);
      if (!limpo.telefone) continue;
      const ex = porTelefone[limpo.telefone];
      if (!ex) porTelefone[limpo.telefone] = limpo;
      else {
        const statusJunto =
          ex.status === "enviado" || limpo.status === "enviado"
            ? "enviado"
            : limpo.status === "erro" || ex.status === "erro"
              ? "erro"
              : limpo.status;
        porTelefone[limpo.telefone] = {
          ...limpo,
          status: statusJunto,
          enviada: ex.enviada || limpo.enviada,
          enviadaEm: ex.enviadaEm || limpo.enviadaEm,
          naoEncontrado: ex.naoEncontrado || limpo.naoEncontrado,
          naoEncontradoEm: ex.naoEncontradoEm || limpo.naoEncontradoEm,
          aberto: ex.aberto || limpo.aberto,
          abertoEm: ex.abertoEm || limpo.abertoEm,
        };
      }
    }
    const final = Object.values(porTelefone);
    await salvarLeads(final);
    // Mescla o registry de enviados (união por telefone, mantém data mais antiga).
    const enviados = await lerEnviados();
    if (enviadosImport) {
      for (const [tel, data] of Object.entries(enviadosImport)) {
        if (!tel || typeof data !== "string") continue;
        if (!enviados[tel]) enviados[tel] = data;
      }
    }
    // Leads do backup com status "enviado" entram no registry também.
    for (const l of final) {
      if (l.telefone && (l.status === "enviado" || l.enviada)) {
        if (!enviados[l.telefone]) enviados[l.telefone] = l.enviadaEm || new Date().toISOString();
      }
    }
    await Storage.set(AC_STORAGE.ENVIADOS, enviados);
    adicionarLog("Backup importado: " + importados.length + " leads mesclados.", false);
    await renderizarLeads();
  }

  async function limparLista() {
    if (!confirm("Limpar a lista de leads atual?")) return;
    await salvarLeads([]);
    await renderizarLeads();
  }

  // ---------- Log ----------

  // Único criador de entrada de log (formato + teto de 80) — reutilizado por
  // adicionarLog (grava no storage) e pelo logger local do processarFila
  // (grava no array em memória + debounce), evitando 3 implementações.
  function criarEmLog(log) {
    return (txt, erro) => {
      log.unshift({ t: new Date().toLocaleTimeString("pt-BR"), txt, erro: !!erro });
      if (log.length > 80) log.length = 80;
    };
  }

  async function adicionarLog(txt, erro) {
    const log = await Storage.get(AC_STORAGE.LOG, []);
    criarEmLog(log)(txt, erro);
    await Storage.set(AC_STORAGE.LOG, log);
    await renderizarLog();
  }

  async function renderizarLog(logRef) {
    // Só re-renderiza quando o usuário está vendo o log — o loop de disparo
    // chama isso a cada lead e reconstruir o innerHTML todo era caro.
    if (el.logBox && !el.logBox.open) return;
    const log = logRef || (await Storage.get(AC_STORAGE.LOG, []));
    el.logConteudo.innerHTML = log
      .map((e) => `<div class="${e.erro ? "erro" : ""}">[${escaparHtml(e.t)}] ${escaparHtml(e.txt)}</div>`)
      .join("\n") || "(sem registros ainda)";
  }

  // ---------- Contadores de limites (camada anti-ban) ----------

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

  // ---------- Tempo ----------

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

  async function prepararRodada() {
    const config = await lerConfig();
    estado.cache.config = config;
    estado.cache.daily = await lerDiario();
    estado.cache.weekly = await lerSemana();
    estado.cache.teto = await tetoDiarioEfetivo(config);
    if (config.janelaInvalida) {
      await adicionarLog(
        config.ignorarJanela
          ? "Janela de horário ignorada (modo de testes ativo) — disparando fora dela."
          : "Janela de horário inválida (início >= fim) — ignorando janela neste disparo.",
        true
      );
    }
    return config;
  }

  async function checarLimites() {
    const c = estado.cache;
    // Modo de testes: ignora o teto diário e semanal.
    if (c.config && c.config.ignorarLimites) return { ok: true };
    // Virada de dia/semana NO MEIO da rodada: recarrega os contadores em vez de
    // continuar contando contra o dia anterior (disparo noturno que cruza 00:00
    // parava antes da hora, gastando o teto de ontem). Na virada do DIA também
    // recalcula o teto de aquecimento (ele cresce com os dias desde o início).
    if (c.daily.data !== hojeStr()) {
      c.daily = { data: hojeStr(), count: 0 };
      c.teto = await tetoDiarioEfetivo(c.config);
    }
    if (c.weekly.data !== semanaStr()) c.weekly = { data: semanaStr(), count: 0 };
    if (c.daily.count >= c.teto) return { ok: false, motivo: `Limite diário atingido (${c.daily.count}/${c.teto}).` };
    if (c.weekly.count >= c.config.limiteSemanal) return { ok: false, motivo: `Limite semanal atingido (${c.weekly.count}/${c.config.limiteSemanal}).` };
    return { ok: true };
  }

  async function obterTabWhats() {
    try {
      const r = await chrome.runtime.sendMessage({ action: AC_MSG.GET_WHATSAPP_TAB });
      return r && r.ok ? r.tabId : null;
    } catch (e) {
      return null;
    }
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

  async function aguardarComControle(ms, statusTxt, statusClasse = "pausado") {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      if (estado.parado) return false;
      if (estado.pausado) {
        atualizarProgresso("Pausado manualmente — clique em Retomar.", "pausado");
        await SLEEP(1000);
        continue;
      }
      const rest = Math.max(1, Math.round((fim - Date.now()) / 1000));
      atualizarProgresso(`${statusTxt} ${segParaHm(rest)}`, statusClasse);
      await SLEEP(1000);
    }
    return !estado.parado;
  }

  async function aguardarJanelaValida() {
    const config = estado.cache.config;
    if (config.janelaInvalida) return;
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

  // Envia a sequência de mensagens para o WhatsApp e devolve a resposta crua.
  // Centraliza o payload do SEND_SEQ (usado no envio normal e no retry de
  // "ocupado") — evita montar o objeto em 3 lugares do processarFila.
  // `intervaloEntreMsgs` é sorteado UMA vez pelo chamador e reusado no retry,
  // pra o timing humano dentro da conversa não mudar entre tentativa e retry.
  async function enviarSequencia(tabId, lead, mensagens, config, intervaloEntreMsgs) {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        action: AC_MSG.SEND_SEQ,
        telefone: lead.telefone,
        nome: lead.nome,
        mensagens,
        intervaloEntreMsgs,
        simulacao: config.simularDigitacao,
      });
    } catch (e) {
      // `comunicacao` sinaliza falha de transporte (não uma resposta do
      // content script) — permite distinguir de erros reais do WhatsApp.
      return { ok: false, erro: String(e), comunicacao: true };
    }
  }

  async function processarFila(filaIds, total, jaEnviados) {
    estado.fila = filaIds.slice();
    estado.enviadosRodada = jaEnviados || 0;
    estado.totalRodada = total;
    const tabId = estado.whatsTabId;
    const config = estado.cache.config;
    let desdeAuto = 0;

    const leads = await lerLeads();
    const porId = new Map(leads.map((l) => [l.id, l]));
    let log = await Storage.get(AC_STORAGE.LOG, []);
    const emLog = criarEmLog(log);
    // Registry de enviados acumulado nesta rodada: evita ler+gravar o objeto
    // inteiro a cada envio (era O(n²)); a gravação acontece junto do debounce.
    const enviadosAcumulado = { ...(await lerEnviados()) };
    // Gravação com debounce: o storage.local é caro com listas grandes e cada
    // envio persistia LEADS+LOG+STATS+DAILY+WEEKLY inteiros. O debounce agrupa
    // várias mudanças numa única transação; o flush é usado nos pontos de saída
    // (break/finally) pra garantir o estado final gravado antes de parar.
    let timerPersistir = null;
    const persistirEstado = () => {
      clearTimeout(timerPersistir);
      timerPersistir = setTimeout(gravarEstado, 400);
    };
    const flushPersistir = async () => {
      clearTimeout(timerPersistir);
      timerPersistir = null;
      await gravarEstado();
    };
    const gravarEstado = async () => {
      await chrome.storage.local.set({
        [AC_STORAGE.LEADS]: leads,
        [AC_STORAGE.LOG]: log,
        [AC_STORAGE.ENVIADOS]: enviadosAcumulado,
        [AC_STORAGE.STATS]: {
          fila: estado.fila.slice(),
          total: estado.totalRodada,
          enviados: estado.enviadosRodada,
          ativo: estado.rodando,
        },
        [AC_STORAGE.DAILY]: estado.cache.daily,
        [AC_STORAGE.WEEKLY]: estado.cache.weekly,
      });
    };
    // Mensagens de log emitidas no meio da rodada: gravam no array local (não
    // via adicionarLog, que grava no storage direto e seria sobrescrito pelo
    // flush). O debounce agrupa; o flush final garante a persistência.
    const logarLocal = (txt, erro) => {
      emLog(txt, erro);
      persistirEstado();
      renderizarLog(log);
    };

    try {
      let ultimoEnviou = false;
      while (estado.fila.length && !estado.parado) {
        const lim = await checarLimites();
        if (!lim.ok) {
          logarLocal(lim.motivo, true);
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
        const lead = porId.get(id);
        if (!lead || lead.status === "enviado" || lead.status === "erro" || lead.status === "ignorado" || lead.semTelefone) {
          estado.fila.shift();
          await salvarStats();
          continue;
        }

        // Envia EXATAMENTE o que está no CSV (nenhuma transformação no texto).
        const mensagens = (lead.mensagens || []).filter((m) => m && m.length > 0);
        if (!mensagens.length) {
          Object.assign(lead, { status: "ignorado", erroEm: null });
          estado.fila.shift();
          await persistirEstado();
          continue;
        }

        atualizarProgresso(
          `Enviando ${mensagens.length} mensagens para ${lead.nome} (${estado.enviadosRodada + 1} de ${total})…`,
          "disparando"
        );
        Object.assign(lead, { status: "enviando" });
        await persistirEstado();
        atualizarLinha(id, leads);

        // Intervalo entre mensagens sorteado UMA vez por lead — o retry de
        // "ocupado" reusa o mesmo valor (timing estável dentro da conversa).
        const intervaloEntreMsgs = intervaloHumano(config.msgIntervaloMin, config.msgIntervaloMax);

        let resp = await enviarSequencia(tabId, lead, mensagens, config, intervaloEntreMsgs);
        if (resp && resp.comunicacao) {
          if (/Receiving end does not exist|Could not establish connection/.test(resp.erro)) {
            marcarErro(lead, id, leads);
            logarLocal("Aba do WhatsApp inacessível (fechada ou recarregada) — encerrando a rodada.", true);
            estado.parado = true;
            break;
          }
          logarLocal("Falha de comunicação com o WhatsApp: " + resp.erro, true);
        }

        // "ocupado" = content script ainda finalizando um envio anterior (ex.:
        // painel recarregado no meio do disparo). Transitório: tenta de novo
        // com backoff em vez de marcar o lead como erro espúrio — sequências
        // longas demoram mais de 3s pra liberar o lock. Usa aguardarComControle
        // (e não SLEEP) pra Parar/Pausar responder imediatamente.
        for (let t = 0; t < 5 && resp && resp.erro === "ocupado" && !estado.parado; t++) {
          if (!(await aguardarComControle(3000 + t * 2000, "Aguardando WhatsApp liberar…", "aguardando"))) {
            logarLocal("Parado/Pausado durante o retry de envio — lead marcado como erro.", true);
            break;
          }
          resp = await enviarSequencia(tabId, lead, mensagens, config, intervaloEntreMsgs);
        }

        // Aba fechada/recarregada DURANTE o backoff: trata como inacessível em
        // vez de erro genérico (evita lead preso em "enviando" sem encerrar).
        if (resp && resp.comunicacao && /Receiving end does not exist|Could not establish connection/.test(resp.erro)) {
          marcarErro(lead, id, leads);
          logarLocal("Aba do WhatsApp inacessível (fechada ou recarregada) — encerrando a rodada.", true);
          estado.parado = true;
          break;
        }

        estado.fila.shift();

        if (resp && resp.ok) {
          const quantas = typeof resp.enviadas === "number" ? resp.enviadas : mensagens.length;
          estado.cache.daily.count += quantas;
          estado.cache.weekly.count += quantas;
          Object.assign(lead, {
            status: "enviado",
            enviada: true,
            enviadaEm: new Date().toISOString(),
            erroEm: null,
            naoEncontrado: false,
          });
          estado.enviadosRodada++;
          ultimoEnviou = true;
          if (lead.telefone && !enviadosAcumulado[lead.telefone]) {
            enviadosAcumulado[lead.telefone] = new Date().toISOString();
          }
          emLog(`✓ ${lead.nome} (${lead.telefone}) — ${quantas} mensagem(ns) enviada(s)`);
          atualizarLinha(id, leads);
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
        } else {
          const erro = resp && resp.erro ? resp.erro : "sem-resposta";
          // Só "numero-invalido" é DEFINITIVO (a tela de vazio apareceu —
          // regra do usuário: vazio = não existe). "compose-nao-encontrado" e
          // "tela-nova-conversa-nao-confirmada" são falhas de NAVEGAÇÃO, não
          // prova de inexistência: caem no erro normal pra revisão manual em
          // vez de cinza ✗ permanente (nunca entram no registry).
          const naoAchou = erro === "numero-invalido";
          if (erro === "nao-logado") {
            marcarErro(lead, id, leads);
            emLog(`✗ ${lead.nome} — WhatsApp deslogado no meio do disparo.`, true);
            logarLocal("WhatsApp Web deslogou — encerrando a rodada. Escaneie o QR code e tente de novo.", true);
            estado.parado = true;
            break;
          }
          if (naoAchou) {
            Object.assign(lead, {
              status: "erro",
              naoEncontrado: true,
              naoEncontradoEm: new Date().toISOString(),
              erroEm: new Date().toISOString(),
            });
            atualizarLinha(id, leads);
            emLog(`✗ ${lead.nome} — número não encontrado`, true);
          } else {
            // Abortado ou qualquer outro erro: sai do status "enviando" — sem
            // isso o lead ficaria preso (o resume só pega "pendente").
            marcarErro(lead, id, leads);
            if (erro === "abortado") emLog(`⏹ ${lead.nome} — envio abortado pelo usuário`, true);
            else if (erro === "conversa-errada") {
              emLog(`✗ ${lead.nome} — conversa errada/não navegou: ${detalharConversaErrada(resp)}`, true);
            } else emLog(`✗ ${lead.nome} — erro de envio (${erro})`, true);
          }
        }

        try {
          // Flush por lead é deliberado: garante que o status "enviado" do
          // último lead já esteja persistido antes do próximo — se o painel
          // morrer aqui, o resume não reenvia (anti-duplicata). O debounce
          // ainda agrupa as transições de status dentro de um mesmo lead.
          await flushPersistir();
        } catch (e) {
          emLog(`Falha ao salvar estado (${String(e)}) — encerrando pra evitar reenvio.`, true);
          estado.parado = true;
        }
        await renderizarLog(log);
        if (estado.parado) break;

        // Pausa entre leads SÓ depois de uma mensagem enviada de verdade —
        // número não encontrado/erro pula direto pro próximo (o envio real já
        // não ocorreu, não há o que "esfriar").
        if (ultimoEnviou && estado.fila.length && !estado.parado) {
          ultimoEnviou = false;
          const waitMs = intervaloHumano(config.intervaloMin, config.intervaloMax);
          const okInt = await aguardarComControle(waitMs, `Próximo em`);
          if (!okInt) break;
        }
      }
    } finally {
      estado.rodando = false;
      estado.parado = false;
      estado.pausado = false;
      atualizarProgresso("Disparo concluído ou interrompido.", "");
      // Garante que o último estado (fila, leads, contadores) seja gravado
      // mesmo que o loop tenha saído por break dentro da janela do debounce.
      try {
        await flushPersistir();
      } catch (e) {
        /* estado final não persistido — segue para salvarStats abaixo */
      }
      await salvarStats();
      await atualizarStats();
      // Re-renderiza com os botões de linha reabilitados (estado.rodando=false)
      // — sem isso a tabela ficaria presa em "Em disparo…" até recarregar.
      await renderizarLeads();
      renderizarBotoes();
    }
  }

  async function atualizarStats() {
    if (!estado.cache.config) await prepararRodada();
    const c = estado.cache;
    el.statsLinha.textContent =
      `Hoje: ${c.daily.count}/${c.teto} · Semana: ${c.weekly.count}/${c.config.limiteSemanal} · ` +
      `Rodada: ${estado.enviadosRodada} de ${estado.totalRodada || 0}`;
  }

  let iniciando = false;
  async function iniciarDisparo() {
    if (estado.rodando || iniciando) return;
    iniciando = true;
    try {
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
      const porId = new Map(leads.map((l) => [l.id, l]));

      const stats = await Storage.get(AC_STORAGE.STATS, null);
      let filaIds;
      let total;
      let jaEnviados;
      if (stats && stats.fila && stats.fila.length) {
        const pendentes = stats.fila.filter((id) => {
          const l = porId.get(id);
          return l && l.status === "pendente" && !l.semTelefone && (l.mensagens || []).length;
        });
        if (pendentes.length) {
          filaIds = pendentes;
          total = stats.total || pendentes.length;
          jaEnviados = stats.enviados || 0;
        }
      }
      if (!filaIds) {
        const pendentes = leads.filter(
          (l) => l.status === "pendente" && !l.semTelefone && (l.mensagens || []).length
        );
        if (!pendentes.length) {
          atualizarProgresso("Nenhum lead pendente pra disparar (todos enviados, com erro, ignorados ou já disparados).", "");
          return;
        }
        if (config.embaralhar) {
          for (let i = pendentes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pendentes[i], pendentes[j]] = [pendentes[j], pendentes[i]];
          }
        }
        filaIds = pendentes.map((l) => l.id);
        total = filaIds.length;
        jaEnviados = 0;
      }

      estado.fila = filaIds.slice();
      estado.rodando = true;
      estado.parado = false;
      estado.pausado = false;
      // Re-renderiza com os botões desabilitados ("Em disparo…") já no início —
      // sem isso, um clique manual nos primeiros segundos seria sobrescrito
      // pelo snapshot local do processarFila.
      await renderizarLeads();
      await adicionarLog(`Iniciando disparo com ${filaIds.length} leads.`, false);
      await salvarStats();
      await atualizarStats();
      await processarFila(filaIds, total, jaEnviados);
    } finally {
      iniciando = false;
    }
  }

  async function pausarDisparo() {
    estado.pausado = true;
    atualizarProgresso("Pausado manualmente — clique em Retomar.", "pausado");
    await salvarStats();
  }

  async function retomarDisparo() {
    if (iniciando) return;
    if (estado.rodando && estado.pausado) {
      estado.pausado = false;
      atualizarProgresso("Retomando…", "disparando");
    }
  }

  function pararDisparo() {
    estado.parado = true;
    estado.pausado = false;
    atualizarProgresso("Parando…", "erro");
    avisarAbortAoWhats();
  }

  function emergencia() {
    estado.parado = true;
    estado.pausado = false;
    atualizarProgresso("EMERGÊNCIA — disparo interrompido instantaneamente.", "erro");
    avisarAbortAoWhats();
  }

  function avisarAbortAoWhats() {
    if (!estado.whatsTabId) return;
    chrome.tabs
      .sendMessage(estado.whatsTabId, { action: AC_MSG.ABORT })
      .catch(() => {});
  }

  function lerCsv(file) {
    const r = new FileReader();
    r.onload = () => {
      // CSVs exportados por Excel/planilhas brasileiras costumam vir em
      // ANSI/CP1252 — ler como UTF-8 estrito quebra os acentos (ã vira "Ã£")
      // e o nome do contato deixa de bater na busca do WhatsApp. Tenta UTF-8
      // estrito primeiro; se falhar (bytes inválidos), decodifica como
      // windows-1252, que aceita qualquer byte e preserva os acentos.
      let texto;
      try {
        texto = new TextDecoder("utf-8", { fatal: true }).decode(r.result);
      } catch (e) {
        texto = new TextDecoder("windows-1252").decode(r.result);
      }
      processarCSV(texto);
    };
    r.onerror = () => { el.textoUpload.textContent = "Erro ao ler o arquivo."; };
    r.readAsArrayBuffer(file);
  }

  // ---------- Eventos ----------

  // Bloqueia ações de dados (importar CSV, importar/limpar/resetar backup)
  // durante o disparo: o processarFila mantém um snapshot local de `leads` e o
  // próximo gravarEstado sobrescreveria qualquer mudança feita na barra.
  const rolando = () => {
    if (estado.rodando) {
      atualizarProgresso("Aguardando o disparo terminar antes de alterar a lista…", "pausado");
      return true;
    }
    return false;
  };

  async function init() {
    el.inputCsv.addEventListener("change", () => {
      if (rolando()) { el.inputCsv.value = ""; return; }
      if (el.inputCsv.files[0]) lerCsv(el.inputCsv.files[0]);
    });

    el.areaUpload.addEventListener("click", (e) => {
      if (e.target === el.inputCsv) return;
      if (rolando()) return;
      el.inputCsv.click();
    });
    el.areaUpload.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.areaUpload.classList.add("arrastando");
    });
    el.areaUpload.addEventListener("dragleave", () => el.areaUpload.classList.remove("arrastando"));
    el.areaUpload.addEventListener("drop", (e) => {
      e.preventDefault();
      el.areaUpload.classList.remove("arrastando");
      if (rolando()) return;
      const f = e.dataTransfer.files[0];
      if (f) lerCsv(f);
    });

    el.inputImportar.addEventListener("change", () => {
      if (rolando()) { el.inputImportar.value = ""; return; }
      if (el.inputImportar.files[0]) importarBackup(el.inputImportar.files[0]);
    });
    el.btnExportar.addEventListener("click", () => { if (!rolando()) exportarBackup(); });
    el.btnLimpar.addEventListener("click", () => { if (!rolando()) limparLista(); });
    el.btnResetarEnviados.addEventListener("click", () => { if (!rolando()) resetarEnviados(); });

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

    el.logBox.addEventListener("toggle", () => {
      if (el.logBox.open) renderizarLog();
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
    // Saneamento: leads presos em "enviando" (painel fechado/recarregado no
    // meio do disparo) viram "erro" pra revisão manual — NUNCA voltam pra
    // "pendente", porque o content script pode ter terminado o envio sem o
    // registry ENVIADOS ser atualizado; reenviar daria mensagem duplicada.
    const leadsIniciais = await lerLeads();
    let ressinc = false;
    for (const l of leadsIniciais) {
      if (l.status === "enviando") {
        l.status = "erro";
        l.erroEm = new Date().toISOString();
        ressinc = true;
      }
    }
    if (ressinc) {
      await salvarLeads(leadsIniciais);
      await adicionarLog(
        "Disparo interrompido: leads em 'enviando' marcados como erro pra revisão manual (evita reenvio duplicado).",
        true
      );
    }
    await renderizarLeads();
    await renderizarLog();
    await atualizarStats();

    const stats = await Storage.get(AC_STORAGE.STATS, null);
    if (stats && stats.fila && stats.fila.length && stats.total > (stats.enviados || 0)) {
      atualizarProgresso(`Disparo pausado em ${stats.enviados || 0} de ${stats.total}. Clique em "Disparar fila" pra retomar.`, "pausado");
    } else if (ressinc) {
      atualizarProgresso(
        "⚠ Disparo interrompido: leads em 'enviando' ficaram como erro pra revisão. Confira no WhatsApp se a mensagem saiu antes de reenviar.",
        "erro"
      );
    } else {
      atualizarProgresso("Pronto pra disparar.", "");
    }
  }

  init().catch((e) => {
    console.error(e);
    alert("Erro ao iniciar o painel: " + e.message);
  });
})();