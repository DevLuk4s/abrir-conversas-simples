// app.js
// Tudo roda no navegador — sem servidor, sem banco de dados.
// Os leads e o status de cada um (aberto/enviada/número não encontrado)
// ficam salvos no localStorage deste navegador/aparelho específico.

const CHAVE_STORAGE = "abrirConversasLeads";

const areaUpload = document.getElementById("areaUpload");
const inputCsv = document.getElementById("inputCsv");
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

// Detecta qual coluna é nome e qual é telefone, aceitando tanto o formato
// já convertido (nome,telefone) quanto o bruto do Apify/Google Maps (title,phone...)
function detectarColunas(cabecalho) {
  const minusculo = cabecalho.map((h) => h.trim().toLowerCase());
  const idxNome = minusculo.findIndex((h) => h === "nome" || h === "title" || h === "name");
  const idxTelefone = minusculo.findIndex(
    (h) => h === "telefone" || h === "phoneunformatted" || h === "phone"
  );
  return { idxNome, idxTelefone };
}

// Limpa o telefone e garante o código do Brasil (55) na frente
function formatarTelefone(telefone) {
  let numeros = (telefone || "").replace(/\D/g, "");
  if (!numeros) return null;
  if (!numeros.startsWith("55")) numeros = "55" + numeros;
  return numeros;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}

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
  const { idxNome, idxTelefone } = detectarColunas(cabecalho);
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
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const nome = (linha[idxNome] || "").trim();
    const telefoneFormatado = formatarTelefone(linha[idxTelefone]);
    if (!nome || !telefoneFormatado) continue;

    const antigo = statusAntigoPorTelefone[telefoneFormatado];

    leads.push({
      id: `${telefoneFormatado}-${i}`,
      nome,
      telefone: telefoneFormatado,
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

  corpoTabela.innerHTML = "";
  for (const lead of leads) {
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
        : `<button ${lead.aberto ? "disabled" : ""} onclick="abrirConversa('${lead.id}')">
             ${lead.aberto ? "Aberto ✓" : "Abrir conversa"}
           </button>`;

      const botaoEnviar = `<button class="enviar" ${lead.enviada ? "disabled" : ""} onclick="enviarConversa('${lead.id}')">
        ${lead.enviada ? "Enviada ✓" : "Marcar como enviada"}
      </button>`;

      const botaoNaoEncontrado = lead.enviada
        ? ""
        : `<button class="nao-encontrado" onclick="marcarNaoEncontrado('${lead.id}')">Número não encontrado</button>`;

      botoesAcao = botaoAbrir + botaoEnviar + botaoNaoEncontrado;
    }

    linha.innerHTML = `
      <td>${escaparHtml(lead.nome)}</td>
      <td>${lead.telefone}</td>
      <td>
        ${botoesAcao}
        <button class="remover" title="Remover da lista" onclick="removerLead('${lead.id}')">×</button>
      </td>
    `;
    corpoTabela.appendChild(linha);
  }
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

function abrirConversa(id) {
  const lead = lerLeads().find((l) => l.id === id);
  if (!lead) return;
  window.open(`https://wa.me/${lead.telefone}`, "_blank");
  atualizarLead(id, { aberto: true, abertoEm: new Date().toISOString() });
}

function enviarConversa(id) {
  atualizarLead(id, { enviada: true, enviadaEm: new Date().toISOString() });
}

function marcarNaoEncontrado(id) {
  atualizarLead(id, { naoEncontrado: true, naoEncontradoEm: new Date().toISOString() });
}

function removerLead(id) {
  const leads = lerLeads().filter((l) => l.id !== id);
  salvarLeads(leads);
  renderizarLeads(leads);
}

function limparLista() {
  if (!confirm("Limpar a lista de leads atual?")) return;
  salvarLeads([]);
  renderizarLeads([]);
}

// Carrega o que já tiver salvo assim que a página abre
renderizarLeads(lerLeads());
