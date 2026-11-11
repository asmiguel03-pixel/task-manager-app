import type { BankReconciliation, Ledger, ReconSummary } from "./bank-reconcile";
import type { Statement } from "./bank-statement";
import { formatBR } from "./work-tools";
import { buildWorkbook, type StyleName, type StyledCell, type WorkbookRow, type WorkbookSheet } from "./xlsx";

const money = (v: number | undefined, s: "tdMoney" | "totalMoney" = "tdMoney"): StyledCell => ({ v: v ?? null, s });
const text = (v: string | undefined, s: "td" | "tdWrap" | "tdCenter" | "totalLabel" = "tdWrap"): StyledCell => ({ v: v ?? "", s });
const date = (iso: string): StyledCell => ({ v: { date: iso }, s: "tdDate" });

function statementSheet(st: Statement, r?: BankReconciliation, ledger?: Ledger): WorkbookSheet {
  const status = new Map<number, [string, "statusGreen" | "statusRed" | "statusBlue"]>();
  const ledgerDate = new Map<number, string>();
  if (r && ledger) {
    for (const m of r.matches) {
      for (const si of m.statement) {
        status.set(si, [m.kind === "1:1" ? "Conciliado" : "Conciliado (somado)", m.kind === "1:1" ? "statusGreen" : "statusBlue"]);
        ledgerDate.set(si, m.ledger.map((li) => formatBR(ledger.entries[li].date)).join(", "));
      }
    }
    for (const si of r.onlyStatement) status.set(si, ["Falta no razão", "statusRed"]);
  }
  const header = ["Data", "Histórico", "Documento", "Entrada", "Saída", "Saldo", ...(r ? ["Situação", "Data no razão"] : [])];
  return {
    name: "Extrato",
    landscape: true,
    freezeRows: 3,
    filterRow: 3,
    printTitleRows: 3,
    merges: [`A1:${r ? "H" : "F"}1`, `A2:${r ? "H" : "F"}2`],
    widths: [12, 56, 22, 15, 15, 15, ...(r ? [20, 16] : [])],
    rows: [
      { height: 28, cells: [{ v: `EXTRATO — ${st.bank.toUpperCase()}${st.account ? ` — ${st.account}` : ""}`, s: "title" }] },
      {
        height: 18,
        cells: [
          {
            v: `${st.period ? `Período ${st.period} · ` : ""}Saldo inicial ${fmt(st.opening)} · Saldo final ${fmt(st.closing)} · ${st.entries.length} lançamentos`,
            s: "subtitle",
          },
        ],
      },
      { height: 26, cells: header.map((h) => ({ v: h, s: "th" as const })) },
      ...st.entries.map((e, i) => {
        const [label, style] = status.get(i) ?? ["", "statusGreen"];
        return {
          cells: [
            date(e.date),
            text(e.description),
            text(e.doc, "tdCenter"),
            money(e.amount > 0 ? e.amount : undefined),
            money(e.amount < 0 ? -e.amount : undefined),
            money(e.balance),
            ...(r ? [{ v: label, s: style }, text(ledgerDate.get(i), "tdCenter")] : []),
          ],
        };
      }),
    ],
  };
}

function ledgerSheet(ledger: Ledger, r: BankReconciliation, st: Statement): WorkbookSheet {
  const status = new Map<number, [string, "statusGreen" | "statusRed" | "statusBlue"]>();
  for (const m of r.matches) {
    for (const li of m.ledger) {
      status.set(li, [m.kind === "1:1" ? "Conciliado" : "Conciliado (somado)", m.kind === "1:1" ? "statusGreen" : "statusBlue"]);
    }
  }
  for (const li of r.onlyLedger) status.set(li, ["Não está no extrato", "statusRed"]);
  const header = ["Data", "Histórico", "Documento", "Débito", "Crédito", "Saldo", "Situação"];
  return {
    name: "Razão",
    landscape: true,
    freezeRows: 3,
    filterRow: 3,
    printTitleRows: 3,
    merges: ["A1:G1", "A2:G2"],
    widths: [12, 56, 16, 15, 15, 15, 22],
    rows: [
      { height: 28, cells: [{ v: `RAZÃO — CONTA ${st.bank.toUpperCase()}`, s: "title" }] },
      {
        height: 18,
        cells: [{ v: `Saldo inicial ${fmt(ledger.opening)} · Saldo final ${fmt(ledger.closing)} · ${ledger.entries.length} lançamentos`, s: "subtitle" }],
      },
      { height: 26, cells: header.map((h) => ({ v: h, s: "th" as const })) },
      ...ledger.entries.map((e, i) => {
        const [label, style] = status.get(i) ?? ["", "statusGreen"];
        return {
          cells: [
            date(e.date),
            text(e.description),
            text(e.doc, "tdCenter"),
            money(e.amount > 0 ? e.amount : undefined),
            money(e.amount < 0 ? -e.amount : undefined),
            money(e.balance),
            { v: label, s: style },
          ],
        };
      }),
    ],
  };
}

