import { describe, expect, it } from "vitest";
import { checkDda, docMatch, systemNameFromFile, taxRoot } from "./dda-check";
import { exportDdaXlsx } from "./dda-export";
import { readXlsx } from "./xlsx-read";

// Dados fictícios.
const t = (headers: string[], rows: (string | number)[][]) => ({ name: "x", headerRow: 1, headers, rows });
const dda = t(["Beneficiário", "CPF/CNPJ", "Venc.", "Nº Doc.", "A Pagar"], [
  ["FORN A", "11.111.111/0001-11", "16/11/2026", "000186053", 1000], // ok
  ["FORN A", "11.111.111/0001-11", "16/11/2026", "000186054", 500], // sistema vence 15/11 (domingo/feriado) → dia útil
  ["FORN B", "22.222.222/0001-22", "10/11/2026", "18519-1", 300], // agrupado: 100 + 200
  ["FORN C", "33.333.333/0001-33", "13/11/2026", "208705-2", 99.99], // valor diferente
  ["FORN C", "33.333.333/0001-33", "20/11/2026", "208705-3", 50], // data diferente
  ["FORN D", "44.444.444/0001-44", "09/11/2026", "28771", 70], // mesmo valor, nº e data diferentes → conferir
  ["FORN E", "55.555.555/0001-55", "09/11/2026", "777", 10], // não tem no sistema
]);
const sys = t(["Fornecedor", "CNPJ/CPF", "Nome Fornecedor", "Título", "Total", "Vencimento"], [
  [1, "11111111000111", "FORN A", "186053.01", 1000, "16/11/2026"],
  [1, "11111111000111", "FORN A", "186054.01", 500, "15/11/2026"],
  [2, "22222222000122", "FORN B", "18519/01", 100, "10/11/2026"],
  [2, "22222222000122", "FORN B", "18518/01", 200, "10/11/2026"],
  [3, "33333333000133", "FORN C", "208705.02", 100, "13/11/2026"],
  [3, "33333333000133", "FORN C", "208705.03", 50, "27/11/2026"],
  [4, "44444444000144", "FORN D", "29109/01", 70, "20/11/2026"],
  [5, "55555555000155", "FORN E", "999/01", 40, "30/11/2026"], // não tem no DDA (fornecedor manda boleto)
  [6, "66666666000166", "FORN F", "1234", 80, "30/11/2026"], // fora do DDA
]);
const dc = { doc: 3, taxId: 1, amount: 4, due: 2, supplier: 0 };
const sc = { doc: 3, taxId: 1, amount: 4, due: 5, supplier: 2 };

describe("conferência DDA × sistema", () => {
  it("marca cada linha como na conferência manual", () => {
    const r = checkDda(dda, dc, sys, sc, "SÊNIOR");
    expect(r.dda.map((s) => s?.label)).toEqual([
      "OK",
      "OK - DIA ÚTIL",
      "OK - AGRUPADO",
      "DIVERGÊNCIA VALOR",
      "DIVERGÊNCIA DATA",
      "CONFERIR",
      "NÃO TEM NO SÊNIOR",
    ]);
    expect(r.system.map((s) => s?.label)).toEqual([
      "OK",
      "OK - DIA ÚTIL",
      "OK - AGRUPADO",
      "OK - AGRUPADO",
      "DIVERGÊNCIA VALOR",
      "DIVERGÊNCIA DATA",
      "CONFERIR",
      "NÃO TEM NO DDA",
      "FORA DO DDA",
    ]);
  });

  it("baixa as duas planilhas com status", async () => {
    const r = checkDda(dda, dc, sys, sc, "SÊNIOR");
    const sheets = await readXlsx(exportDdaXlsx(dda, dc, sys, sc, r, "SÊNIOR"));
    expect(sheets.map((s) => s.name)).toEqual(["Resumo", "Boletos DDA", "Sênior"]);
    expect([...sheets[1].rows.get(1)!.values()].slice(0, 6)).toEqual(["Beneficiário", "CPF/CNPJ", "Venc.", "Nº Doc.", "A Pagar", "Status"]);
    expect([...sheets[2].rows.get(1)!.values()]).toEqual(["Fornecedor", "CNPJ/CPF", "Nome Fornecedor", "Título", "Total", "Status", "Vencimento"]);
    expect(sheets[2].rows.get(2)?.get(6)).toBe(46342); // vencimento vira data
  });

  it("ajudantes", () => {
    expect(taxRoot("11.111.111/0002-90")).toBe("11111111");
    expect(docMatch("NF 226", "2026226-01")).toBe(true);
    expect(docMatch("12", "2026212")).toBe(false);
    expect(systemNameFromFile("Planilha Sênior 11.xlsx")).toBe("SÊNIOR");
    expect(systemNameFromFile("Em aberto.xlsx")).toBe("SISTEMA");
  });
});
