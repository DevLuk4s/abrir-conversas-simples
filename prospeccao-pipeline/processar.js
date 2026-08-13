// processar.js
// Uso: node processar.js <arquivo.csv> [saida.csv]

const fs = require("fs");
const path = require("path");

const ENTRADA = process.argv[2];
const SAIDA = process.argv[3] || path.join("output", "prospeccao_leads.csv");

if (!ENTRADA) {
  console.error("Uso: node processar.js <arquivo.csv> [saida.csv]");
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

function nomeCurto(nome) {
  let n = (nome || "").trim();
  if (!n) return "";
  // separadores de metadados do crawler: fica só o primeiro segmento antes de "|"
  n = n.split(/\s*\|\s*/)[0].trim();
  n = n.replace(/\s+(?:rua|r\.|avenida|av\.|estrada|alameda|praça|travessa|box|rodovia|ladeira)\s+\S+\s*\d+.*$/i, "");
  n = n.replace(/\s+bairro\s+\S+.*$/i, "");
  n = n.replace(/\s*\([^)]*(?:loja|moda|roupa|atacado|barreiro|guarani|bh|mg|unidade|bairro|pet|veterin|banho|tosa|vacina|cl[íi]nica|ra[çc][ãa]o|hospedagem|dog\s*walker)[^)]*\)\s*$/i, "");
  n = n.replace(/[,\u2013-]\s*(?=(?:Loja|Atacadista|Butique|Boutique|Distribuidor|Conserto|Roupa|Roupas|Moda|Acessórios|Calçados|Brechó|Modinha|Feminin[oa]|Masculin[oa]|Infantil|Evangélica|Praia|Fitness|Presente|Lingerie|Vestuário))\S.*$/i, "");
  n = n.replace(/\s+(?:Loja\s+de\s+[A-ZÁ-ÚÀ-Ù]|Loja\s+[a-zá-úà-ù]{2,}|Atacadista|Distribuidor|Modinha|Presente\b).*$/i, "");
  n = n.replace(/\s*[\-\u2013]\s*(?:Loja|Moda|Roupa|Roupas|Atacad|Butique|Boutique|Distribuidor|Conserto|Praia|Fitness|Acessórios|Calçados|Brechó|Evangélic[ao]|Plus\s*Size|Modinha|Lingerie).*$/i, "");
  n = n.replace(/\s*[\-\u2013]\s*[A-ZÁ-ÚÀ-Ù][\wá-úà-ù ]*\/?[A-Z]{2,4}$/, "");
  // cauda de localização/keyword usada pelo crawler (em/no/na + lugar, unidade, shopping, cidade)
  n = n.replace(/\s*[,\u2013\-:]\s*(?:em\s+|no\s+|na\s+)\S.*$/i, "");
  n = n.replace(/\s*[,\u2013-]\s*(?:Unidade\b|Shopping\b|Salvador\b).*$/i, "");
  // cauda de categoria/categoria-chave após separador
  n = n.replace(/\s*[,\u2013-]\s*(?:Barbearia\b|Barber\b|Barbershop\b|Sal[ãa]o\b|Centro\s*De\s*Beleza\b|Studio\s*De\s*Beleza\b|Est[úu]dio\s*De\s*Beleza\b|Cabeleireir[oa]\b|Cabelereir[oa]\b|Beleza\s*E\s*Est[ée]tica\b|Micropigmenta[çc][ãa]o\b|Despigmenta[çc][ãa]o\b|Sobrancelha\b|Tatuagem\b|Cortes\b|Pr[óo]tese\s*Capilar\b|Terapia\s*Capilar\b|Capilar\b|Alisamento\b|Dog\s*Walker\b|Banho\s*E\s*Tosa\b|Pet\s*Shop\b|Veterin[áa]ri[oa]\b|Cl[íi]nica\s*Veterin[áa]ria\b|Hospital\s*Veterin[áa]rio\b|Ra[çc][õo]es\b|Acess[óo]rios\b|Hair\s*Dresser\b).*$/i, "");
  n = n.replace(/\s+/g, " ").trim();
  return n.length >= 3 ? n : (nome || "").trim();
}

