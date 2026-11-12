import { describe, expect, it } from "vitest";
import {
  docKeys,
  emailText,
  groupResults,
  guessReportColumns,
  guessSapColumns,
  parseDelimited,
  reconcile,
  reconcileSummary,
  tableFromSheet,
  toAmount,
} from "./reconcile";
import type { CellValue, ReadSheet } from "./xlsx-read";

const sheet = (rows: (CellValue | "")[][], name = "Plan1"): ReadSheet => ({
  name,
  hidden: false,
  rows: new Map(
    rows.map((r, i) => [
      i + 1,
      new Map(r.map((v, c) => [c, v] as [number, CellValue | ""]).filter((e): e is [number, CellValue] => e[1] !== "")),
    ]),
  ),
});
const br = (iso: string) => iso.split("-").reverse().join("/");

describe("leitura", () => {
  it("lê CSV com ; e aspas, sem perder zeros à esquerda", () => {
    const s = parseDelimited('Nº NF;Fornecedor;Valor\n000123;"Empresa; Ltda";1.234,56\n', "rel.csv");
    expect([...s.rows.get(2)!.values()]).toEqual(["000123", "Empresa; Ltda", "1.234,56"]);
  });

  it("acha o cabeçalho abaixo de um título", () => {
    const t = tableFromSheet(
      sheet([["RELATÓRIO DE TÍTULOS - NOVEMBRO"], [], ["NF", "Fornecedor", "Valor", "Vencimento"], [101, "A", 10, 46330], ["", "", ""]]),
    )!;
    expect(t.headerRow).toBe(3);
    expect(t.headers).toEqual(["NF", "Fornecedor", "Valor", "Vencimento"]);
    expect(t.rows).toHaveLength(1);
  });

  it("entende valores e números de documento", () => {
    expect(toAmount("1.234,56")).toBe(1234.56);
    expect(toAmount("R$ 10,00")).toBe(10);
    expect(toAmount("1234.56-")).toBe(-1234.56);
    expect(toAmount("1.234")).toBe(1234);
    expect(toAmount("abc")).toBeUndefined();
    expect(docKeys("000012345-001")).toEqual(["12345"]);
    expect(docKeys(4521)).toEqual(["4521"]);
    expect(docKeys("45")).toEqual(["45"]);
    expect(docKeys("Total")).toEqual([]);
  });

  it("sugere colunas de relatório e de extração do SAP", () => {
    expect(guessReportColumns(["Fornecedor", "Nº NF", "Emissão", "Valor", "Vencimento"])).toEqual({
      doc: 1,
      supplier: 0,
      amount: 3,
      due: 4,
    });
    expect(
      guessSapColumns(["Conta", "Referência", "Nº documento", "Data do documento", "Vencimento líquido", "Montante em moeda interna", "Doc.compensação", "Data de compensação"]),
    ).toEqual({ doc: 1, doc2: 2, amount: 5, due: 4, clearingDate: 7, clearingDoc: 6 });
    // Extração do SAP em inglês (S/4HANA), como a usada nas planilhas de controle.
    expect(
      guessSapColumns(["Supplier Name", "Supplier", "Reference", "Journal Entry", "Journal Entry Date", "Posting Date", "Amount (CoCode Crcy)", "Assignment", "Clearing Journal Entry", "Net Due Date"]),
    ).toEqual({ doc: 2, doc2: 3, name: 0, amount: 6, due: 9, clearingDoc: 8 });
  });
});

describe("cruzamento", () => {
  const today = "2026-11-11";
  const report = tableFromSheet(
    sheet([
      ["Fornecedor", "NF", "Valor", "Vencimento"],
      ["Alfa", "1001", "500,00", "05/11/2026"], // lançado e pago
      ["Beta", "1002", "300,00", "08/11/2026"], // lançado, vencido em aberto
      ["Gama", "1003", "200,00", "20/11/2026"], // lançado, a vencer
      ["Delta", "1004", "150,00", "01/11/2026"], // não lançado, vencido
      ["Épsilon", "1005", "90,00", "25/11/2026"], // lançado com valor diferente
      ["", "Total", "1.240,00", ""],
    ]),
  )!;
  const sap = tableFromSheet(
    sheet([
      ["Referência", "Nº documento", "Vencimento líquido", "Montante em moeda interna", "Doc.compensação", "Data de compensação"],
      ["000001001-1", 5100000001, 46331, -500, 1500000001, 46333],
      ["1002", 5100000002, 46334, -300, "", ""],
      ["NF 1003", 5100000003, 46346, -200, "", ""],
      ["1005", 5100000005, 46351, -95, "", ""],
    ]),
  )!;
  const rows = reconcile(report, guessReportColumns(report.headers), sap, guessSapColumns(sap.headers), today);

  it("marca lançado, não lançado, pago e vencido", () => {
    expect(rows.map((r) => [r.doc, r.posted, r.payment, r.paidDate])).toEqual([
      ["1001", "posted", "paid", "2026-11-07"],
      ["1002", "posted", "open_overdue", undefined],
      ["1003", "posted", "open", undefined],
      ["1004", "not_posted", "unknown", undefined],
      ["1005", "posted_diff", "open", undefined],
    ]);
    expect(rows[4]).toMatchObject({ amount: 90, sapAmount: -95, note: "Valor diferente no SAP" });
  });

  it("resume e monta o texto do e-mail", () => {
    expect(reconcileSummary(rows, today)).toEqual({
      total: 5,
      posted: 4,
      postedDiff: 1,
      notPosted: 1,
      overdue: 3,
      overduePaid: 1,
      overdueOpen: 1,
      overdueNotPosted: 1,
    });
    const text = emailText(rows, today, br);
    expect(text).toContain("• Não lançados: 1");
    expect(text).toContain("• 1004 (Delta) — R$ 150,00");
    expect(text).toContain("• 1002 (Beta) — R$ 300,00 — venceu em 08/11/2026");
  });
});

