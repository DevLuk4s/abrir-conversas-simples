// app.js
// Tudo roda no navegador — sem servidor, sem banco de dados.
// Os leads e o status de cada um (aberto/enviada/número não encontrado)
// ficam salvos no localStorage deste navegador/aparelho específico.

const CHAVE_STORAGE = "abrirConversasLeads";
const CHAVE_MODELO = "abrirConversasModeloMensagem";
const MODELO_PADRAO = "Oi! Vi que a {NOME} não tem site próprio ainda — só o Google Maps mesmo. Posso te mandar um exemplo?";

const areaUpload = document.getElementById("areaUpload");
const inputCsv = document.getElementById("inputCsv");
const inputImportar = document.getElementById("inputImportar");
const textoImportar = document.getElementById("textoImportar");
const modeloMensagem = document.getElementById("modeloMensagem");
const textoUpload = document.getElementById("textoUpload");
const tabela = document.getElementById("tabela");
const corpoTabela = document.getElementById("corpoTabela");
const vazio = document.getElementById("vazio");
const contador = document.getElementById("contador");

// --- Leitura/escrita no localStorage ---
function lerLeads() {
  const bruto = localStorage.getItem(CHAVE_STORAGE);
  return bruto ? JSON.parse(bruto) : [];
}
function salvarLeads(leads) {
  localStorage.setItem(CHAVE_STORAGE, JSON.stringify(leads));
}

