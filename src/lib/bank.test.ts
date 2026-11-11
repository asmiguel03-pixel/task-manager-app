import { describe, expect, it } from "vitest";
import { bestLedgerTable, guessLedgerColumns, ledgerForPeriod, ledgerFromTable, statementRange, reconcileBank, reconSummary, type LedgerEntry } from "./bank-reconcile";
import type { StatementEntry } from "./bank-statement";
import { exportBankXlsx } from "./bank-export";
import { tableFromSheet } from "./reconcile";
import { readXlsx } from "./xlsx-read";
import type { CellValue } from "./xlsx-read";

const st = (date: string, amount: number, description = ""): StatementEntry => ({ date, amount, description });
const lg = (date: string, amount: number, description = ""): LedgerEntry => ({ date, amount, description });

describe("conciliação bancária", () => {
  const statement = [
    st("2026-10-01", 1298.13, "Crédito CASSI"),
    st("2026-10-02", -120, "Tar Extrato Padrão Swift"),
    st("2026-10-05", 394.8, "Cielo Vendas Débito"),
    st("2026-10-26", 305.79, "Cielo Vendas Crédito"),
    st("2026-10-26", 394.8, "Cielo Vendas Débito"),
    st("2026-10-26", -27000, "TED"),
    st("2026-10-28", -4310, "Pagto cartão crédito"),
  ];
  const ledger = [
    lg("2026-10-01", 1298.13, "Recebimento CASSI"),
    lg("2026-10-06", 394.8, "Cielo"), // um dia depois
    lg("2026-10-26", 700.59, "Cielo vendas 26/10"), // soma de duas vendas
    lg("2026-10-26", -27000, "Transferência Bradesco"),
    lg("2026-10-28", -4310, "Cartão corporate"),
    lg("2026-10-30", -1500, "Cheque 123"), // não está no extrato
  ];
  const r = reconcileBank(statement, ledger);

  it("cruza 1:1 com folga de dias e agrupa somas", () => {
    expect(r.matches.map((m) => [m.statement, m.ledger, m.kind])).toEqual([
      [[0], [0], "1:1"],
      [[2], [1], "1:1"],
      [[3, 4], [2], "grupo"],
      [[5], [3], "1:1"],
      [[6], [4], "1:1"],
    ]);
    expect(r.onlyStatement).toEqual([1]);
    expect(r.onlyLedger).toEqual([5]);
  });

  it("explica a diferença de saldo pelas pendências", () => {
    const s = reconSummary({ closing: 1000 }, { closing: 2620 }, statement, ledger, r);
    // só no extrato: −120 (tarifa não lançada); só no razão: −1.500 (cheque não compensado)
    expect(s).toEqual({ statementClosing: 1000, ledgerClosing: 2620, difference: -1620, explained: 1380, unexplained: -3000 });
  });
});

describe("razão em planilha", () => {
  const sheet = (rows: (CellValue | "")[][]) =>
    tableFromSheet({
      name: "Razão",
      hidden: false,
      rows: new Map(
        rows.map((r, i) => [
          i + 1,
          new Map(r.map((v, c) => [c, v] as [number, CellValue | ""]).filter((e): e is [number, CellValue] => e[1] !== "")),
        ]),
      ),
    })!;

  it("lê colunas Débito/Crédito/Saldo e o saldo anterior", () => {
    const t = sheet([
      ["Data", "Lote", "Histórico", "Débito", "Crédito", "Saldo"],
      ["", "", "SALDO ANTERIOR", "", "", "4.046,72 D"],
      ["01/10/2026", "12", "Recebimento CASSI", "1.298,13", "", "5.344,85 D"],
      ["02/10/2026", "13", "Tarifa bancária", "", "120,00", "5.224,85 D"],
    ]);
    const c = guessLedgerColumns(t.headers);
    expect(c).toMatchObject({ date: 0, doc: 1, description: 2, debit: 3, credit: 4, balance: 5 });
    const l = ledgerFromTable(t, c);
    expect(l.opening).toBe(4046.72);
    expect(l.closing).toBe(5224.85);
    expect(l.entries.map((e) => [e.date, e.amount])).toEqual([
      ["2026-10-01", 1298.13],
      ["2026-10-02", -120],
    ]);
    expect(l.warnings).toEqual([]);
  });
});

