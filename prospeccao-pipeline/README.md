# Pipeline de Prospecção

Gera, a partir de CSVs de leads do Google Maps (exportados por crawler), uma planilha final com **mensagens de prospecção prontas para WhatsApp** (`wa.me`), cada uma classificada por "ângulo de abordagem" e composta por abertura + corpo + fechamento montados de blocos de texto, de modo que **nunca haja duas mensagens com a mesma estrutura** (antispam/variação).

## Comandos

```bash
cd prospeccao-pipeline

# Processar um segmento
node processar.js /caminho/para/leads.csv output/<segmento>_leads_prospeccao.csv

# Validar a saída
node validar.js output/<segmento>_leads_prospeccao.csv
```

O validador deve imprimir `Tudo OK.` e sair com código 0.

## Fluxo do `processar.js`

1. **Parse CSV** — detecta `,`/`;`, respeita aspas e BOM.
2. **Colunas esperadas** (mínimas): `title|name` (nome), `phone|phoneUnformatted` (telefone), `neighborhood|address|street` (bairro/região). Avisa se faltar.
3. **Limpeza de nome** (`nomeCurto`): remove endereço, sufixos de categoria, parênteses e textos após `- Loja/Moda/...`.
4. **Derivações**: bairro, telefone (prefere `phoneUnformatted`; descarta se < 10 dígitos), nota/avaliações, referência (shopping/edifício/wall street), flags `shopping`, `empresarial`, `vinteQuatroHoras`.
5. **Ângulo** (`definirAngulo`):
   - sem link/telefone → `sem-telefone`
   - nota ≥ 4.5 e avaliações < 20 → `credibilidade`
   - shopping → `shopping-muitas` (≥50 aval) ou `shopping`
   - empresarial → `empresarial-muitas` (≥50 aval) ou `empresarial`
   - avaliações ≥ 50 → `muitas`
   - aberto 24h → `24h`
   - senão → `basica`
6. **Mensagem** (`montarMensagem`): escolhe combo (abertura|corpo|fechamento) dos blocos com **unicidade garantida** (fase 1 diagonal + fase 2 varredura rotativa). Substitui placeholders `{NOME_CURTO}`, `{NOTA_TXT}`, `{AVAL}`, `{EM_BAIRRO}`, `{LOC_REF}`, `{DESC_ATUACAO}`.
7. **Dedup**: por `nomeCurto|DDD`, mantém o de mais avaliações.
8. **Ordenação**: nota desc, depois avaliações desc.
9. **Saída**: CSV UTF-8 com BOM: `Nome,Bairro/Região,Telefone,Link WhatsApp,Nota,Avaliações,Ângulo,Mensagem`.

## Formatos de entrada

- **Formato crawler padrão**: `title`, `phone`/`phoneUnformatted`, `neighborhood`, `address`, `categoryName`, `reviewsCount`, `totalscore`, `url`, etc.
- **Formato limpo**: `nome`, `telefone`/`telefone_formatado`, `bairro`, `cidade`, `nota`, `avaliacoes`, `categoria`.

## Ângulos e capacidades de pool

9 ângulos, cada um com `a` (aberturas), `m` (corpos), `f` (fechamentos):

| ângulo            | a | m | f | pool  |
|-------------------|---:|---:|---:|---:|
| sem-telefone      | 5 | 4 | 5 | 100  |
| credibilidade     | 5 | 10| 7 | 350  |
| muitas            | 5 | 5 | 5 | 125  |
| basica            | 5 | 8 | 8 | 320  |
| 24h               | 3 | 3 | 3 | 27   |
| shopping-muitas   | 3 | 3 | 3 | 27   |
| shopping          | 3 | 3 | 3 | 27   |
| empresarial-muitas| 3 | 3 | 3 | 27   |
| empresarial       | 3 | 3 | 3 | 27   |

⚠️ Se a demanda de um ângulo passar o pool, o validador acusa mensagens idênticas. Antes de processar um CSV novo, confira os counts de ângulo esperados e amplie os pools (especialmente `credibilidade` e `basica`, os mais usados).

## Validador (`validar.js`)

- Colunas obrigatórias na saída.
- Sem placeholders `{}` restantes na mensagem.
- Link `https://wa.me/55\d{10,12}` (ou vazio).
- Ângulo "Sem telefone no cadastro" → link vazio; demais → telefone e link preenchidos.
- Nenhuma mensagem repetida (mesmo ângulo e estrutura, normalizando ` em <bairro>`).
- Vizinhos do mesmo ângulo não podem ter a mesma estrutura.

## Saídas geradas (`output/`)

| arquivo | leads |
|---|---|
| `petshop_leads_prospeccao.csv` | 99 |
| `loja_de_roupas_prospeccao.csv` | 92 |
| `barbearia_leads_prospeccao.csv` | 505 |
| `clinica_estetica_prospeccao.csv` | 50 |
| `santa_catarina_prospeccao.csv` | 737 |