// --- Parser de CSV simples, mas que respeita campos entre aspas com vírgula dentro ---
// (necessário porque a planilha bruta do Apify tem campos assim)
function parseCSV(texto) {
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
      } else {
        campo += c;
      }
    } else {
      if (c === '"') dentroDeAspas = true;
      else if (c === ",") { linha.push(campo); campo = ""; }
      else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
      else if (c !== "\r") campo += c;
    }
  }
  if (campo.length || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Detecta as colunas relevantes, aceitando tanto o formato já convertido
// (nome,telefone) quanto o bruto do Apify/Google Maps (title,phone,reviewsCount,url...)
// e o formato do pipeline de prospecção (inclui Mensagem e Ângulo por lead)
function detectarColunas(cabecalho) {
  const minusculo = cabecalho.map((h) => h.trim().toLowerCase());
  const idxNome = minusculo.findIndex((h) => h === "nome" || h === "title" || h === "name");
  const idxTelefone = minusculo.findIndex(
    (h) => h === "telefone" || h === "phoneunformatted" || h === "phone"
  );
  const idxAvaliacoes = minusculo.findIndex(
    (h) => h === "avaliações" || h === "avaliacoes" || h === "reviewscount"
  );
  const idxUrl = minusculo.findIndex((h) => h === "url" || h === "link" || h === "googlemapsurl");
  const idxInstagram = minusculo.findIndex(
    (h) => h.includes("instagram") || h === "rede social" || h === "redesocial"
  );
  const idxMensagem = minusculo.findIndex((h) => h === "mensagem");
  const idxAngulo = minusculo.findIndex((h) => h === "ângulo" || h === "angulo");
  const idxBairro = minusculo.findIndex(
    (h) => h === "bairro/região" || h === "bairro" || h === "region"
  );
  const idxNota = minusculo.findIndex((h) => h === "nota");
  return { idxNome, idxTelefone, idxAvaliacoes, idxUrl, idxInstagram, idxMensagem, idxAngulo, idxBairro, idxNota };
}

// Limpa o telefone e garante o código do Brasil (55) na frente
// Números de 10-11 dígitos são tratados como BR local (ganham 55);
// os demais (já com código de país) são mantidos como estão.
function formatarTelefone(telefone) {
  let numeros = (telefone || "").replace(/\D/g, "");
  if (!numeros) return null;
  if (numeros.startsWith("0")) numeros = numeros.slice(1); // 0 + DDD (convenção antiga)
  if (numeros.startsWith("55")) return numeros;
  if (numeros.length >= 10 && numeros.length <= 11) numeros = "55" + numeros;
  return numeros;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}

// --- Modelo de mensagem (salvo separado dos leads, também no localStorage) ---
modeloMensagem.value = localStorage.getItem(CHAVE_MODELO) || MODELO_PADRAO;
modeloMensagem.addEventListener("input", () => {
  localStorage.setItem(CHAVE_MODELO, modeloMensagem.value);
});

// --- Upload do CSV ---
inputCsv.addEventListener("change", () => {
  if (inputCsv.files[0]) lerArquivo(inputCsv.files[0]);
});

areaUpload.addEventListener("dragover", (e) => {
  e.preventDefault();
  areaUpload.classList.add("arrastando");
});
areaUpload.addEventListener("dragleave", () => {
  areaUpload.classList.remove("arrastando");
});
areaUpload.addEventListener("drop", (e) => {
  e.preventDefault();
  areaUpload.classList.remove("arrastando");
  const arquivo = e.dataTransfer.files[0];
  if (arquivo) lerArquivo(arquivo);
});

function lerArquivo(arquivo) {
  const leitor = new FileReader();
  leitor.onload = () => processarCSV(leitor.result);
  leitor.readAsText(arquivo, "utf-8");
}

function processarCSV(texto) {
  texto = texto.replace(/^\uFEFF/, ""); // remove BOM se tiver
  const linhas = parseCSV(texto);
  if (linhas.length < 2) {
    textoUpload.textContent = "Erro: CSV vazio ou sem dados";
    return;
  }

  const cabecalho = linhas[0];
  const { idxNome, idxTelefone, idxAvaliacoes, idxUrl, idxInstagram, idxMensagem, idxAngulo, idxBairro, idxNota } = detectarColunas(cabecalho);
  if (idxNome === -1 || idxTelefone === -1) {
    textoUpload.textContent = "Erro: não encontrei colunas de nome/telefone (esperado: nome,telefone ou title,phone)";
    return;
  }

  // Guarda o status atual de cada lead (por telefone) antes de sobrescrever,
  // pra não perder o progresso se o mesmo CSV for subido de novo
  const statusAntigoPorTelefone = {};
  for (const lead of lerLeads()) {
    statusAntigoPorTelefone[lead.telefone] = lead;
  }

  const leads = [];
  const telefonesVistos = new Set();
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const nome = (linha[idxNome] || "").trim();
    const telefoneFormatado = formatarTelefone(linha[idxTelefone]);
    if (!nome || !telefoneFormatado) continue;
    if (telefonesVistos.has(telefoneFormatado)) continue; // dedup: mesmo telefone 1x só
    telefonesVistos.add(telefoneFormatado);

    const antigo = statusAntigoPorTelefone[telefoneFormatado];
    const avaliacoes = idxAvaliacoes !== -1 ? parseInt((linha[idxAvaliacoes] || "0").replace(/\D/g, ""), 10) || 0 : 0;
    const mapsUrl = idxUrl !== -1 ? (linha[idxUrl] || "").trim() || null : null;
    const instagram = idxInstagram !== -1 ? (linha[idxInstagram] || "").trim() || null : null;

    leads.push({
      id: `${telefoneFormatado}-${i}`,
      nome,
      telefone: telefoneFormatado,
      avaliacoes,
      mapsUrl,
      instagram,
      mensagem: idxMensagem !== -1 ? (linha[idxMensagem] || "").trim() || null : null,
      angulo: idxAngulo !== -1 ? (linha[idxAngulo] || "").trim() || null : null,
      bairroRegiao: idxBairro !== -1 ? (linha[idxBairro] || "").trim() || null : null,
      nota: idxNota !== -1 ? (linha[idxNota] || "").trim() || null : null,
      aberto: antigo ? antigo.aberto : false,
      abertoEm: antigo ? antigo.abertoEm : null,
      enviada: antigo ? antigo.enviada : false,
      enviadaEm: antigo ? antigo.enviadaEm : null,
      naoEncontrado: antigo ? antigo.naoEncontrado : false,
      naoEncontradoEm: antigo ? antigo.naoEncontradoEm : null,
    });
  }

  salvarLeads(leads);
  textoUpload.textContent = "Clique aqui ou arraste outro CSV pra substituir a lista";
  renderizarLeads(leads);
}