describe("leitura de PDF", () => {
  // PDF mínimo com uma tabela no layout do Banco do Brasil.
  const pdf = (content: string) => {
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>",
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
    let out = "%PDF-1.4\n";
    objs.forEach((o, i) => (out += `${i + 1} 0 obj\n${o}\nendobj\n`));
    out += "trailer\n<< /Root 1 0 R >>\n%%EOF";
    return new Uint8Array([...out].map((c) => c.charCodeAt(0)));
  };
  const cell = (x: number, y: number, s: string) => `BT /F1 8 Tf ${x} ${y} Td (${s}) Tj ET\n`;

  it("lê o texto com posição e monta o extrato do BB", async () => {
    const content =
      cell(56, 709, "Ag\\352ncia") + cell(147, 709, "1912-7") +
      cell(56, 698, "Conta corrente") + cell(147, 698, "13835-5") +
      cell(60, 640, "Dt. balancete") + cell(254, 640, "Hist\\363rico") + cell(400, 640, "Documento") + cell(463, 640, "Valor R$") + cell(525, 640, "Saldo") +
      cell(65, 628, "30/09/2026") + cell(254, 628, "Saldo Anterior") + cell(456, 628, "4.046,72 C") + cell(507, 628, "4.046,72 C") +
      cell(65, 617, "01/10/2026") + cell(254, 617, "Cr\\351dito CASSI") + cell(416, 617, "170.343") + cell(456, 617, "1.298,13 C") + cell(507, 617, "5.344,85 C") +
      cell(254, 605, "CAIXA DE ASSISTENCI") +
      cell(65, 593, "02/10/2026") + cell(254, 593, "Tarifa") + cell(463, 593, "120,00 D") + cell(507, 593, "5.224,85 C") +
      cell(65, 580, "31/10/2026") + cell(254, 580, "S A L D O") + cell(507, 580, "5.224,85 C") +
      cell(60, 560, "Ouvidoria BB 0800");
    const { readPdfText, toLines } = await import("./pdf-text");
    const { parseStatement } = await import("./bank-statement");
    const s = parseStatement(toLines(await readPdfText(pdf(content))));
    expect(s).toMatchObject({ bank: "Banco do Brasil", account: "Ag. 1912-7 · CC 13835-5", opening: 4046.72, closing: 5224.85, warnings: [] });
    expect(s.entries.map((e) => [e.date, e.amount, e.description])).toEqual([
      ["2026-10-01", 1298.13, "Crédito CASSI · CAIXA DE ASSISTENCI"],
      ["2026-10-02", -120, "Tarifa"],
    ]);
  });

  it("Caixa: sinal de menos separado do valor e saldo em R$", async () => {
    const content =
      cell(21, 732, "Ag\\352ncia: 03337") + cell(190, 732, "Conta: 000577247208-5") +
      cell(361, 690, "Lan\\347amentos de 01/10/2026 \\340 26/10/2026") +
      cell(28, 657, "Data de") + cell(134, 657, "Data de") +
      cell(238, 650, "Documento") + cell(304, 650, "Hist\\363rico") + cell(447, 650, "Valor\\(R$\\)") + cell(511, 650, "Saldo\\(R$\\)") +
      cell(304, 616, "MENSALIDADE") +
      cell(28, 609, "13/10/2026") + cell(134, 609, "13/10/2026") + cell(238, 609, "202609") + cell(460, 609, "- 189,00") + cell(511, 609, "R$ 203,76") +
      cell(28, 576, "13/10/2026") + cell(134, 576, "13/10/2026") + cell(304, 576, "SAUDE CAIXA") + cell(453, 576, "13.078,08") + cell(511, 576, "R$ 13.281,84") +
      cell(28, 549, "13/10/2026") + cell(134, 549, "13/10/2026") + cell(304, 549, "SALDO DIA") + cell(478, 549, "0,00") + cell(511, 549, "R$ 13.281,84") +
      cell(493, 522, "-") +
      cell(28, 516, "23/10/2026") + cell(134, 516, "23/10/2026") + cell(238, 516, "932834") + cell(304, 516, "ENVIO DE TED") + cell(511, 516, "R$ 281,84") +
      cell(453, 509, "13.000,00") +
      cell(28, 437, "SAC CAIXA");
    const { readPdfText, toLines } = await import("./pdf-text");
    const { parseStatement } = await import("./bank-statement");
    const s = parseStatement(toLines(await readPdfText(pdf(content))));
    expect(s).toMatchObject({ bank: "Caixa", opening: 392.76, closing: 281.84, warnings: [] });
    expect(s.entries.map((e) => [e.date, e.amount])).toEqual([
      ["2026-10-13", -189],
      ["2026-10-13", 13078.08],
      ["2026-10-23", -13000],
    ]);
  });

  it("Santander: do mais novo para o mais antigo, sem saldo anterior", async () => {
    const content =
      cell(429, 783, "Santander Empresas") + cell(367, 736, "Ag\\352ncia: 4395") + cell(484, 736, "Conta: 130002838") +
      cell(49, 662, "Data") + cell(95, 662, "Hist\\363rico") + cell(306, 662, "Documento") + cell(423, 662, "Valor \\(R$\\)") + cell(518, 662, "Saldo \\(R$\\)") +
      cell(33, 639, "30/10/2026") + cell(92, 639, "Ted Recebida") + cell(423, 639, "10.000,00") + cell(514, 639, "10.900,00") +
      cell(92, 621, "Pgto Fornec Tit Proprios") +
      cell(33, 614, "29/10/2026") + cell(312, 614, "301029") + cell(425, 614, "-100,00") + cell(514, 614, "900,00") +
      cell(92, 607, "4395.4905337371") +
      cell(390, 560, "Saldo de ContaMax");
    const { readPdfText, toLines } = await import("./pdf-text");
    const { parseStatement } = await import("./bank-statement");
    const s = parseStatement(toLines(await readPdfText(pdf(content))));
    expect(s).toMatchObject({ bank: "Santander", opening: 1000, closing: 10900, warnings: [] });
    expect(s.entries.map((e) => [e.date, e.amount, e.description])).toEqual([
      ["2026-10-29", -100, "Pgto Fornec Tit Proprios · 4395.4905337371"],
      ["2026-10-30", 10000, "Ted Recebida"],
    ]);
  });
});

