import type { BankReconciliation, Ledger, ReconSummary } from "./bank-reconcile";
import type { Statement } from "./bank-statement";
import { formatBR } from "./work-tools";
import { buildWorkbook, type StyledCell, type WorkbookRow, type WorkbookSheet } from "./xlsx";

const money = (v: number | undefined, s: "tdMoney" | "totalMoney" = "tdMoney"): StyledCell => ({ v: v ?? null, s });
const text = (v: string | undefined, s: "td" | "tdWrap" | "tdCenter" | "totalLabel" = "tdWrap"): StyledCell => ({ v: v ?? "", s });
const date = (iso: string): StyledCell => ({ v: { date: iso }, s: "tdDate" });

function statementSheet(st: Statement, r?: BankReconciliation, ledger?: Ledger, closingLabel?: string): WorkbookSheet {
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
  const rows: WorkbookRow[] = [
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
  ];
  if (closingLabel) {
    rows.push({ cells: [] });
    rows.push({ cells: [null, null, null, null, { v: closingLabel, s: "totalLabel" }, money(st.closing, "totalMoney")] });
  }
  return {
    name: r ? "EXTRATO" : "Extrato",
    landscape: true,
    freezeRows: 3,
    filterRow: 3,
    printTitleRows: 3,
    merges: [`A1:${r ? "H" : "F"}1`, `A2:${r ? "H" : "F"}2`],
    widths: [12, 56, 22, 15, 15, 15, ...(r ? [20, 16] : [])],
    rows,
  };
}

/** Razão no mesmo layout do Contmatic, com o saldo em fórmula e a conferência ao lado. */
function ledgerSheet(ledger: Ledger, r: BankReconciliation, st: Statement): WorkbookSheet {
  const status = new Map<number, [string, "statusGreen" | "statusRed" | "statusBlue"]>();
  for (const m of r.matches) {
    for (const li of m.ledger) {
      status.set(li, [m.kind === "1:1" ? "Conciliado" : "Conciliado (somado)", m.kind === "1:1" ? "statusGreen" : "statusBlue"]);
    }
  }
  for (const li of r.onlyLedger) status.set(li, ["Não está no extrato", "statusRed"]);
  const code = ledger.account?.code ?? "";
  const rows: WorkbookRow[] = [
    { cells: [{ v: code, s: "bold" }, { v: ledger.account?.name ?? st.bank.toUpperCase(), s: "bold" }] },
    {
      cells: [
        ...["DATA", "LOTE", "LANC", "C/PARTIDA", "HISTORICO", "DÉBITO", "CRÉDITO", "SALDO"].map((h) => ({ v: h, s: "header" as const })),
        null,
        { v: "CONFERÊNCIA", s: "header" },
      ],
    },
    { cells: [null, null, null, "Saldo anterior", null, null, null, { v: ledger.opening ?? 0, s: "acc" }] },
  ];
  let balance = ledger.opening ?? 0;
  ledger.entries.forEach((e, i) => {
    const r = rows.length + 1;
    balance = Math.round((balance + e.amount) * 100) / 100;
    const [label, style] = status.get(i) ?? ["", "statusGreen"];
    rows.push({
      cells: [
        { v: { date: e.date }, s: "dateRight" },
        { v: e.doc ?? "", s: "right" },
        { v: e.lanc ?? "", s: "right" },
        e.counterpart ?? "",
        e.description,
        { v: e.amount > 0 ? e.amount : 0, s: "acc" },
        { v: e.amount < 0 ? -e.amount : 0, s: "acc" },
        { v: { formula: `H${r - 1}+F${r}-G${r}`, value: balance }, s: "acc" },
        null,
        { v: label, s: style },
      ],
    });
  });
  const first = 4;
  const last = rows.length;
  const debit = ledger.entries.reduce((s, e) => s + Math.max(e.amount, 0), 0);
  const credit = ledger.entries.reduce((s, e) => s + Math.max(-e.amount, 0), 0);
  rows.push({
    cells: [
      null,
      null,
      null,
      null,
      { v: `Totais conta: ${code}`, s: "bold" },
      { v: { formula: `SUM(F${first}:F${Math.max(first, last)})`, value: Math.round(debit * 100) / 100 }, s: "accBold" },
      { v: { formula: `SUM(G${first}:G${Math.max(first, last)})`, value: Math.round(credit * 100) / 100 }, s: "accBold" },
    ],
  });
  return { name: "Razão", landscape: true, freezeRows: 2, printTitleRows: 2, widths: [22, 8, 9, 24, 70, 13, 13, 13, 3, 20], rows };
}