// --- Renderização da tabela ---
function renderizarLeads(leads) {
  if (!leads.length) {
    tabela.style.display = "none";
    vazio.style.display = "block";
    contador.textContent = "";
    return;
  }

  vazio.style.display = "none";
  tabela.style.display = "table";

  const abertos = leads.filter((l) => l.aberto).length;
  const enviados = leads.filter((l) => l.enviada).length;
  contador.textContent = `${abertos} de ${leads.length} conversas abertas · ${enviados} mensagens marcadas como enviadas`;

  // Mostra sempre do mais bem avaliado pro menos, sem alterar a ordem salva
  const notaNum = (l) => parseFloat((l.nota || "").replace(",", ".")) || 0;
  const leadsOrdenados = leads
    .slice()
    .sort((a, b) => notaNum(b) - notaNum(a) || (b.avaliacoes || 0) - (a.avaliacoes || 0));

  corpoTabela.innerHTML = "";
  for (const lead of leadsOrdenados) {
    const linha = document.createElement("tr");
    if (lead.aberto) linha.classList.add("aberto");
    if (lead.enviada) linha.classList.add("enviada");
    if (lead.naoEncontrado) linha.classList.add("nao-encontrado");

    let botoesAcao;
    if (lead.naoEncontrado) {
      botoesAcao = `<button class="nao-encontrado" disabled>Número inválido ✗</button>`;
    } else {
      const botaoAbrir = lead.enviada
        ? ""
        : `<button onclick="abrirConversaModal('${lead.id}')">
             ${lead.aberto ? "Reabrir conversa" : "Abrir conversa"}
           </button>`;

      const botaoEnviar = `<button class="enviar" ${lead.enviada ? "disabled" : ""} onclick="enviarConversa('${lead.id}')">
        ${lead.enviada ? "Enviada ✓" : "Marcar como enviada"}
      </button>`;

      const botaoNaoEncontrado = lead.enviada
        ? ""
        : `<button class="nao-encontrado" onclick="marcarNaoEncontrado('${lead.id}')">Número não encontrado</button>`;

      botoesAcao = botaoAbrir + botaoEnviar + botaoNaoEncontrado;
    }

    const maps = lead.mapsUrl
      ? `<a href="${escaparHtml(lead.mapsUrl)}" target="_blank" rel="noopener">Ver no Maps</a>`
      : "-";
    const instagram = lead.instagram
      ? `<a href="${escaparHtml(formatarLinkInstagram(lead.instagram))}" target="_blank" rel="noopener">${escaparHtml(lead.instagram)}</a>`
      : "-";
    const nota = lead.nota ? escaparHtml(lead.nota) : "-";
    const bairro = lead.bairroRegiao ? escaparHtml(lead.bairroRegiao) : "-";

    linha.innerHTML = `
      <td data-label="Nome">${escaparHtml(lead.nome)}${lead.angulo ? `<div class="angulo">${escaparHtml(lead.angulo)}</div>` : ""}</td>
      <td data-label="Bairro/Região">${bairro}</td>
      <td data-label="Telefone">${lead.telefone}</td>
      <td data-label="Nota">${nota}</td>
      <td data-label="Avaliações">${lead.avaliacoes || 0}</td>
      <td data-label="Google Maps">${maps}</td>
      <td data-label="Instagram">${instagram}</td>
      <td data-label="Ação">
        ${botoesAcao}
      </td>
    `;
    corpoTabela.appendChild(linha);
  }
}

// Transforma "@nome" ou "nome" em link direto pro Instagram; deixa como está se já for uma URL
function formatarLinkInstagram(valor) {
  if (/^https?:\/\//i.test(valor)) return valor;
  const usuario = valor.replace(/^@/, "");
  return `https://instagram.com/${usuario}`;
}

// --- Ações (tudo local, sem chamada de rede) ---
function atualizarLead(id, campos) {
  const leads = lerLeads();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return;
  Object.assign(lead, campos);
  salvarLeads(leads);
  renderizarLeads(leads);
}

// --- Modal de mensagem: prévia/edição antes de abrir o WhatsApp ---
const modal = document.getElementById("modalMensagem");
const modalTitulo = document.getElementById("modalTitulo");
const modalMsg = document.getElementById("modalMsg");
const modalBtn = document.getElementById("modalBtnAbrir");
const modalBtnFechar = document.getElementById("modalBtnFechar");

function abrirConversaModal(id) {
  const lead = lerLeads().find((l) => l.id === id);
  if (!lead) return;
  modalMsg.value = lead.mensagem || (modeloMensagem.value || MODELO_PADRAO);
  modalTitulo.textContent = `Conversa com ${lead.nome}`;
  modalBtn.dataset.id = id;
  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
  modalMsg.focus();
}

function fecharModal() {
  if (typeof modal.close === "function") modal.close();
  else modal.removeAttribute("open");
}

modalBtn.addEventListener("click", () => {
  const lead = lerLeads().find((l) => l.id === modalBtn.dataset.id);
  if (!lead) return;
  const mensagem = modalMsg.value
    .replace(/{NOME}/g, lead.nome)
    .replace(/{NOME_CURTO}/g, lead.nome);
  const link = `https://wa.me/${lead.telefone}?text=${encodeURIComponent(mensagem)}`;
  window.open(link, "_blank");
  fecharModal();
  atualizarLead(lead.id, { aberto: true, abertoEm: new Date().toISOString() });
});
modalBtnFechar.addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) fecharModal();
});

function enviarConversa(id) {
  atualizarLead(id, { enviada: true, enviadaEm: new Date().toISOString() });
}

