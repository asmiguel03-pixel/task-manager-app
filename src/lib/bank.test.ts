import { describe, expect, it } from "vitest";
import { guessLedgerColumns, ledgerFromTable, reconcileBank, reconSummary, type LedgerEntry } from "./bank-reconcile";
import type { StatementEntry } from "./bank-statement";
import { tableFromSheet } from "./reconcile";
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
});