const fmt = (n: number | undefined) =>
  n === undefined ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");

export interface CapaInfo {
  company?: string;
  signer?: string;
  role?: string;
}

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** Capa no modelo "Conciliação / Análise - Mensal" usado pela contabilidade. */
function capaSheet(
  st: Statement,
  ledger: Ledger,
  r: BankReconciliation,
  s: ReconSummary,
  info: CapaInfo,
  refs: { ledgerClosing: string; statementClosing: string; periodEnd?: string },
): WorkbookSheet {
  const grid: (StyledCell | null)[][] = [];
  const set = (row: number, col: string, cell: StyledCell) => {
    const c = col.charCodeAt(0) - 65;
    grid[row - 1] ??= [];
    grid[row - 1][c] = cell;
  };
  const bar = (row: number, label: string, valueCol?: "H" | "I", value?: StyledCell) => {
    for (const col of "CDEFGHI") set(row, col, { v: "", s: "bar" });
    set(row, "C", { v: label, s: "bar" });
    if (valueCol && value) set(row, valueCol, value);
  };
  const merges: string[] = [];
  const round = (n: number) => Math.round(n * 100) / 100;
  const ledgerClosing = s.ledgerClosing ?? 0;
  const statementClosing = s.statementClosing ?? 0;

  const end = refs.periodEnd ?? st.entries.at(-1)?.date ?? "";
  const month = /^(\d{4})-(\d{2})/.exec(end);
  bar(7, "Conciliação / Análise - Mensal", "H", { v: month ? `${MONTHS[Number(month[2]) - 1]}/${month[1]}` : (st.period ?? ""), s: "barRight" });
  merges.push("H7:I7");

  bar(9, ledger.account?.code ?? "");
  set(9, "D", { v: (ledger.account?.name ?? st.bank).replace(/^\d+\s*-\s*/, "").toUpperCase(), s: "bar" });
  set(9, "G", { v: "Empresa:", s: "barRight" });
  set(9, "H", { v: info.company ?? "", s: "barRight" });
  merges.push("H9:I9");

  bar(12, "Saldo Razão Contábil", "H", { v: { formula: refs.ledgerClosing, value: ledgerClosing }, s: "barMoney" });
  set(12, "I", { v: "", s: "barMoney" });
  merges.push("H12:I12");
  bar(14, "Saldo Auxiliar / Extrato", "H", { v: { formula: refs.statementClosing, value: statementClosing }, s: "barMoney" });
  set(14, "I", { v: "", s: "barMoney" });
  merges.push("H14:I14");
  bar(17, "Diferença a Conciliar", "I", { v: { formula: "H12-H14", value: round(ledgerClosing - statementClosing) }, s: "barMoney" });

  // Composição: o que falta no razão ajusta o saldo contábil (C); o que falta no extrato ajusta o auxiliar (A).
  const items = [
    ...r.onlyStatement.map((i) => ({ ...st.entries[i], nature: "C", origin: "Extrato" })),
    ...r.onlyLedger.map((i) => ({ ...ledger.entries[i], nature: "A", origin: "Razão" })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  set(19, "C", { v: "Data", s: "thBox" });
  for (const col of "DEFGH") set(19, col, { v: "", s: "thBox" });
  set(19, "D", { v: "Descrição", s: "thBox" });
  set(19, "I", { v: "Valor", s: "thBox" });
  set(19, "K", { v: "Natureza", s: "thBox" });
  merges.push("D19:H19");
  const first = 20;
  const count = Math.max(items.length, 2);
  for (let k = 0; k < count; k++) {
    const row = first + k;
    const it = items[k];
    set(row, "C", it ? date(it.date) : { v: "", s: "td" });
    for (const col of "DEFGH") set(row, col, { v: "", s: "td" });
    set(row, "D", text(it ? `${it.origin === "Extrato" ? "Falta no razão" : "Falta no extrato"}: ${it.description}` : "", "td"));
    set(row, "I", money(it?.amount));
    set(row, "K", { v: it?.nature ?? "", s: "tdCenter" });
    merges.push(`D${row}:H${row}`);
  }
  const lastItem = first + count - 1;
  const total = round(items.reduce((sum, it) => sum + it.amount, 0));
  const sumOf = (n: string) => round(items.filter((it) => it.nature === n).reduce((sum, it) => sum + it.amount, 0));
  const totalRow = lastItem + 1;
  for (const col of "CDEFGH") set(totalRow, col, { v: "", s: "thBox" });
  set(totalRow, "C", { v: "Total Composição", s: "thBox" });
  set(totalRow, "I", { v: { formula: `SUM(I${first}:I${lastItem})`, value: total }, s: "totalMoney" });
  merges.push(`C${totalRow}:H${totalRow}`);

  // Legenda com os totais por natureza.
  const sumif = (cell: string) => `SUMIF($K$${first}:$K$${lastItem},${cell},$I$${first}:$I$${lastItem})`;
  set(12, "K", { v: "A", s: "legend" });
  set(12, "L", { v: "Saldo Auxiliar", s: "legendText" });
  set(12, "M", { v: { formula: sumif("K12"), value: sumOf("A") }, s: "legendMoney" });
  set(12, "N", { v: { formula: "H14+M12", value: round(statementClosing + sumOf("A")) }, s: "legendMoney" });
  set(13, "K", { v: "C", s: "legend" });
  set(13, "L", { v: "Saldo Contábil", s: "legendText" });
  set(13, "M", { v: { formula: sumif("K13"), value: sumOf("C") }, s: "legendMoney" });
  set(13, "N", { v: { formula: "H12+M13", value: round(ledgerClosing + sumOf("C")) }, s: "legendMoney" });

  const adj1 = totalRow + 2;
  bar(adj1, "Saldo Contábil ajustado (razão + itens C)", "I", { v: { formula: "N13", value: round(ledgerClosing + sumOf("C")) }, s: "barMoney" });
  const adj2 = totalRow + 4;
  bar(adj2, "Saldo Auxiliar ajustado (extrato + itens A)", "I", { v: { formula: "N12", value: round(statementClosing + sumOf("A")) }, s: "barMoney" });

  const sign = adj2 + 4;
  set(sign, "C", { v: "______________________________________", s: "boldCenter" });
  set(sign + 1, "C", { v: info.signer ?? "", s: "boldCenter" });
  set(sign + 2, "C", { v: info.role ?? "", s: "boldCenter" });
  merges.push(`C${sign}:D${sign}`, `C${sign + 1}:D${sign + 1}`, `C${sign + 2}:D${sign + 2}`);

  const rows: WorkbookRow[] = Array.from({ length: grid.length }, (_, i) => ({
    cells: Array.from({ length: grid[i]?.length ?? 0 }, (_, c) => grid[i]?.[c] ?? null),
  }));
  return {
    name: "CAPA",
    hideGrid: true,
    fitPortrait: true,
    widths: [3, 3, 35, 12.5, 9, 26, 12.5, 21.5, 24, 4.6, 11.5, 15, 14, 16.5],
    merges,
    rows,
  };
}

export function exportBankXlsx(
  st: Statement,
  ledger?: Ledger,
  r?: BankReconciliation,
  s?: ReconSummary,
  info: CapaInfo = {},
  periodEnd?: string,
): Uint8Array {
  if (!ledger || !r || !s) return buildWorkbook([statementSheet(st)]);
  const end = periodEnd ?? st.entries.at(-1)?.date;
  const extrato = statementSheet(st, r, ledger, `Saldo em ${end ? formatBR(end) : ""}`);
  const razao = ledgerSheet(ledger, r, st);
  // Saldo final do razão: última linha de lançamento (ou o saldo anterior, se não houver lançamentos).
  const ledgerClosing = `'Razão'!H${3 + ledger.entries.length}`;
  const statementClosing = `EXTRATO!F${extrato.rows.length}`;
  return buildWorkbook([capaSheet(st, ledger, r, s, info, { ledgerClosing, statementClosing, periodEnd: end }), extrato, razao]);
}
