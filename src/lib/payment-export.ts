import { MONTH_NAMES, monthLabel, paymentSummary } from "./payment-domain";
import {
  PAYMENT_STATUS_LABELS,
  SHEET_LABELS,
  type Payment,
  type PaymentSheet,
  type PaymentStatus,
} from "./payment-schema";
import { formatBR, nextBusinessDay } from "./work-tools";
import { buildWorkbook, columnName, type StyleName, type StyledCell, type WorkbookSheet } from "./xlsx";

const STATUS_STYLE: Record<PaymentStatus, StyleName> = {
  pago: "statusGreen",
  enviado: "statusBlue",
  recebido: "statusAmber",
  novo_boleto: "statusOrange",
  nao_recebido: "statusGray",
};

/** Texto da coluna de observações: status padronizado + anotações. */
export const observationText = (p: Payment) =>
  [PAYMENT_STATUS_LABELS[p.status], p.notes?.trim()].filter(Boolean).join(" — ");

const date = (iso: string | undefined, style: StyleName = "tdDate"): StyledCell => ({
  v: iso ? { date: iso } : null,
  s: style,
});

/**
 * Monta a aba no layout das planilhas de controle (mesmas colunas e ordem),
 * com título, cabeçalho destacado, status coloridos, vencidos em vermelho e totais.
 */
export function paymentSheet(entries: Payment[], sheet: PaymentSheet, month: string, today: string): WorkbookSheet {
  const withTitle = sheet === "criticos" || entries.some((p) => p.titleNumber);
  const header = [
    "Fornecedor",
    "Filial",
    "Competência",
    "Emissão",
    "Valor",
    "Dta Venc",
    "Data Efetivo Pagto",
    ...(withTitle ? ["N° do título"] : []),
    withTitle ? "Observação" : "Observações Depto Financeiro",
  ];
  const lastCol = columnName(header.length - 1);
  const obsCol = columnName(header.length - 1);
  const summary = paymentSummary(entries, today);
  const [, m] = month.split("-").map(Number);

  const first = 4; // 1 título, 2 subtítulo, 3 cabeçalho
  const last = first + Math.max(entries.length, 1) - 1;

  const dataRows = entries.map((p) => {
    const late = p.status !== "pago" && !!p.dueDate && nextBusinessDay(p.dueDate) < today;
    const cells: StyledCell[] = [
      { v: p.supplier, s: "tdWrap" },
      { v: p.branch, s: "tdCenter" },
      date(p.competence),
      date(p.issueDate),
      { v: p.amount ?? null, s: "tdMoney" },
      date(p.dueDate, late ? "tdDateLate" : "tdDate"),
      date(p.paidDate),
      ...(withTitle ? [{ v: p.titleNumber ?? "", s: "tdWrap" as const }] : []),
      { v: observationText(p), s: STATUS_STYLE[p.status] },
    ];
    return { cells };
  });

  const blankTotals = Array.from({ length: header.length - 2 }, () => ({ v: null, s: "totalLabel" as const }));
  const totalRow = (label: string, formula: string, value: number) => ({
    cells: [
      ...Array.from({ length: 3 }, () => ({ v: null, s: "totalLabel" as const })),
      { v: label, s: "totalLabel" as const },
      { v: { formula, value }, s: "totalMoney" as const },
      ...blankTotals.slice(3),
    ],
  });
  const range = (col: string) => `${col}${first}:${col}${last}`;

  return {
    name: `${String(m).padStart(2, "0")}. ${MONTH_NAMES[m - 1]}`,
    landscape: true,
    freezeRows: 3,
    filterRow: 3,
    printTitleRows: 3,
    merges: [`A1:${lastCol}1`, `A2:${lastCol}2`],
    widths: [44, 11, 13, 12, 16, 12, 14, ...(withTitle ? [22] : []), 42],
    rows: [
      {
        height: 28,
        cells: [{ v: `${SHEET_LABELS[sheet].toUpperCase()} — ${monthLabel(month).toUpperCase()}`, s: "title" }],
      },
      {
        height: 18,
        cells: [
          {
            v:
              `Gerado em ${formatBR(today)} · ${summary.count} lançamentos · ${summary.paidCount} pagos · ` +
              `${summary.openCount} em aberto${summary.overdueCount ? ` (${summary.overdueCount} vencidos)` : ""}` +
              ` · ${summary.notReceived} não recebidos`,
            s: "subtitle",
          },
        ],
      },
      { height: 30, cells: header.map((h) => ({ v: h, s: "th" as const })) },
      ...dataRows,
      { cells: [] },
      totalRow("Total do mês", `SUM(${range("E")})`, summary.total),
      totalRow("Pago", `SUMIF(${range(obsCol)},"${PAYMENT_STATUS_LABELS.pago}*",${range("E")})`, summary.paidTotal),
      totalRow("Em aberto", `E${last + 2}-E${last + 3}`, summary.openTotal),
    ],
  };
}

export function exportPaymentsXlsx(entries: Payment[], sheet: PaymentSheet, month: string, today: string) {
  return buildWorkbook([paymentSheet(entries, sheet, month, today)]);
}

export const paymentFileName = (sheet: PaymentSheet, month: string) => {
  const [y, m] = month.split("-");
  return `${sheet === "rh" ? "Pagamentos RH" : "Titulos criticos"} - ${MONTH_NAMES[Number(m) - 1]} ${y}.xlsx`;
};