describe("razão no layout do Contmatic", () => {
  const sheet = (name: string, data: CellValue[][]) => ({
    name,
    hidden: false,
    rows: new Map(data.map((r, i) => [i + 1, new Map(r.map((v, j) => [j, v] as [number, CellValue]).filter(([, v]) => v !== ""))])),
  });
  const capa = sheet("CAPA", [["Empresa Exemplo Ltda"], ["Razão analítico"], ["Período: 01/09/2026 a 31/10/2026"]]);
  const razao = sheet("Razão", [
    ["1.01.01.02.01.01.000006", "5 - BANCO EXEMPLO"],
    ["DATA", "LOTE", "LANC", "C/PARTIDA", "HISTORICO", "DÉBITO", "CRÉDITO", "SALDO"],
    ["", "", "", "Saldo anterior", "", "", "", "-"],
    ["02/09/2026", 67, 9296, "1.01.02.02.01.01.000001", "RECEBIMENTO CLIENTE A", "400,00", "-", "400,00"],
    ["15/09/2026", 68, 9301, "2.01.01.01.01.01.000002", "PAGAMENTO FORNECEDOR B", "-", "150,00", "250,00"],
    ["01/10/2026", 70, 9400, "1.01.02.02.01.01.000001", "RECEBIMENTO CLIENTE C", "1.000,00", "-", "1.250,00"],
    ["20/10/2026", 71, 9410, "4.01.01.01.01.01.000003", "TARIFA BANCÁRIA", "-", "50,00", "1.200,00"],
    ["03/11/2026", 72, 9500, "1.01.02.02.01.01.000001", "RECEBIMENTO CLIENTE D", "10,00", "-", "1.210,00"],
  ]);

  it("acha o cabeçalho, a aba certa e as colunas", () => {
    const tables = [capa, razao].map((s) => tableFromSheet(s)!).filter(Boolean);
    const i = bestLedgerTable(tables);
    expect(tables[i].name).toBe("Razão");
    expect(tables[i].headers[0]).toBe("DATA");
    const c = guessLedgerColumns(tables[i].headers);
    expect(c.date).toBe(0);
    expect(c.doc).toBe(1);
    expect(c.description).toBe(4);
    expect(c.debit).toBe(5);
    expect(c.credit).toBe(6);
    expect(c.balance).toBe(7);
    const ledger = ledgerFromTable(tables[i], c);
    expect(ledger.opening).toBe(0);
    expect(ledger.entries.length).toBe(5);
  });

  it("recorta o razão no período do extrato", () => {
    const t = tableFromSheet(razao)!;
    const ledger = ledgerFromTable(t, guessLedgerColumns(t.headers));
    const range = statementRange("01/10/2026 a 31/10/2026", [])!;
    expect(range).toEqual(["2026-10-01", "2026-10-31"]);
    expect(statementRange("10/2026", [])).toEqual(["2026-10-01", "2026-10-31"]);
    const p = ledgerForPeriod(ledger, range);
    expect(p.entries.map((e) => e.amount)).toEqual([1000, -50]);
    expect(p.opening).toBe(250);
    expect(p.closing).toBe(1200);
    expect(p.cut).toEqual({ before: 2, after: 1 });
    expect(p.account).toEqual({ code: "1.01.01.02.01.01.000006", name: "5 - BANCO EXEMPLO" });
  });

  it("baixa a conciliação com CAPA, EXTRATO e Razão", async () => {
    const t = tableFromSheet(razao)!;
    const ledger = ledgerForPeriod(ledgerFromTable(t, guessLedgerColumns(t.headers)), ["2026-10-01", "2026-10-31"]);
    const statement = {
      bank: "Banco Exemplo",
      period: "10/2026",
      opening: 250,
      closing: 1200,
      entries: [st("2026-10-01", 1000, "Crédito"), st("2026-10-20", -50, "Tarifa")],
      warnings: [],
    };
    const r = reconcileBank(statement.entries, ledger.entries, 3);
    const s = reconSummary(statement, ledger, statement.entries, ledger.entries, r);
    const sheets = await readXlsx(exportBankXlsx(statement, ledger, r, s, { company: "EMPRESA" }, "2026-10-31"));
    expect(sheets.map((x) => x.name)).toEqual(["CAPA", "EXTRATO", "Razão"]);
    const capa = sheets[0].rows;
    expect(capa.get(7)?.get(7)).toBe("Outubro/2026");
    expect(capa.get(9)?.get(2)).toBe("1.01.01.02.01.01.000006");
    expect(capa.get(12)?.get(7)).toBe(1200);
    expect(capa.get(17)?.get(8)).toBe(0);
  });
});
