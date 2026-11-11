import { describe, expect, it } from "vitest";
import { checkPaymentsAgainstSap, nameTokens, sameSupplier, sapStateText } from "./payment-sap";
import type { Payment } from "./payment-schema";
import { guessSapColumns, tableFromSheet } from "./reconcile";
import type { CellValue } from "./xlsx-read";

const today = "2026-11-11";
const serial = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000 + 25_569;
const p = (id: string, over: Partial<Payment>): Payment => ({
  id,
  sheet: "criticos",
  month: "2026-11",
  order: 0,
  supplier: "X",
  branch: "",
  status: "recebido",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});
const sapTable = (rows: (CellValue | "")[][]) =>
  tableFromSheet({
    name: "SAP",
    hidden: false,
    rows: new Map(
      rows.map((r, i) => [
        i + 1,
        new Map(r.map((v, c) => [c, v] as [number, CellValue | ""]).filter((e): e is [number, CellValue] => e[1] !== "")),
      ]),
    ),
  })!;

describe("nomes de fornecedor", () => {
  it("ignora acentos, pontuação e sufixos", () => {
    expect(nameTokens("Telefônica Brasil S.A.")).toEqual(["TELEFONICA"]);
    expect(sameSupplier("TELEFONICA BRASIL SA", "Telefônica Brasil S.A.")).toBe(true);
    expect(sameSupplier("ALPHA CARE LABORARE - GESTÃO", "ALPHA CARE LABORARE - GESTAO EM SAUDE LTDA")).toBe(true);
    expect(sameSupplier("CEMIG DISTRIBUIDORA S.A", "CEMIG GERACAO E TRANSMISSAO SA")).toBe(false);
    expect(sameSupplier("MARCOS ROBERTO DOS SANTOS", "MARCOS ANDRADE DOS SANTOS")).toBe(false);
  });
});

describe("planilha de controle x SAP", () => {
  const sap = sapTable([
    ["Supplier Name", "Supplier", "Reference", "Journal Entry", "Amount (CoCode Crcy)", "Clearing Journal Entry", "Clearing Date", "Net Due Date"],
    ["FORNECEDOR TITULO LTDA", "100", "000037013", "5100000001", -1259.3, "1500000001", serial("2026-11-06"), serial("2026-11-06")],
    ["GAS BUTANO DISTRIBUIDORA", "101", "710", "5100000002", -37616.97, "", "", serial("2026-11-05")],
    ["GAS BUTANO DISTRIBUIDORA", "101", "711", "5100000003", -29293.55, "", "", serial("2026-11-05")],
    ["GAS BUTANO DISTRIBUIDORA", "101", "999", "5100000009", -500, "", "", serial("2026-11-05")],
    ["ENERGIA SA", "102", "466477", "5100000004", -72416.59, "", "", serial("2026-11-20")],
    ["PARCIAL LTDA", "103", "18838", "5100000005", -100, "1500000002", serial("2026-11-03"), serial("2026-11-03")],
    ["PARCIAL LTDA", "103", "18839", "5100000006", -50, "", "", serial("2026-11-03")],
  ]);
  const sc = guessSapColumns(sap.headers);
  const entries = [
    p("titulo", { supplier: "FORNECEDOR TITULO", titleNumber: "37013", amount: 1259.3, status: "enviado", dueDate: "2026-11-06" }),
    p("soma", { supplier: "GAS BUTANO DISTRIBUIDORA", amount: 66910.52, dueDate: "2026-11-05", status: "enviado" }),
    p("diz-pago", { supplier: "ENERGIA", titleNumber: "466477", amount: 72416.59, status: "pago", paidDate: "2026-11-10", dueDate: "2026-11-20" }),
    p("parcial", { supplier: "PARCIAL", titleNumber: "18838, 18839", amount: 150, status: "enviado", dueDate: "2026-11-03" }),
    p("sumiu", { supplier: "QUALQUER", amount: 10, dueDate: "2026-11-02", status: "enviado" }),
    p("nao-recebido", { supplier: "OUTRO", status: "nao_recebido" }),
  ];
  const r = checkPaymentsAgainstSap(entries, sap, sc, today);
  const view = (id: string) => {
    const x = r.get(id)!;
    return [x.state, x.matchedBy ?? "-", x.issues.map((i) => i.severity).join(",")];
  };

  it("reconhece as colunas da extração em inglês", () => {
    expect(sc).toMatchObject({ doc: 2, doc2: 3, name: 0, amount: 4, clearingDoc: 5, clearingDate: 6, due: 7 });
  });

  it("acha pelo título e pela soma de vários títulos do mesmo fornecedor", () => {
    expect(view("titulo")).toEqual(["paid", "title", "warning"]);
    expect(sapStateText(r.get("titulo"))).toBe("Pago no SAP em 06/11/2026");
    expect(view("soma")).toEqual(["overdue", "supplier", "danger"]);
    expect(r.get("soma")!.lines).toEqual([1, 2]);
  });

  it("aponta divergências entre planilha e SAP", () => {
    expect(view("diz-pago")).toEqual(["open", "title", "danger"]);
    expect(r.get("diz-pago")!.issues[0].message).toBe("Planilha diz pago, mas está em aberto no SAP.");
    expect(view("parcial")).toEqual(["partial", "title", "warning"]);
    expect(view("sumiu")).toEqual(["not_found", "-", "danger"]);
    expect(view("nao-recebido")).toEqual(["not_found", "-", ""]);
  });
});