function marcarNaoEncontrado(id) {
  atualizarLead(id, { naoEncontrado: true, naoEncontradoEm: new Date().toISOString() });
}

function limparLista() {
  if (!confirm("Limpar a lista de leads atual?")) return;
  salvarLeads([]);
  renderizarLeads([]);
}

// --- Importar backup de outro painel (ex: da versão antiga em Node/Express) ---
inputImportar.addEventListener("change", () => {
  if (inputImportar.files[0]) importarBackup(inputImportar.files[0]);
});

function importarBackup(arquivo) {
  const leitor = new FileReader();
  leitor.onload = () => {
    let leadsImportados;
    try {
      leadsImportados = JSON.parse(leitor.result);
    } catch (e) {
      textoImportar.textContent = "Erro: arquivo não é um JSON válido";
      return;
    }
    if (!Array.isArray(leadsImportados)) {
      textoImportar.textContent = "Erro: formato inesperado (esperava uma lista de leads)";
      return;
    }

    // Mescla com o que já existir aqui, casando por telefone — sem apagar
    // progresso que já tiver sido feito direto nesse navegador
    const atuaisPorTelefone = {};
    for (const lead of lerLeads()) {
      atuaisPorTelefone[lead.telefone] = lead;
    }

    for (const importado of leadsImportados) {
      const existente = atuaisPorTelefone[importado.telefone];
      if (!existente) {
        atuaisPorTelefone[importado.telefone] = importado;
      } else {
        // Se já existe, mantém o que já estiver marcado como feito (não regride status)
        atuaisPorTelefone[importado.telefone] = {
          ...importado,
          aberto: existente.aberto || importado.aberto,
          abertoEm: existente.abertoEm || importado.abertoEm,
          enviada: existente.enviada || importado.enviada,
          enviadaEm: existente.enviadaEm || importado.enviadaEm,
          naoEncontrado: existente.naoEncontrado || importado.naoEncontrado,
          naoEncontradoEm: existente.naoEncontradoEm || importado.naoEncontradoEm,
        };
      }
    }

    const leadsFinal = Object.values(atuaisPorTelefone);
    salvarLeads(leadsFinal);
    textoImportar.textContent = `Importado! ${leadsImportados.length} leads do backup mesclados.`;
    renderizarLeads(leadsFinal);
  };
  leitor.readAsText(arquivo, "utf-8");
}

