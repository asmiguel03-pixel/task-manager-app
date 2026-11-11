import { toDate } from "./payment-import";
import {
  paymentLabel,
  POSTED_LABELS,
  reconcileSummary,
  toAmount,
  type PaymentState,
  type PostedStatus,
  type ReconcileRow,
  type ReportColumns,
  type Table,
} from "./reconcile";
import { formatBR } from "./work-tools";
import { buildWorkbook, columnName, type StyleName, type StyledCell } from "./xlsx";

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

  return buildWorkbook([
    {
      name: "Conciliação",
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
    },
  ]);
}
