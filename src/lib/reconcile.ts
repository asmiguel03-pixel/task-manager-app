/**
 * Conciliação de um relatório recebido (ex.: lista de títulos da contabilidade)
 * com uma extração do SAP: o que está lançado, o que não está, e — dos vencidos —
 * o que já foi pago (compensado). Tudo roda no navegador; nada é enviado ao servidor.
 */
import { toDate } from "./payment-import";
import type { CellValue, ReadSheet } from "./xlsx-read";

export interface Table {
  /** Nome da aba (ou do arquivo, para CSV). */
  name: string;
  headerRow: number; // 1-based, para exibição
  headers: string[];
  rows: (CellValue | undefined)[][];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// ---------- Leitura ----------

/** Escolhe a linha de cabeçalho: entre as 20 primeiras, a com mais textos curtos. */
export function tableFromSheet(sheet: ReadSheet): Table | null {
  const sorted = [...sheet.rows].sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return null;
  let best = sorted[0];
  let bestScore = -1;
  for (const entry of sorted.slice(0, 20)) {
    const score = [...entry[1].values()].filter((v) => typeof v === "string" && v.trim().length <= 40).length;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  if (bestScore < 2) return null;
  const [headerRow, headerCells] = best;
  const width = Math.max(...sorted.map(([, cells]) => Math.max(-1, ...cells.keys()))) + 1;
  const headers = Array.from({ length: width }, (_, c) => {
    const v = headerCells.get(c);
    return v === undefined ? "" : String(v).trim();
  });
  const rows = sorted
    .filter(([r]) => r > headerRow)
    .map(([, cells]) => Array.from({ length: width }, (_, c) => cells.get(c)))
    .filter((r) => r.some((v) => v !== undefined && String(v).trim() !== ""));
  // Remove colunas totalmente vazias (sem cabeçalho e sem dados).
  const keep = headers.map((h, c) => !!h || rows.some((r) => r[c] !== undefined));
  return {
    name: sheet.name,
    headerRow,
    headers: headers.filter((_, c) => keep[c]).map((h, i) => h || `Coluna ${i + 1}`),
    rows: rows.map((r) => r.filter((_, c) => keep[c])),
  };
}

/** CSV/TXT exportado (separador ; , ou tabulação; aspas opcionais). */
export function parseDelimited(text: string, name: string): ReadSheet {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = ["\t", ";", ","].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows = new Map<number, Map<number, CellValue>>();
  let row = new Map<number, CellValue>();
  let field = "";
  let col = 0;
  let r = 1;
  let quoted = false;
  const push = () => {
    const v = field.trim();
    if (v) row.set(col, /^-?\d+([.,]\d+)?$/.test(v) && !/^0\d/.test(v) ? Number(v.replace(",", ".")) : v);
    field = "";
    col++;
  };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === "") quoted = true;
    else if (ch === delimiter) push();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      push();
      if (row.size) rows.set(r, row);
      row = new Map();
      col = 0;
      r++;
    } else field += ch;
  }
  push();
  if (row.size) rows.set(r, row);
  return { name, hidden: false, rows };
}

// ---------- Valores ----------

/** Número de célula ou texto pt-BR ("1.234,56", "R$ -10,00", "1234.56-"). */
export function toAmount(v: CellValue | undefined): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let t = v.replace(/R\$|\s/gi, "");
  let negative = false;
  if (/-$/.test(t)) {
    negative = true; // SAP às vezes coloca o sinal no fim
    t = t.slice(0, -1);
  }
  if (!/^-?[\d.,]+$/.test(t)) return undefined;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? (negative ? -n : n) : undefined;
}

/**
 * Chaves de número de documento: cada grupo de 3+ dígitos, sem zeros à esquerda
 * ("000012345-001" → ["12345"]). Números curtos só valem se forem o valor inteiro.
 */
export function docKeys(v: CellValue | undefined): string[] {
  if (v === undefined || typeof v === "boolean") return [];
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? [String(Math.trunc(v))] : [];
  const groups = (v.match(/\d+/g) ?? []).map((d) => d.replace(/^0+/, "")).filter(Boolean);
  const long = groups.filter((d) => d.length >= 3);
  if (long.length) return [...new Set(long)];
  return groups.length === 1 && /^\s*\d+\s*$/.test(v) ? groups : [];
}

// ---------- Colunas ----------

export interface ReportColumns {
  doc: number;
  supplier?: number;
  amount?: number;
  due?: number;
}