const DESCRICOES = {
  "loja de roupa": "roupas",
  "loja de moda feminina": "moda feminina",
  "loja de roupas esportivas": "roupas esportivas",
  "loja de moda masculina": "moda masculina",
  butique: "moda",
  "loja de moda infantil": "moda infantil",
  "loja de roupas com tamanhos especiais": "roupas com tamanhos especiais",
  loja: "moda",
  "loja de lingerie": "lingerie",
  "loja infantil": "moda infantil",
  "atacadista de lingeries": "lingerie no atacado",
  costureira: "costura e reforma",
  "loja de roupas para bebês": "roupas para bebês",
  "designer de moda": "moda",
  "loja de roupas para jovens": "moda jovem",
  "loja de roupas para ocasiões formais": "moda para ocasiões formais",
};

function descricaoAtuacao(lead) {
  const cat = (lead.categoria || "").trim().toLowerCase();
  let d = DESCRICOES[cat] || cat.replace(/^(loja\s+(?:de\s+)?|atacadista\s+de\s+|distribuidor\s+de\s+)/, "");
  d = d.trim();
  if (!d) return "";
  const raiz = d.split(/\s/)[0];
  if (lead.nomeCurto.toLowerCase().includes(raiz)) return "";
  return d;
}

function extrairReferencia(endereco) {
  const a = endereco || "";
  const m = a.match(
    /(?:shopping\s+[a-záàâãéêíóôõúç]+(?:\s+[a-záàâãéêíóôõúç]+)*?(?=\s*(?:ladeira|rua|r\.|avenida|av\.|estrada|praça|alameda|travessa|,|;|\d))|edf\.?\s+[^,;\-–]+|wall\s+street\s+[^,;\-–]+|centro\s+empresarial\s+[^,;\-–]+)/i
  );
  return m ? m[0].trim() : null;
}

const ROTULOS = {
  "sem-telefone": "Sem telefone no cadastro",
  credibilidade: "Nota alta + poucas avaliações - credibilidade",
  "shopping-muitas": "Localização em shopping + muitas avaliações - premium/automação",
  shopping: "Localização em shopping - posicionamento premium",
  "empresarial-muitas": "Prédio empresarial premium + muitas avaliações",
  empresarial: "Localização empresarial + boas avaliações",
  muitas: "Muitas avaliações - automação/catálogo",
  "24h": "Atendimento 24h - orçamentos e vendas no piloto automático",
  basica: "Presença digital básica - concorrência",
};

