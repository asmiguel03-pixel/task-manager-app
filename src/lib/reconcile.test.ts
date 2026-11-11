import { describe, expect, it } from "vitest";
import {
  docKeys,
  emailText,
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