export interface SapColumns {
  doc: number;
  doc2?: number;
  amount?: number;
  due?: number;
  clearingDate?: number;
  clearingDoc?: number;
}

const find = (headers: string[], patterns: RegExp[], exclude?: RegExp) => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(norm(h)) && !(exclude && exclude.test(norm(h))));
    if (i >= 0) return i;
  }
  return undefined;
};

export function guessReportColumns(headers: string[]): ReportColumns {
  return {
    doc: find(headers, [/^(n[ºo°.]?\s*)?(da\s+)?(nf|nfe|nota)/, /nota fiscal|n\.? ?f\.?\b/, /documento|doc\b|titulo|referencia|fatura|numero|^n[ºo°]/]) ?? 0,
    supplier: find(headers, [/fornecedor|razao|credor|beneficiario|emitente/, /^nome/]),
    amount: find(headers, [/^valor|montante|total|saldo/]),
    due: find(headers, [/venc/]),
  };
}

export function guessSapColumns(headers: string[]): SapColumns {
  return {
    doc: find(headers, [/^referencia|^refer/, /nota|nf/, /n[ºo°.]?\s*doc|documento/], /compens/) ?? 0,
    doc2: find(headers, [/n[ºo°.]?\s*doc|^documento/, /atribuic/], /compens|refer/),
    amount: find(headers, [/montante.*(interna|mi\b)|montante/, /^valor/]),
    due: find(headers, [/venc/]),
    clearingDate: find(headers, [/data.*compens|compens.*data/]),
    clearingDoc: find(headers, [/doc.*compens|compens.*doc/]),
  };
}

// ---------- Cruzamento ----------

export type PostedStatus = "posted" | "posted_diff" | "not_posted";
export type PaymentState = "paid" | "open_overdue" | "open" | "unknown";

export interface ReconcileRow {
  index: number;
  doc: string;
  supplier?: string;
  amount?: number;
  dueDate?: string;
  posted: PostedStatus;
  sapAmount?: number;
  sapDoc?: string;
  payment: PaymentState;
  paidDate?: string;
  note: string;
}

const AMOUNT_TOLERANCE = 0.05;

export function reconcile(
  report: Table,
  rc: ReportColumns,
  sap: Table,
  sc: SapColumns,
  today: string,
): ReconcileRow[] {
  const index = new Map<string, number[]>();
  sap.rows.forEach((row, i) => {
    for (const col of [sc.doc, sc.doc2]) {
      if (col === undefined) continue;
      for (const k of docKeys(row[col])) index.set(k, [...(index.get(k) ?? []), i]);
    }
  });

  return report.rows.flatMap((row, i): ReconcileRow[] => {
    const docCell = row[rc.doc];
    const keys = docKeys(docCell);
    if (!keys.length) return []; // linhas de total, subtítulos etc.
    const amount = rc.amount !== undefined ? toAmount(row[rc.amount]) : undefined;
    const supplier = rc.supplier !== undefined && row[rc.supplier] !== undefined ? String(row[rc.supplier]).trim() : undefined;
    const reportDue = rc.due !== undefined ? toDate(row[rc.due]) : undefined;

    const candidates = [...new Set(keys.flatMap((k) => index.get(k) ?? []))].map((j) => sap.rows[j]);
    const sapAmountOf = (r: (CellValue | undefined)[]) => (sc.amount !== undefined ? toAmount(r[sc.amount]) : undefined);
    const sameAmount = (r: (CellValue | undefined)[]) => {
      const a = sapAmountOf(r);
      return amount !== undefined && a !== undefined && Math.abs(Math.abs(a) - Math.abs(amount)) <= AMOUNT_TOLERANCE;
    };
    // Prefere a linha com o mesmo valor; depois a já compensada.
    const cleared = (r: (CellValue | undefined)[]) =>
      (sc.clearingDate !== undefined && !!toDate(r[sc.clearingDate])) ||
      (sc.clearingDoc !== undefined && docKeys(r[sc.clearingDoc]).length > 0);
    const match =
      candidates.find((r) => sameAmount(r) && cleared(r)) ??
      candidates.find(sameAmount) ??
      candidates.find(cleared) ??
      candidates[0];

    const base = { index: i, doc: String(docCell).trim(), supplier, amount };
    if (!match) {
      const overdue = !!reportDue && reportDue < today;
      return [
        {
          ...base,
          dueDate: reportDue,
          posted: "not_posted" as const,
          payment: "unknown" as const,
          note: overdue ? "Não encontrado no SAP — e já venceu" : "Não encontrado no SAP",
        },
      ];
    }

    const sapAmount = sapAmountOf(match);
    const diff = amount !== undefined && sapAmount !== undefined && !sameAmount(match);
    const dueDate = reportDue ?? (sc.due !== undefined ? toDate(match[sc.due]) : undefined);
    const clearingDate = sc.clearingDate !== undefined ? toDate(match[sc.clearingDate]) : undefined;
    const canTell = sc.clearingDate !== undefined || sc.clearingDoc !== undefined;
    const isPaid = cleared(match);
    const payment: PaymentState = !canTell
      ? "unknown"
      : isPaid
        ? "paid"
        : dueDate && dueDate < today
          ? "open_overdue"
          : "open";

    const notes: string[] = [];
    if (diff) notes.push("Valor diferente no SAP");
    if (candidates.length > 1) notes.push(`${candidates.length} lançamentos com esse número no SAP`);
    return [
      {
        ...base,
        dueDate,
        posted: diff ? ("posted_diff" as const) : ("posted" as const),
        sapAmount,
        sapDoc: sc.doc2 !== undefined && match[sc.doc2] !== undefined ? String(match[sc.doc2]) : undefined,
        payment,
        paidDate: isPaid ? clearingDate : undefined,
        note: notes.join(" · "),
      },
    ];
  });
}