const BLOCOS = {
  "sem-telefone": {
    a: ["Oi!", "Oi, tudo bem?", "Oi, {NOME_CURTO}!", "Olá!", "Oi! Vi seu registro no Google."],
    m: [
      " Vi o perfil de vocês no Google{EM_BAIRRO} com {NOTA_TXT}, mas quase sem informação pra quem procura.",
      " Encontrei o perfil de vocês no Google{EM_BAIRRO} com {NOTA_TXT} — a reputação existe, mas ninguém acha contato nem site.",
      " A loja de vocês{EM_BAIRRO} aparece no Google com {NOTA_TXT}, mas sem telefone nem site pra quem quer chamar — e isso espanta cliente.",
      " Vi vocês listados no Google{EM_BAIRRO} com {NOTA_TXT}, mas praticamente invisíveis pra quem pesquisa: sem site, sem catálogo, sem contato.",

    ],
    f: [
      " Um site simples resolve isso rapidinho e evita perder cliente pra concorrência. Consigo te mostrar um exemplo, é só me chamar por aqui.",
      " Um site simples mudaria isso e evita perder espaço pra concorrência. Posso te mostrar um exemplo? É só responder por aqui.",
      " Um site com link direto pro WhatsApp resolve. Quer que eu te mostre como faria?",
      " Um exemplo simples de página mudaria isso. Posso te enviar?",
      " Uma página de uma página só já muda o jogo. Topa ver um modelo?",
    ],
  },
  credibilidade: {
    a: ["Oi!", "Oi, tudo bem?", "Oi, {NOME_CURTO}!", "Olá! Como vai?", "Oi! Tava procurando lojas por aqui e encontrei vocês."],
    m: [
      " Vi a loja de vocês aqui{EM_BAIRRO} com {NOTA_TXT} — só que ainda com poucas avaliações, uma pena, porque essa nota merecia aparecer mais.",
      " Achei o perfil de vocês{EM_BAIRRO} com {NOTA_TXT} — parabéns! Uma nota que a maioria das lojas da região não tem.",
      " A loja de vocês{DESC_ATUACAO}{EM_BAIRRO} tem {NOTA_TXT} no Google, mas poucas avaliações pra comprovar.",
      " Vocês têm {NOTA_TXT}{EM_BAIRRO}, mas quase nenhuma avaliação pra corroborar.",
      " O Google mostra a loja de vocês{EM_BAIRRO} com {NOTA_TXT}, mas são poucas avaliações — e quem ainda não conhece procura prova antes de chamar.",
      " A {NOTA_TXT}{EM_BAIRRO} não bate com o número de avaliações — merecia aparecer mais pra quem pesquisa.",
      " Encontrei o perfil de vocês{EM_BAIRRO} com {NOTA_TXT}, mas com tão poucas avaliações que a nota acaba não pesando na escolha.",
      " Vi a {NOTA_TXT}{EM_BAIRRO} no perfil de vocês, mas com tão poucas avaliações que ela ainda nem aparece direito no Google.",
      " O perfil de vocês{EM_BAIRRO} acumula {NOTA_TXT}, mas são poucas avaliações pra transformar isso em confiança na busca.",
      " {NOTA_TXT}{EM_BAIRRO} é um belo cartão de visita — só falta gente pra confirmar isso publicamente no Google.",

    ],
    f: [
      " Um site profissional ajuda bastante nisso, reforçando a credibilidade pra quem tá pesquisando. Posso te mostrar como ficaria?",
      " Um site profissional puxaria mais gente que pesquisa uma loja confiável na região — a nota de vocês fala por si só. Quer ver um exemplo rápido?",
      " Um site profissional transforma essa reputação em cliente novo e mostra o trabalho de vocês. Topa ver um modelo?",
      " E é exatamente aí que um site simples entra: mostra o trabalho e segura quem pesquisa. Posso te mostrar um exemplo?",
      " Com um site, essa nota vira argumento de venda. Quer ver como aplicaria?",
      " Uma página de apresentação simples mudaria isso em poucos dias. Quer ver um exemplo do que eu faria?",
      " Posso te mandar um modelo de página pensado exatamente pra esse caso? É sem compromisso.",
      " Com essa nota, um site simples vira a prova que falta. Quer ver um exemplo?",
    ],
  },
  muitas: {
    a: ["Oi!", "Oi, {NOME_CURTO}!", "Oi, pessoal da {NOME_CURTO}!", "Olá, {NOME_CURTO}!", "Oi! Tudo certo?"],
    m: [
      " {AVAL} avaliações com {NOTA_TXT} no Google é prova de atendimento consistente — parabéns!",
      " {AVAL} avaliações é muita gente atendida — tudo isso com {NOTA_TXT}.",
      " Vi que vocês acumulam {AVAL} avaliações{EM_BAIRRO} com {NOTA_TXT} — um dos perfis mais fortes que achei na região.",
      " {AVAL} avaliações com {NOTA_TXT} não é sorte — é trabalho bem feito.",
      " {AVAL} avaliações{EM_BAIRRO} com {NOTA_TXT} — a prova está nos números, falta só uma vitrine pra quem chega pelo Google.",

    ],
    f: [
      " Com esse volume, um site com catálogo e agendamento online tiraria peso do WhatsApp e organizaria melhor o fluxo. Topa dar uma olhada num exemplo?",
      " Um catálogo online deixaria parte do atendimento automática, sem perder qualidade, e abriria espaço pra crescer em horários que hoje ficam parados. Posso te mostrar como funcionaria?",
      " Um site à altura disso captaria cliente direto do Google, sem depender só de indicação. Quer ver uma demonstração?",
      " Com um site, esse trabalho passa a se vender sozinho: catálogo, contato e orçamento sem precisar de atendente. Consigo te mostrar um modelo?",
      " Um site transformaria esse movimento em venda até fora do horário. Posso te mandar um exemplo?",
    ],
  },
  basica: {
    a: ["Oi!", "Oi, tudo bem?", "Oi, {NOME_CURTO}!", "Olá!", "Oi! Te achei pesquisando lojas na região."],
    m: [
      " Vi a loja de vocês{EM_BAIRRO} com {NOTA_TXT} no Google, mas quase sem informações pra quem pesquisa.",
      " Encontrei a loja de vocês{EM_BAIRRO} no Google, mas o perfil tem pouquíssima informação.",
      " A loja de vocês{EM_BAIRRO} aparece no Google com {NOTA_TXT}, mas quem clica não encontra site nem catálogo.",
      " Encontrei a loja de vocês{DESC_ATUACAO}{EM_BAIRRO} — {NOTA_TXT} no Google, mas o perfil não ajuda quem pesquisa.",
      " Pesquisei vocês{EM_BAIRRO} e a única coisa que achei foi o Google com {NOTA_TXT} — site e catálogo não existem.",
      " O perfil de vocês{EM_BAIRRO} no Google tem {NOTA_TXT}, mas não leva ninguém a lugar nenhum — sem site, sem catálogo, sem WhatsApp visível.",
      " Vocês aparecem{EM_BAIRRO} com {NOTA_TXT}, mas quem pesquisa só encontra o perfil do Google — e nada além disso.",
      " A {NOME_CURTO}{EM_BAIRRO} tem {NOTA_TXT}, mas sem site, sem catálogo e sem página própria, quem pesquisa nem sabe o que vocês fazem.",
    ],
    f: [
      " Um site simples resolve isso rapidinho e evita perder cliente pra concorrência. Posso te mostrar um exemplo?",
      " Enquanto isso, quem pesquisa acaba indo pra concorrência. Um site simples resolve isso. Quer ver uma demonstração?",
      " E acaba fechando com quem aparece melhor. Uma página simples muda esse jogo. Topa ver como ficaria?",
      " Um site simples custa pouco e pesa muito na hora do cliente escolher. Posso te enviar um exemplo?",
      " Um site resolveria isso em poucos dias. Quer ver um modelo?",
      " Uma página simples conserta isso e ainda ajuda o Google a te achar. Quer ver o que eu faria?",
      " Posso te mostrar, em dois minutos, como ficaria a página de vocês. Sem compromisso, quer ver?",
      " Uma página simples resolveria isso rápido — e custa menos do que vocês imaginam. Topa dar uma olhada num exemplo?",
      " Posso montar um modelo gratuito pra vocês verem como ficaria. Interessado?",
    ],
  },
  "24h": {
    a: ["Oi!", "Oi, {NOME_CURTO}!", "Oi, tudo bem?"],
    m: [
      " Vi que o atendimento de vocês é 24 horas{EM_BAIRRO} — pouca assistência na região tem isso, e é um diferencial e tanto.",
      " Atendimento 24 horas{EM_BAIRRO} é um diferencial que quase ninguém tem — mas quase ninguém descobre sem um site.",
      " Atendimento 24h{EM_BAIRRO} é raro — mas sem site, quem procura de madrugada não te acha.",
    ],
    f: [
      " Um site captaria orçamento e pedido no piloto automático, mesmo fora do balcão. Posso te mostrar como funcionaria?",
      " Com uma página simples, quem procura de madrugada já chega direto ao orçamento. Topa ver um exemplo?",
      " Uma página com orçamento automático fecha venda enquanto vocês dormem. Posso te mostrar como funcionaria?",
    ],
  },
  "shopping-muitas": {
    a: ["Oi!", "Oi, {NOME_CURTO}!", "Oi, pessoal da {NOME_CURTO}!"],
    m: [
      " Vi que vocês ficam{LOC_REF}, com {NOTA_TXT} e {AVAL} avaliações — bom movimento.",
      " Vocês estão{LOC_REF} com {NOTA_TXT} e {AVAL} avaliações — um fluxo grande de gente passando por ali.",
      " {AVAL} avaliações e {NOTA_TXT} num ponto{LOC_REF} — fluxo garantido.",
    ],
    f: [
      " Um site profissional reforça esse posicionamento e ainda ajuda a captar orçamento fora do horário do shopping. Topa ver um modelo?",
      " Um site com catálogo captaria essa demanda direto do Google, mesmo fora do horário do shopping. Posso te mandar uma proposta sem compromisso?",
      " Um site captaria essa demanda até fora do horário do shopping. Posso te mostrar como funcionaria?",
    ],
  },
  shopping: {
    a: ["Oi!", "Oi, tudo bem?", "Oi, {NOME_CURTO}!"],
    m: [
      " Vi que a {NOME_CURTO} atende{LOC_REF}.",
      " {NOME_CURTO}{LOC_REF} — quem pesquisa vocês antes de ir ao shopping hoje não acha site nenhum.",
      " Vi a {NOME_CURTO}{LOC_REF} no Google.",
    ],
    f: [
      " Um site à altura desse ponto ajudaria a segurar quem pesquisa a loja antes de ir até o shopping. Topa ver um exemplo?",
      " Uma página simples segura esse cliente. Quer ver um exemplo?",
      " Um site à altura do ponto ajudaria a transformar visita em cliente recorrente. Posso te mandar um exemplo sem compromisso?",
    ],
  },
  "empresarial-muitas": {
    a: ["Oi!", "Oi, {NOME_CURTO}!", "Oi, pessoal da {NOME_CURTO}!"],
    m: [
      " Vi que vocês atendem{LOC_REF}, com {NOTA_TXT} e {AVAL} avaliações — reputação sólida.",
      " A {NOME_CURTO}{LOC_REF} tem {NOTA_TXT} e {AVAL} avaliações — quem pesquisa no Google já deveria achar um site de vocês.",
      " Reputação sólida com {NOTA_TXT} e {AVAL} avaliações, escritório{LOC_REF} — falta só uma vitrine digital.",
    ],
    f: [
      " Um site à altura desse padrão ajudaria a captar cliente novo direto pelo Google, sem depender só do boca a boca. Posso te mostrar um modelo?",
      " Posso te mostrar como ficaria?",
      " Um site capta orçamento direto do Google. Topa ver um modelo?",
    ],
  },
  empresarial: {
    a: ["Oi!", "Oi, {NOME_CURTO}!", "Oi, tudo bem?"],
    m: [
      " Vi que vocês ficam{LOC_REF}, com {NOTA_TXT} — ótimo ponto.",
      " Achei a {NOME_CURTO}{LOC_REF} com {NOTA_TXT} — clientes passam por aí todo dia, mas quem pesquisa na região hoje não acha um site de vocês.",
      " A {NOME_CURTO}{LOC_REF} tem {NOTA_TXT} no Google — mas sem site, boa parte de quem pesquisa a região vai parar na concorrência.",
    ],
    f: [
      " Um site ajudaria a captar orçamento direto, sem depender só de quem passa por ali. Posso te mandar uma proposta sem compromisso?",
      " Quer ver uma demonstração rápida?",
      " Um site muda isso. Quer ver um exemplo?",
    ],
  },
};

