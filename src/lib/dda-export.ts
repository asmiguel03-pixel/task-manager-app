import { countStatuses, type DdaCheck, type DdaColumns, type DdaStatus, type DdaStatusKind } from "./dda-check";
import { toDate } from "./payment-import";
import type { Table } from "./reconcile";
import { buildWorkbook, type StyleName, type StyledCell, type WorkbookSheet } from "./xlsx";
import type { CellValue } from "./xlsx-read";

const STATUS_STYLE: Record<DdaStatusKind, StyleName> = {
  ok: "stOk",
  business_day: "stBusinessDay",
  grouped: "stGrouped",
  diverge_date: "stDiverge",
  diverge_value: "stDiverge",
  check: "stCheck",
  missing: "stMissing",
  outside: "stOutside",
};

const DATE_HEADER = /venc|vcto|emiss|^data|entrada$|pgto|negociada/i;

/**
 * Mesma planilha recebida, com as colunas principais primeiro e a coluna de status
 * logo depois (como na conferência feita à mão).
 */
function sheetWithStatus(name: string, t: Table, c: DdaColumns, statuses: (DdaStatus | undefined)[]): WorkbookSheet {
  const front = [c.supplier, c.taxId, c.due, c.doc, c.amount].filter((i): i is number => i !== undefined);
  const uniqueFront = [...new Set(front)];
  const rest = t.headers.map((_, i) => i).filter((i) => !uniqueFront.includes(i));
  const order = [...uniqueFront, -1, ...rest];
  const dateCols = new Set(t.headers.map((h, i) => (i === c.due || DATE_HEADER.test(h) ? i : -1)).filter((i) => i >= 0));

  const cell = (v: CellValue | undefined, i: number): StyledCell => {
    if (v === undefined) return { v: "", s: "cell" };
    if (dateCols.has(i)) {
      const iso = typeof v === "number" && (v < 20000 || v > 80000) ? undefined : toDate(v);
      if (iso) return { v: { date: iso }, s: "cellDate" };
    }
    if (i === c.amount && typeof v === "number") return { v, s: "cellMoney" };
    return { v: typeof v === "boolean" ? String(v) : v, s: "cell" };
  };

  const rows = [
    { cells: order.map((i) => ({ v: i < 0 ? "Status" : t.headers[i], s: "thGray" as const })) },
    ...t.rows.map((r, ri) => ({
      cells: order.map((i): StyledCell => {
        if (i >= 0) return cell(r[i], i);
        const st = statuses[ri];
        return st ? { v: st.label, s: STATUS_STYLE[st.kind] } : { v: "", s: "cell" };
      }),
    })),
  ];
  const widths = order.map((i) => {
    if (i < 0) return 22;
    const longest = Math.max(t.headers[i].length, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? "").length));
    return Math.min(45, Math.max(9, longest + 2));
  });
  return { name, rows, widths, freezeRows: 1, filterRow: 1, landscape: true };
}

function summarySheet(check: DdaCheck, ddaName: string, sysName: string): WorkbookSheet {
  const block = (title: string, list: (DdaStatus | undefined)[]) => {
    const counts = countStatuses(list);
    const kindOf = new Map(list.filter((s): s is DdaStatus => !!s).map((s) => [s.label, s.kind]));
    return [
      { cells: [{ v: title, s: "thGray" as const }, { v: "Qtde", s: "thGray" as const }] },
      ...[...counts.entries()].map(([label, n]) => ({
        cells: [{ v: label, s: STATUS_STYLE[kindOf.get(label) ?? "ok"] }, { v: n, s: "cell" as const }],
      })),
      { cells: [] },
    ];
  };
  return {
    name: "Resumo",
    widths: [28, 10],
    rows: [...block(ddaName, check.dda), ...block(sysName, check.system)],
  };
}

export function exportDdaXlsx(
  dda: Table,
  dc: DdaColumns,
  sys: Table,
  sc: DdaColumns,
  check: DdaCheck,
  sysName: string,
): Uint8Array {
  const sysSheet = sysName === "SISTEMA" ? "Sistema" : sysName.charAt(0) + sysName.slice(1).toLowerCase();
  return buildWorkbook([
    summarySheet(check, "Boletos DDA", sysSheet),
    sheetWithStatus("Boletos DDA", dda, dc, check.dda),
    sheetWithStatus(sysSheet, sys, sc, check.system),
  ]);
}
