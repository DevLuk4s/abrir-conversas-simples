// validar.js
// Uso: node validar.js <csv-de-prospeccao.csv>
// Checa invariantes do pipeline e sai com código de erro se algo estiver errado.

const fs = require("fs");

const ARQUIVO = process.argv[2];
if (!ARQUIVO) {
  console.error("Uso: node validar.js <arquivo.csv>");
  process.exit(1);
}

function parseCSV(texto) {
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] || "";
  const sep =
    (primeiraLinha.match(/;/g) || []).length > (primeiraLinha.match(/,/g) || []).length
      ? ";"
      : ",";
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
      else if (c === sep) { linha.push(campo); campo = ""; }
      else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
      else if (c !== "\r") campo += c;
    }
  }
  if (campo.length || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const erros = [];
const ok = (cond, msg) => { if (!cond) erros.push(msg); };

const linhas = parseCSV(fs.readFileSync(ARQUIVO, "utf8").replace(/^\uFEFF/, ""));
ok(linhas.length > 1, "CSV vazio ou sem dados");

const cabecalho = linhas[0];
const col = (nome) => cabecalho.indexOf(nome);
const N = col("Nome"), T = col("Telefone"), L = col("Link WhatsApp"), S = col("Nota"),
      A = col("Avaliações"), G = col("Ângulo"), M = col("Mensagem");

ok(N !== -1 && T !== -1 && L !== -1 && S !== -1 && A !== -1 && G !== -1 && M !== -1,
  `Colunas esperadas ausentes (Nome/Telefone/Link WhatsApp/Nota/Avaliações/Ângulo/Mensagem): ${cabecalho.join(", ")}`);

let total = 0;
const angulos = {};
if (N !== -1 && M !== -1) {
  const estrutura = (msg) => msg.replace(/ em [^,.!?—:]+/g, " em X");
  const msgVistas = new Map();
  let semTelefone = 0;

  for (let i = 1; i < linhas.length && erros.length < 20; i++) {
    const r = linhas[i];
    total++;
    const nome = r[N], telefone = r[T], link = r[L], nota = r[S], aval = r[A], angulo = r[G], mensagem = r[M];

    const placeholders = (mensagem.match(/\{|\}/g) || []).length;
    ok(placeholders === 0, `Linha ${i}: mensagem com placeholders não resolvidos -> ${mensagem.slice(0, 60)}`);
    ok(/^https:\/\/wa\.me\/55\d{10,12}$/.test(link || "") || link === "",
      `Linha ${i}: link malformado -> ${link}`);

    if (angulo === "Sem telefone no cadastro") {
      semTelefone++;
      ok(link === "", `Linha ${i}: sem-telefone com link preenchido (${nome})`);
    } else {
      ok(telefone !== "" && link !== "", `Linha ${i}: com telefone mas link vazio (${nome})`);
    }

    const textoNormalizado = `${angulo}|${estrutura(mensagem)}`;
    if (msgVistas.has(textoNormalizado)) {
      erros.push(`Linhas ${msgVistas.get(textoNormalizado)} e ${i}: mensagem idêntica (mesmo ângulo e estrutura)`);
    } else {
      msgVistas.set(textoNormalizado, i);
    }

    const vizinho = linhas[i - 1];
    if (vizinho && vizinho[G] === angulo && estrutura(vizinho[M]) === estrutura(mensagem)) {
      erros.push(`Linhas ${i - 1} e ${i}: vizinhas do mesmo ângulo com a mesma estrutura`);
    }

    angulos[angulo] = (angulos[angulo] || 0) + 1;
  }
}

console.log(`Validando: ${ARQUIVO}`);
console.log(`Leads: ${total}`);
console.log("Ângulos: " + Object.entries(angulos || {}).map(([k, v]) => `${k}: ${v}`).join(" · "));

if (erros.length) {
  console.error(`\n${erros.length} problema(s) encontrado(s):`);
  for (const e of erros) console.error(" - " + e);
  process.exit(1);
}
console.log("Tudo OK.");