describe("faturas com vários documentos (CT-e)", () => {
  const today = "2026-11-11";
  const report = tableFromSheet(
    sheet([
      ["FATURA", "CLIENTE", "DOCUMENTO", "VALOR", "VENCIMENTO"],
      [900001, "Cliente X", 1001, 100, 46331], // fatura lançada CT-e a CT-e, paga
      [900001, "Cliente X", 1002, 50, 46331],
      [900002, "Cliente X", 2001, 70, 46346], // fatura lançada inteira (pelo nº da fatura)
      [900002, "Cliente X", 2002, 30, 46346],
      [900003, "Cliente X", 3001, 10, 46331], // parcial: 3002 falta
      [900003, "Cliente X", 3002, 20, 46331],
      [900004, "Cliente X", 4001, 40, 46330], // não lançada e vencida
    ]),
  )!;
  const rc = guessReportColumns(report.headers);
  const sap = tableFromSheet(
    sheet([
      ["Referência", "Nº documento", "Montante em moeda interna", "Data de compensação"],
      ["000001001", 51, -100, 46332],
      ["000001002", 52, -50, 46332],
      ["FAT 900002", 53, -100, ""],
      ["3001", 54, -10, ""],
    ]),
  )!;
  const rows = reconcile(report, rc, sap, guessSapColumns(sap.headers), today);

  it("reconhece FATURA como agrupador e DOCUMENTO como o CT-e", () => {
    expect(rc).toEqual({ doc: 2, group: 0, supplier: 1, amount: 3, due: 4 });
  });

  it("acha pelo CT-e e, se não houver, pela fatura comparando o total", () => {
    expect(rows.map((r) => [r.doc, r.posted, r.matchedBy ?? "-", r.payment])).toEqual([
      ["1001", "posted", "doc", "paid"],
      ["1002", "posted", "doc", "paid"],
      ["2001", "posted", "group", "open"],
      ["2002", "posted", "group", "open"],
      ["3001", "posted", "doc", "open_overdue"],
      ["3002", "not_posted", "-", "unknown"],
      ["4001", "not_posted", "-", "unknown"],
    ]);
  });

  it("resume por fatura", () => {
    expect(groupResults(rows, today).map((g) => [g.group, g.count, g.total, g.posted, g.payment])).toEqual([
      ["900001", 2, 150, "posted", "paid"],
      ["900002", 2, 100, "posted", "open"],
      ["900003", 2, 30, "partial", "open_overdue"],
      ["900004", 1, 40, "not_posted", "unknown"],
    ]);
    const text = emailText(rows, today, br);
    expect(text).toContain("(4 faturas, 7 documentos)");
    expect(text).toContain("• Fatura 900004 — 1 documento — R$ 40,00 — venc. 04/11/2026");
    expect(text).toContain("faltam: 3002");
  });
});

describe("CNPJ", () => {
  const t = (headers: string[], rows: (string | number)[][]) => ({ name: "x", headerRow: 1, headers, rows });
  it("acha pelo CNPJ e valor quando o nº não bate, e não aceita nº igual de outro CNPJ", () => {
    const report = t(["Beneficiário", "CPF/CNPJ", "Venc.", "Nº Doc.", "A Pagar"], [
      ["FORNECEDOR A", "11.222.333/0001-81", "14/11/2026", "170-03", 1833],
      ["FORNECEDOR B", "44.555.666/0001-99", "15/11/2026", "999", 50],
    ]);
    const sap = t(["Título", "CNPJ/CPF", "Nome Fornecedor", "Valor Aberto", "Vencimento", "NF Entrada"], [
      ["5551/A", "11222333000270", "FORNECEDOR A", 1833, "14/11/2026", 8888],
      ["999", "77888999000100", "OUTRO", 50, "15/11/2026", 1],
    ]);
    const rc = guessReportColumns(report.headers);
    const sc = guessSapColumns(sap.headers);
    expect(rc.taxId).toBe(1);
    expect(sc.taxId).toBe(1);
    const rows = reconcile(report, rc, sap, sc, "2026-11-12");
    expect(rows[0].posted).toBe("posted");
    expect(rows[0].note).toContain("CNPJ");
    expect(rows[1].posted).toBe("not_posted");
  });
});
