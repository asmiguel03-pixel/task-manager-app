import { toDate } from "./payment-import";
import {
  groupResults,
  paymentLabel,
  POSTED_LABELS,
  reconcileSummary,
  toAmount,
  type GroupResult,
  type PaymentState,
  type PostedStatus,
  type ReconcileRow,
  type ReportColumns,
  type Table,
} from "./reconcile";
import { formatBR } from "./work-tools";
import { buildWorkbook, columnName, type StyleName, type StyledCell, type WorkbookSheet } from "./xlsx";

const POSTED_STYLE: Record<PostedStatus, StyleName> = {
  posted: "statusGreen",
  posted_diff: "statusOrange",
  not_posted: "statusRed",
};
const PAYMENT_STYLE: Record<PaymentState, StyleName> = {
  paid: "statusGreen",
  open_overdue: "statusRed",
  open: "statusBlue",
  unknown: "statusGray",
};

/** Planilha com as colunas do relatório original + o resultado da conferência. */
export function exportReconcileXlsx(report: Table, rc: ReportColumns, rows: ReconcileRow[], today: string): Uint8Array {
  const s = reconcileSummary(rows, today);
  const header = [...report.headers, "Lançado no SAP", "Pagamento", "Valor no SAP", "Observação"];
  const lastCol = columnName(header.length - 1);

  const original = (r: ReconcileRow): StyledCell[] =>
    report.headers.map((_, c) => {
      const v = report.rows[r.index][c];
      if (c === rc.amount) {
        const n = toAmount(v);
        return n !== undefined ? { v: n, s: "tdMoney" } : { v: v === undefined ? null : String(v), s: "td" };
      }
      if (c === rc.due) {
        const d = toDate(v);
        return d ? { v: { date: d }, s: "tdDate" } : { v: v === undefined ? null : String(v), s: "tdCenter" };
      }
      return { v: v === undefined ? null : typeof v === "boolean" ? String(v) : v, s: "tdWrap" };
    });

  const detail: WorkbookSheet = {
      name: rows.some((r) => r.group) ? "Por documento" : "Conciliação",
      landscape: true,
      freezeRows: 3,
      filterRow: 3,
      printTitleRows: 3,
      merges: [`A1:${lastCol}1`, `A2:${lastCol}2`],
      widths: [
        ...report.headers.map((h, c) => {
          const longest = Math.max(h.length, ...rows.slice(0, 200).map((r) => String(report.rows[r.index][c] ?? "").length));
          return Math.min(Math.max(longest + 3, 11), 42);
        }),
        22,
        30,
        16,
        34,
      ],
      rows: [
        { height: 28, cells: [{ v: `CONFERÊNCIA DE RELATÓRIO × SAP — ${formatBR(today)}`, s: "title" }] },
        {
          height: 18,
          cells: [
            {
              v:
                `${s.total} itens · ${s.posted} lançados${s.postedDiff ? ` (${s.postedDiff} com valor diferente)` : ""} · ` +
                `${s.notPosted} não lançados · vencidos: ${s.overdue} (pagos ${s.overduePaid}, em aberto ${s.overdueOpen})`,
              s: "subtitle",
            },
          ],
        },
        { height: 30, cells: header.map((h) => ({ v: h, s: "th" as const })) },
        ...rows.map((r) => ({
          cells: [
            ...original(r),
            { v: POSTED_LABELS[r.posted], s: POSTED_STYLE[r.posted] },
            { v: paymentLabel(r, formatBR), s: PAYMENT_STYLE[r.payment] },
            { v: r.sapAmount !== undefined ? Math.abs(r.sapAmount) : null, s: "tdMoney" as const },
            { v: r.note, s: "tdWrap" as const },
          ],
        })),
      ],
    };
  return buildWorkbook(rows.some((r) => r.group) ? [groupSheet(groupResults(rows, today), today), detail] : [detail]);
}

const GROUP_POSTED: Record<GroupResult["posted"], [string, StyleName]> = {
  posted: ["Lançada", "statusGreen"],
  partial: ["Parcial", "statusOrange"],
  not_posted: ["Não lançada", "statusRed"],
};

function groupPayment(g: GroupResult, today: string): [string, StyleName] {
  switch (g.payment) {
    case "paid":
      return ["Paga", "statusGreen"];
    case "partial":
      return [`Parcial (${g.paidCount} de ${g.count} pagos)`, "statusOrange"];
    case "open_overdue":
      return [`Em aberto — venceu em ${g.dueDate ? formatBR(g.dueDate) : "?"}`, "statusRed"];
    case "open":
      return [g.dueDate && g.dueDate >= today ? `A vencer em ${formatBR(g.dueDate)}` : "Em aberto", "statusBlue"];
    default:
      return ["—", "statusGray"];
  }
}

/** Uma linha por fatura: quantos documentos, total, situação no SAP e o que falta. */
function groupSheet(groups: GroupResult[], today: string): WorkbookSheet {
  const header = ["Fatura", "Documentos", "Total", "Vencimento", "No SAP", "Pagamento", "Documentos não lançados"];
  const first = 4;
  const last = first + Math.max(groups.length, 1) - 1;
  const notPosted = groups.filter((g) => g.posted !== "posted").length;
  return {
    name: "Por fatura",
    landscape: true,
    freezeRows: 3,
    filterRow: 3,
    printTitleRows: 3,
    merges: ["A1:G1", "A2:G2"],
    widths: [14, 12, 16, 13, 16, 30, 50],
    rows: [
      { height: 28, cells: [{ v: `CONFERÊNCIA POR FATURA × SAP — ${formatBR(today)}`, s: "title" }] },
      {
        height: 18,
        cells: [
          {
            v: `${groups.length} faturas · ${groups.reduce((n, g) => n + g.count, 0)} documentos · ${notPosted} faturas com documento não lançado`,
            s: "subtitle",
          },
        ],
      },
      { height: 30, cells: header.map((h) => ({ v: h, s: "th" as const })) },
      ...groups.map((g) => {
        const [postedText, postedStyle] = GROUP_POSTED[g.posted];
        const [payText, payStyle] = groupPayment(g, today);
        const missing = g.rows.filter((r) => r.posted === "not_posted").map((r) => r.doc);
        const late = !!g.dueDate && g.dueDate < today && g.payment !== "paid";
        return {
          cells: [
            { v: /^\d+$/.test(g.group) ? Number(g.group) : g.group, s: "tdCenter" as const },
            { v: g.count, s: "tdCenter" as const },
            { v: g.total, s: "tdMoney" as const },
            { v: g.dueDate ? { date: g.dueDate } : null, s: late ? ("tdDateLate" as const) : ("tdDate" as const) },
            { v: g.posted === "partial" ? `${postedText} (${g.postedCount} de ${g.count})` : postedText, s: postedStyle },
            { v: payText, s: payStyle },
            { v: missing.join(", "), s: "tdWrap" as const },
          ],
        };
      }),
      { cells: [] },
      {
        cells: [
          { v: "Total", s: "totalLabel" as const },
          { v: { formula: `SUM(B${first}:B${last})`, value: groups.reduce((n, g) => n + g.count, 0) }, s: "totalLabel" as const },
          { v: { formula: `SUM(C${first}:C${last})`, value: Math.round(groups.reduce((n, g) => n + g.total, 0) * 100) / 100 }, s: "totalMoney" as const },
          ...Array.from({ length: 4 }, () => ({ v: null, s: "totalLabel" as const })),
        ],
      },
    ],
  };
}