function exportarBackup() {
  const leads = lerLeads();
  const conteudo = JSON.stringify(leads, null, 2);
  const blob = new Blob([conteudo], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const dataDeHoje = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `abrir-conversas-backup-${dataDeHoje}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Carrega o que já tiver salvo assim que a página abre
renderizarLeads(lerLeads());

// --- Disparo em fila (abre cada conversa em sequência, com intervalo) ---
const disparoProgressEl = document.getElementById("disparoProgresso");
const btnDisparar = document.getElementById("btnDisparar");
const btnPausar = document.getElementById("btnPausar");
const intervaloDisparoEl = document.getElementById("intervaloDisparo");

const CHAVE_DISPARO_STATS = "abrirConversasDisparoStats";
const CHAVE_INTERVALO = "abrirConversasIntervaloDisparo";

intervaloDisparoEl.value = localStorage.getItem(CHAVE_INTERVALO) || intervaloDisparoEl.value;
intervaloDisparoEl.addEventListener("change", () => {
  localStorage.setItem(CHAVE_INTERVALO, intervaloDisparoEl.value);
});

let disparoTimer = null;
let disparoFila = []; // índices em lerLeads() que ainda faltam
let disparoRodando = false;

function leadsDisponiveisParaDisparo() {
  return lerLeads().filter((l) => !l.enviada && !l.naoEncontrado);
}

function lerStatsDisparo() {
  try { return JSON.parse(localStorage.getItem(CHAVE_DISPARO_STATS) || "{}"); }
  catch (e) { return {}; }
}
function salvarStatsDisparo(stats) {
  localStorage.setItem(CHAVE_DISPARO_STATS, JSON.stringify(stats));
}

function atualizarProgresso(mensagem, disparando) {
  disparoProgressEl.textContent = mensagem;
  disparoProgressEl.classList.toggle("disparando", !!disparando);
  if (!disparando) {
    btnDisparar.style.display = "inline-block";
    btnPausar.style.display = "none";
  } else {
    btnDisparar.style.display = "none";
    btnPausar.style.display = "inline-block";
  }
}

function iniciarDisparo() {
  if (disparoRodando) return;
  const stats = lerStatsDisparo();
  if (stats.fila && stats.fila.length && (stats.enviados || 0) < stats.total) {
    retomarDisparo();
    return;
  }
  const pendentes = leadsDisponiveisParaDisparo();
  if (pendentes.length === 0) {
    atualizarProgresso("Nenhum lead pendente pra disparar (todos enviados ou inválidos).", false);
    return;
  }
  disparoFila = pendentes.map((l) => l.id);
  disparoRodando = true;
  stats.total = disparoFila.length;
  stats.enviados = 0;
  stats.iniciadoEm = new Date().toISOString();
  stats.fila = disparoFila.slice();
  salvarStatsDisparo(stats);
  atualizarProgresso(`Disparando... 0 de ${disparoFila.length}`, true);
  processarProximoDisparo();
}

function pausarDisparo() {
  disparoRodando = false;
  if (disparoTimer) { clearTimeout(disparoTimer); disparoTimer = null; }
  const stats = lerStatsDisparo();
  const total = stats.total || disparoFila.length;
  stats.fila = disparoFila.slice();
  salvarStatsDisparo(stats);
  atualizarProgresso(`Pausado em ${stats.enviados || 0} de ${total}.`, false);
}

function retomarDisparo() {
  if (disparoRodando) return;
  const stats = lerStatsDisparo();
  if (!stats.fila || !stats.fila.length) {
    atualizarProgresso("Nada pra retomar. Inicie um novo disparo.", false);
    return;
  }
  const leads = lerLeads();
  disparoFila = stats.fila.filter((id) => {
    const l = leads.find((x) => x.id === id);
    return l && !l.enviada && !l.naoEncontrado;
  });
  if (!disparoFila.length) {
    atualizarProgresso("Tudo já foi enviado desde a última pausa.", false);
    return;
  }
  stats.total = stats.total || (stats.enviados || 0) + disparoFila.length;
  salvarStatsDisparo(stats);
  disparoRodando = true;
  atualizarProgresso(`Retomando... ${stats.enviados || 0} de ${stats.total} feitos.`, true);
  processarProximoDisparo();
}

function processarProximoDisparo() {
  if (!disparoRodando) return;
  if (disparoFila.length === 0) {
    disparoRodando = false;
    const stats = lerStatsDisparo();
    atualizarProgresso(`Disparo concluído: ${stats.enviados || 0} conversas abertas.`, false);
    return;
  }
  const stats = lerStatsDisparo();
  const total = stats.total || disparoFila.length;
  const feitos = stats.enviados || 0;
  atualizarProgresso(`Disparando... ${feitos} de ${total} abertos. Próximo: ${nomeProximo()}`, true);

  const id = disparoFila[0];
  const leads = lerLeads();
  const lead = leads.find((l) => l.id === id);

  if (!lead || lead.enviada || lead.naoEncontrado) {
    disparoFila.shift();
    disparoTimer = setTimeout(processarProximoDisparo, 200);
    return;
  }

  const mensagem = (lead.mensagem || modeloMensagem.value || MODELO_PADRAO)
    .replace(/{NOME}/g, lead.nome)
    .replace(/{NOME_CURTO}/g, lead.nome);
  const link = `https://wa.me/${lead.telefone}?text=${encodeURIComponent(mensagem)}`;
  window.open(link, "_blank");

  Object.assign(lead, { aberto: true, abertoEm: new Date().toISOString() });
  salvarLeads(leads);

  disparoFila.shift();
  stats.enviados = (stats.enviados || 0) + 1;
  salvarStatsDisparo(stats);
  renderizarLeads(leads);

  if (disparoFila.length === 0) {
    disparoRodando = false;
    atualizarProgresso(`Disparo concluído: ${stats.enviados} conversas abertas.`, false);
    return;
  }
  const intervaloMs = Math.max(3, parseInt(intervaloDisparoEl.value, 10) || 15) * 1000;
  disparoTimer = setTimeout(processarProximoDisparo, intervaloMs);
}

function nomeProximo() {
  const id = disparoFila[0];
  if (!id) return "?";
  const lead = lerLeads().find((l) => l.id === id);
  return lead ? lead.nome : "?";
}

// Restaura aviso de pausa/conclusão ao recarregar a página
(function restaurarDisparo() {
  const stats = lerStatsDisparo();
  if (stats.fila && stats.fila.length && (stats.enviados || 0) < stats.total) {
    atualizarProgresso(`Disparo pausado em ${stats.enviados || 0} de ${stats.total}. Clique em "Disparar fila" pra retomar.`, false);
  } else if (stats.enviados && stats.total && stats.enviados >= stats.total) {
    atualizarProgresso(`Disparo anterior concluído: ${stats.enviados} conversas.`, false);
  } else {
    atualizarProgresso("Pronto pra disparar.", false);
  }
})();