const fmt = (n: number | undefined) =>
  n === undefined ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");

/** Folha principal no formato clássico de conciliação para a contabilidade. */
function summarySheet(st: Statement, ledger: Ledger, r: BankReconciliation, s: ReconSummary): WorkbookSheet {
  const rows: WorkbookRow[] = [];
  const merges = ["A1:C1", "A2:C2"];
  /** Linha com rótulo ocupando as colunas A e B. */
  const labelRow = (label: string, value: StyledCell, style: StyleName = "totalLabel") => {
    rows.push({ cells: [{ v: label, s: style }, { v: "", s: style }, value] });
    merges.push(`A${rows.length}:B${rows.length}`);
  };
  rows.push({ height: 28, cells: [{ v: `CONCILIAÇÃO BANCÁRIA — ${st.bank.toUpperCase()}`, s: "title" }] });
  rows.push({ height: 18, cells: [{ v: `${st.account ?? ""}${st.period ? ` · Período ${st.period}` : ""}`, s: "subtitle" }] });
  rows.push({ cells: [] });
  labelRow("Saldo final conforme extrato", money(s.statementClosing, "totalMoney"));
  labelRow("Saldo final conforme razão (contabilidade)", money(s.ledgerClosing, "totalMoney"));
  labelRow("Diferença (extrato − razão)", money(s.difference, "totalMoney"));
  rows.push({ cells: [] });

  const block = (title: string, idx: number[], entries: { date: string; description: string; amount: number }[]) => {
    rows.push({ height: 22, cells: [{ v: title, s: "th" }, { v: "", s: "th" }, { v: "Valor", s: "th" }] });
    merges.push(`A${rows.length}:B${rows.length}`);
    if (!idx.length) labelRow("Nenhum", money(undefined), "td");
    for (const i of idx) {
      const e = entries[i];
      rows.push({ cells: [date(e.date), text(e.description), money(e.amount)] });
    }
    const total = Math.round(idx.reduce((sum, i) => sum + entries[i].amount, 0) * 100) / 100;
    labelRow("Subtotal", money(total, "totalMoney"));
    rows.push({ cells: [] });
  };
  block("(+) No extrato e não contabilizados no razão (entradas +, saídas −)", r.onlyStatement, st.entries);
  block("(−) No razão e não constantes no extrato (débitos +, créditos −)", r.onlyLedger, ledger.entries);
  const ok = s.unexplained !== undefined && Math.abs(s.unexplained) < 0.005;
  labelRow(
    ok ? "Diferença não explicada — conciliado ✓" : "Diferença não explicada — conferir",
    money(s.unexplained, "totalMoney"),
    ok ? "statusGreen" : "statusRed",
  );
  return { name: "Conciliação", fitPortrait: true, widths: [13, 62, 18], merges, rows };
}

export function exportBankXlsx(st: Statement, ledger?: Ledger, r?: BankReconciliation, s?: ReconSummary): Uint8Array {
  if (!ledger || !r || !s) return buildWorkbook([statementSheet(st)]);
  return buildWorkbook([summarySheet(st, ledger, r, s), statementSheet(st, r, ledger), ledgerSheet(ledger, r, st)]);
}