const contadorGlobal = { valor: 0 };
const combosUsados = {};

function definirAngulo(lead) {
  if (!lead.link) return "sem-telefone";
  if (lead.nota >= 4.5 && lead.avaliacoes < 20) return "credibilidade";
  if (lead.shopping) return lead.avaliacoes >= 50 ? "shopping-muitas" : "shopping";
  if (lead.empresarial) return lead.avaliacoes >= 50 ? "empresarial-muitas" : "empresarial";
  if (lead.avaliacoes >= 50) return "muitas";
  if (lead.vinteQuatroHoras) return "24h";
  return "basica";
}

function notaTexto(nota) {
  if (nota === 5) return "nota máxima";
  if (nota === "" || nota === "—") return "boa avaliação";
  return `nota ${nota}`;
}

function montarMensagem(chave, lead) {
  const blocos = BLOCOS[chave];
  const g = ++contadorGlobal.valor;
  const usados = (combosUsados[chave] = combosUsados[chave] || new Set());
  const aN = blocos.a.length, mN = blocos.m.length, fN = blocos.f.length;
  let aIdx = 0, bi = 0, ci = 0;
  let achou = false;
  // fase 1: diagonal (g-1, g, g+1) — vizinhos sempre bem diferentes
  for (let t = 0; t < Math.max(aN, mN, fN) && !achou; t++) {
    aIdx = (g - 1 + t) % aN;
    bi = (g + t) % mN;
    ci = (g + 1 + t) % fN;
    if (!usados.has(`${aIdx}|${bi}|${ci}`)) achou = true;
  }
  // fase 2: varredura completa em ordem rotativa (só se a fase 1 colidiu)
  if (!achou) {
    const total = aN * mN * fN;
    for (let k = 0; k < total && !achou; k++) {
      const s = (k * 37 + g) % total;
      aIdx = s % aN;
      bi = Math.floor(s / aN) % mN;
      ci = Math.floor(s / (aN * mN)) % fN;
      if (!usados.has(`${aIdx}|${bi}|${ci}`)) achou = true;
    }
  }
  usados.add(`${aIdx}|${bi}|${ci}`);
  const a = blocos.a[aIdx];
  const m = blocos.m[bi];
  const f = blocos.f[ci];
  let texto = a + m + f;
  if (lead.notaNum < 0) {
    texto = texto
      .replace(/\s+com\s+\{NOTA_TXT\}/g, "")
      .replace(/\{NOTA_TXT\}\s*\{EM_BAIRRO\}/g, "{EM_BAIRRO}")
      .replace(/\s*\{NOTA_TXT\}\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1");
  }
  const emBairro = lead.bairro ? ` em ${lead.bairro}` : "";
  const locRef = lead.referencia
    ? ` no ${lead.referencia}${lead.bairro ? `, em ${lead.bairro}` : ""}`
    : emBairro;
  texto = texto
    .replace(/\{NOME_CURTO\}/g, lead.nomeCurto)
    .replace(/\{NOTA_TXT\}/g, lead.notaNum >= 0 ? notaTexto(lead.notaNum) : "")
    .replace(/\{AVAL\}/g, lead.avaliacoes)
    .replace(/\{EM_BAIRRO\}/g, emBairro)
    .replace(/\{LOC_REF\}/g, locRef)
    .replace(/\{DESC_ATUACAO\}/g, lead.desc ? ` que trabalha com ${lead.desc}` : "");
  return texto;
}

function extrairTelefone(campo) {
  return (campo || "").replace(/\D/g, "");
}

const brutos = parseCSV(fs.readFileSync(ENTRADA, "utf8").replace(/^\uFEFF/, ""));
if (brutos.length < 2) {
  console.error("Erro: CSV vazio ou sem dados");
  process.exit(1);
}

const cabecalho = brutos[0];
const col = {};
cabecalho.forEach((h, i) => {
  const k = h.trim().toLowerCase();
  if (!(k in col)) col[k] = i;
});

if (["title", "name", "nome"].every((n) => col[n] === undefined)) {
  console.error(`Erro: não encontrei coluna de nome (title/name/nome). Cabeçalho:\n${cabecalho.join(", ")}`);
  process.exit(1);
}
if (["phone", "phoneunformatted", "telefone", "telefone_formatado"].every((n) => col[n] === undefined)) {
  console.error(`Erro: não encontrei coluna de telefone (phone/phoneUnformatted/telefone). Cabeçalho:\n${cabecalho.join(", ")}`);
  process.exit(1);
}
if (["neighborhood", "address", "street", "bairro", "cidade"].every((n) => col[n] === undefined)) {
  console.warn("Aviso: sem coluna de endereço/bairro — mensagens não citarão região (use: neighborhood, address, street, bairro ou cidade)");
}

const coluna = (nomes) => nomes.find((n) => col[n] !== undefined);
const valor = (r, nomes) => {
  const c = coluna(nomes);
  return c === undefined ? "" : (r[col[c]] || "");
};

const idxHours = [];
cabecalho.forEach((h, i) => {
  const k = h.trim().toLowerCase();
  if (/^(additional)?openinghours\/[^/]+\/\d+\/hours$/.test(k)) idxHours.push(i);
});

const leads = [];
for (let i = 1; i < brutos.length; i++) {
  const r = brutos[i];
  const nome = valor(r, ["title", "name", "nome"]).trim();
  if (!nome) continue;

  const telefoneBruto = valor(r, ["phone", "telefone", "telefone_formatado"]);
  const numerosUnformat = extrairTelefone(valor(r, ["phoneunformatted", "telefone", "telefone_formatado"]));
  const numerosTelefone = extrairTelefone(telefoneBruto);
  let numeros = numerosUnformat || numerosTelefone;
  if (numeros.length > 0 && numeros.length < 12) numeros = ""; // BR local inválido (<10 dígitos sem DDD)

  const endereco = valor(r, ["address", "street", "cidade", "bairro"]);
  const notaTexto = valor(r, ["totalscore", "nota"]).trim();
  const avalTexto = valor(r, ["reviewscount", "avaliacoes"]).replace(/\D/g, "");
  const nota = notaTexto === "" ? NaN : parseFloat(notaTexto.replace(",", "."));
  const aval = avalTexto === "" ? NaN : parseInt(avalTexto, 10);

  const lead = {
    nome,
    nomeCurto: nomeCurto(nome),
    categoria: valor(r, ["categoryname", "categoria"]).trim(),
    bairro: valor(r, ["neighborhood", "bairro"]).trim(),
    telefone: telefoneBruto.trim(),
    link: numeros ? `https://wa.me/${numeros}` : "",
    nota: Number.isNaN(nota) ? "—" : String(nota),
    avaliacoes: Number.isNaN(aval) ? "—" : String(aval),
    notaNum: Number.isNaN(nota) ? -1 : nota,
    avalNum: Number.isNaN(aval) ? -1 : aval,
    referencia: extrairReferencia(endereco),
    shopping: /shopping/i.test(endereco),
    empresarial: /(edf\.?|wall\s+street|empresarial)/i.test(endereco),
    vinteQuatroHoras: idxHours.some((j) => /24\s*horas/i.test(r[j] || "")),
  };

  const chave = definirAngulo(lead);
  lead.angulo = ROTULOS[chave];
  lead.chave = chave;
  lead.desc = descricaoAtuacao(lead);
  leads.push(lead);
}

const dddDe = (lead) => (lead.link.match(/wa\.me\/(\d{2})/) || [])[1] || "";
const vistos = new Map();
for (const lead of leads) {
  const chaveDedup = `${lead.nomeCurto.toLowerCase()}|${dddDe(lead)}`;
  const anterior = vistos.get(chaveDedup);
  if (!anterior || lead.avalNum > anterior.avalNum) vistos.set(chaveDedup, lead);
}
const leadsFinal = leads.filter((l) => vistos.get(`${l.nomeCurto.toLowerCase()}|${dddDe(l)}`) === l);
leads.length = 0;
leads.push(...leadsFinal);

leads.sort((a, b) => b.notaNum - a.notaNum || b.avalNum - a.avalNum);
for (const l of leads) l.mensagem = montarMensagem(l.chave, l);

const saida = [
  ["Nome", "Bairro/Região", "Telefone", "Link WhatsApp", "Nota", "Avaliações", "Ângulo", "Mensagem"],
  ...leads.map((l) => [l.nomeCurto, l.bairro, l.telefone, l.link, l.nota, l.avaliacoes, l.angulo, l.mensagem]),
];

const conteudo = "\uFEFF" + saida
  .map((linha) => linha.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
  .join("\n");

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, conteudo, "utf8");

const semTelefone = leads.filter((l) => !l.link).length;
console.log(`Leads processados: ${leads.length} (${semTelefone} sem telefone)`);
for (const l of leads) {
  console.log(`${l.nota}/${l.avaliacoes} · ${l.angulo} · ${l.nome}`);
}
console.log(`Salvo em: ${SAIDA}`);