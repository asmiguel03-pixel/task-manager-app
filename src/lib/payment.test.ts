import { describe, expect, it } from "vitest";
import { monthLabel, newMonthInputs, paymentAlerts, paymentSummary, shiftMonth } from "./payment-domain";
import { paymentSheet } from "./payment-export";
import { parsePaymentWorkbook, statusFromText, toDate } from "./payment-import";
import type { Payment } from "./payment-schema";
import type { CellValue, ReadSheet } from "./xlsx-read";

const base = {
  sheet: "criticos" as const,
  month: "2026-11",
  branch: "Matriz",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const p = (id: string, over: Partial<Payment>): Payment => ({
  ...base,
  id,
  order: Number(id.replace(/\D/g, "")) || 0,
  supplier: `Fornecedor ${id}`,
  status: "nao_recebido",
  ...over,
});

describe("meses", () => {
  it("formata e navega entre meses", () => {
    expect(monthLabel("2026-11")).toBe("Novembro/2026");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("começa o mês com os fornecedores do mês anterior, em branco", () => {
    const prev = [
      p("a1", { month: "2026-10", amount: 10, status: "pago" }),
      p("a2", { month: "2026-10", branch: "Filial 2" }),
    ];
    const next = newMonthInputs(prev, "criticos", "2026-11");
    expect(next).toEqual([
      { sheet: "criticos", month: "2026-11", order: 0, supplier: "Fornecedor a1", branch: "Matriz", status: "nao_recebido" },
      { sheet: "criticos", month: "2026-11", order: 1, supplier: "Fornecedor a2", branch: "Filial 2", status: "nao_recebido" },
    ]);
  });
});

describe("alertas", () => {
  const kinds = (list: Payment[], today = "2026-11-10") => paymentAlerts(list, today).map((a) => `${a.entryId}:${a.kind}`);

  it("aponta vencidos, vence hoje e vence logo", () => {
    expect(
      kinds([
        p("1", { dueDate: "2026-11-09", status: "enviado", amount: 1 }),
        p("2", { dueDate: "2026-11-10", status: "enviado", amount: 1 }),
        p("3", { dueDate: "2026-11-13", status: "recebido" }),
        p("4", { dueDate: "2026-11-09", status: "pago", paidDate: "2026-11-09", amount: 1 }),
      ]),
    ).toEqual(["1:overdue", "2:due_today", "3:due_soon"]);
  });

  it("não acusa atraso quando o vencimento cai em domingo/feriado", () => {
    const sunday = [p("1", { dueDate: "2026-11-01", status: "recebido" })]; // 02/11 é Finados
    expect(kinds(sunday, "2026-11-02")).toEqual(["1:due_soon"]);
    expect(kinds(sunday, "2026-11-03")).toEqual(["1:due_today"]);
    expect(kinds(sunday, "2026-11-04")).toEqual(["1:overdue"]);
  });

  it("aponta inconsistências de status, título repetido e ano estranho", () => {
    expect(
      kinds([
        p("1", { status: "pago", amount: 1 }),
        p("2", { status: "enviado", paidDate: "2026-11-05", amount: 1 }),
        p("3", { status: "recebido", titleNumber: "123456" }),
        p("4", { status: "recebido", titleNumber: " 123456 " }),
        p("5", { status: "recebido", issueDate: "2025-01-04" }),
        p("6", { status: "recebido", titleNumber: "-" }),
        p("7", { status: "enviado" }),
      ]),
    ).toEqual([
      "1:paid_no_date",
      "2:date_not_paid",
      "3:duplicate_title",
      "4:duplicate_title",
      "5:odd_date",
      "7:no_amount",
    ]);
  });

  it("resume os valores do mês", () => {
    const s = paymentSummary(
      [p("1", { amount: 100, status: "pago", paidDate: "2026-11-01" }), p("2", { amount: 50.5, dueDate: "2026-11-02", status: "enviado" })],
      "2026-11-10",
    );
    expect(s).toMatchObject({ count: 2, paidCount: 1, openCount: 1, overdueCount: 1, total: 150.5, paidTotal: 100, openTotal: 50.5 });
  });
});

describe("importação", () => {
  const row = (cells: CellValue[]) => new Map(cells.map((v, i) => [i, v] as [number, CellValue]).filter(([, v]) => v !== ""));
  const sheet = (name: string, rows: CellValue[][], hidden = false): ReadSheet => ({
    name,
    hidden,
    rows: new Map(rows.map((r, i) => [i + 1, row(r)])),
  });

  it("reconhece datas do Excel e texto", () => {
    expect(toDate(46336)).toBe("2026-11-10");
    expect(toDate("09/11/2026")).toBe("2026-11-09");
    expect(toDate("24/10/206")).toBeUndefined();
    expect(toDate("31/02/2026")).toBeUndefined();
  });

  it("traduz o texto de observação em status", () => {
    expect(statusFromText("pagamento efetivado", false)).toBe("pago");
    expect(statusFromText("Encaminhado para pagamento", false)).toBe("enviado");
    expect(statusFromText("novo boleto solicitado", false)).toBe("novo_boleto");
    expect(statusFromText("Não recebido", false)).toBe("nao_recebido");
    expect(statusFromText("Recebido em via de programação", false)).toBe("recebido");
  });

  it("lê abas de mês no formato das planilhas de controle", () => {
    const months = parsePaymentWorkbook(
      [
        sheet("Oculta", [["Fornecedor"], ["X"]], true),
        sheet("Novembro", [
          ["", "", "PAGAMENTOS IMPORTANTES 2026"],
          ["Fornecedor", "Filial", "Competencia", "Emissão", "Valor", "Dta Venc", "Data Efetivo Pagto", "N° do título", "Observação"],
          ["Fornecedor A ", "Matriz", 46296, 46296, -1234.5, 46335, "", "111", "Enviado para pagamento"],
          ["Fornecedor B", "Filial 2", "Não recebido", "Não recebido", "Não recebido", "Não recebido", "", "Não recebido"],
          ["Fornecedor C", "Matriz", "", "24/10/206", 100, 46343, "", "", ""],
        ]),
      ],
      2025,
    );
    expect(months).toHaveLength(1);
    const [m] = months;
    expect(m).toMatchObject({ tab: "Novembro", month: "2026-11", sheetGuess: "criticos" });
    expect(m.rows[0]).toMatchObject({
      supplier: "Fornecedor A",
      amount: 1234.5,
      dueDate: "2026-11-09",
      titleNumber: "111",
      status: "enviado",
    });
    expect(m.rows[1]).toMatchObject({ supplier: "Fornecedor B", status: "nao_recebido" });
    expect(m.rows[1].amount).toBeUndefined();
    expect(m.rows[2]).toMatchObject({ status: "recebido", notes: "Emissão original: 24/10/206" });
    expect(m.warnings).toHaveLength(1);
  });
});

describe("planilha de envio", () => {
  it("monta título, cabeçalho no layout e totais com fórmulas", () => {
    const ws = paymentSheet(
      [p("1", { amount: 100, status: "pago", paidDate: "2026-11-01" }), p("2", { amount: 50, status: "enviado", dueDate: "2026-11-02" })],
      "criticos",
      "2026-11",
      "2026-11-10",
    );
    expect(ws.name).toBe("11. Novembro");
    expect(ws.merges).toEqual(["A1:I1", "A2:I2"]);
    const header = ws.rows[2].cells.map((c) => (typeof c === "object" && c && "v" in c ? c.v : c));
    expect(header[0]).toBe("Fornecedor");
    expect(header[7]).toBe("N° do título");
    const total = ws.rows.at(-3)!.cells[4];
    expect(total).toMatchObject({ v: { formula: "SUM(E4:E5)", value: 150 } });
  });
});