export const POSTED_LABELS: Record<PostedStatus, string> = {
  posted: "Lançado",
  posted_diff: "Lançado (valor diferente)",
  not_posted: "Não lançado",
};

export function paymentLabel(r: ReconcileRow, formatDate: (iso: string) => string): string {
  switch (r.payment) {
    case "paid":
      return r.paidDate ? `Pago em ${formatDate(r.paidDate)}` : "Pago (compensado)";
    case "open_overdue":
      return `Em aberto — venceu em ${r.dueDate ? formatDate(r.dueDate) : "?"}`;
    case "open":
      return r.dueDate ? `A vencer em ${formatDate(r.dueDate)}` : "Em aberto";
    default:
      return "—";
  }
}

export function reconcileSummary(rows: ReconcileRow[], today: string) {
  const overdue = rows.filter((r) => r.dueDate && r.dueDate < today);
  return {
    total: rows.length,
    posted: rows.filter((r) => r.posted !== "not_posted").length,
    postedDiff: rows.filter((r) => r.posted === "posted_diff").length,
    notPosted: rows.filter((r) => r.posted === "not_posted").length,
    overdue: overdue.length,
    overduePaid: overdue.filter((r) => r.payment === "paid").length,
    overdueOpen: overdue.filter((r) => r.payment === "open_overdue").length,
    overdueNotPosted: overdue.filter((r) => r.posted === "not_posted").length,
  };
}

/** Texto curto para responder o e-mail; a planilha vai anexada com os detalhes. */
export function emailText(rows: ReconcileRow[], today: string, formatDate: (iso: string) => string): string {
  const s = reconcileSummary(rows, today);
  const money = (n?: number) =>
    n === undefined
      ? ""
      : ` — ${Math.abs(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ")}`;
  const line = (r: ReconcileRow) => `• ${r.doc}${r.supplier ? ` (${r.supplier})` : ""}${money(r.amount)}`;
  const parts = [
    `Segue a análise do relatório (${s.total} itens), conferida no SAP em ${formatDate(today)}:`,
    "",
    `• Lançados: ${s.posted}${s.postedDiff ? ` (${s.postedDiff} com valor diferente)` : ""}`,
    `• Não lançados: ${s.notPosted}`,
    `• Vencidos: ${s.overdue} (pagos: ${s.overduePaid}; em aberto: ${s.overdueOpen}${s.overdueNotPosted ? `; não lançados: ${s.overdueNotPosted}` : ""})`,
  ];
  const notPosted = rows.filter((r) => r.posted === "not_posted");
  if (notPosted.length) parts.push("", "Não lançados:", ...notPosted.map(line));
  const open = rows.filter((r) => r.payment === "open_overdue");
  if (open.length) {
    parts.push("", "Vencidos e ainda em aberto:", ...open.map((r) => `${line(r)} — venceu em ${r.dueDate ? formatDate(r.dueDate) : "?"}`));
  }
  const diff = rows.filter((r) => r.posted === "posted_diff");
  if (diff.length) {
    parts.push("", "Lançados com valor diferente:", ...diff.map((r) => `${line(r)} — no SAP${money(r.sapAmount)}`));
  }
  parts.push("", "O detalhe item a item está na planilha em anexo.");
  return parts.join("\n");
}
