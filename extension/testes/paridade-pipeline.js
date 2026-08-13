// paridade-pipeline.js - garante que extension/pipeline.js continua idêntico ao
// prospeccao-pipeline/processar.js. Rode do diretório raiz do repositório:
//   node extension/testes/paridade-pipeline.js
// Falha (exit 1) se os ângulos/mensagens divergirem.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const RAIZ = path.resolve(__dirname, "..", "..");
const EXT = path.join(RAIZ, "extension");
const PIPELINE_NODE = path.join(RAIZ, "prospeccao-pipeline");
const TMP = path.join(require("os").tmpdir(), "paridade-pipeline");
fs.mkdirSync(TMP, { recursive: true });

const CSV_RAW = [
  ["title", "phone", "phoneUnformatted", "neighborhood", "address", "reviewsCount", "totalScore", "categoryName", "url"],
  ["Palace Store - iPhone", "+55 71 99258-8864", "5571992588864", "Caminho das Árvores", "Rua Alameda 123", "55", "5", "Loja de eletrônicos", "https://maps.google.com/x"],
  ["Confiança IPhones", "+55 71 99982-8554", "55719999828554", "Patamares", "Av. Principal 10", "2", "5", "Loja de eletrônicos", "https://maps.google.com/y"],
  ["Bom Preço Pets", "+55 71 98888-0000", "5571988880000", "Barra", "Rua A 5", "300", "4.8", "Pet shop", "https://maps.google.com/z"],
  ["Loja Sem Telefone", "", "", "Pituba", "Rua B 9", "10", "4.6", "Loja de roupas", "https://maps.google.com/w"],
].map((l) => l.map((c) => `"${c}"`).join(",")).join("\n");

function parseCSV(texto) {
  const linhas = [];
  let campo = "", linha = [], dentroDeAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroDeAspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else dentroDeAspas = false; }
      else campo += c;
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

const brutos = parseCSV(CSV_RAW);
const csvPath = path.join(TMP, "raw.csv");
const saidaPath = path.join(TMP, "saida_original.csv");
fs.writeFileSync(csvPath, CSV_RAW);

execFileSync("node", ["processar.js", csvPath, saidaPath], { cwd: PIPELINE_NODE });
const original = parseCSV(fs.readFileSync(saidaPath, "utf8"));

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(EXT, "pipeline.js"), "utf8"), sandbox);
const pipeline = sandbox.window.Pipeline.processar(brutos);

let ok = true;
const falha = (msg) => {
  ok = false;
  console.error("FALHA: " + msg);
};

if (pipeline.length !== original.length - 1) {
  falha(`Tamanho diferente: pipeline=${pipeline.length} original=${original.length - 1}`);
} else {
  for (let i = 0; i < pipeline.length; i++) {
    const p = pipeline[i];
    const o = original[i + 1];
    if (p.mensagem !== o[7]) falha(`Mensagem diferente na linha ${i}`);
    if (p.angulo !== o[6]) falha(`Ângulo diferente na linha ${i}: ${p.angulo} vs ${o[6]}`);
    if (/\{|\}/.test(p.mensagem)) falha(`Placeholder sobrando na linha ${i}`);
  }
}

console.log(ok ? "TUDO OK — pipeline.js bate com processar.js" : "Paridade QUEBRADA");
process.exit(ok ? 0 : 1);
