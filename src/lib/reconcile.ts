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
  /** Linhas acima do cabeçalho (título, código da conta...). */
  above?: (CellValue | undefined)[][];
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
  // Nomes de coluna conhecidos pesam mais (evita pegar um título ou código de conta).
  const KNOWN = /^(data|dt\b|hist|d[eé]bito|cr[eé]dito|saldo|valor|montante|fornecedor|cliente|documento|doc\b|n[ºo°]|nf|fatura|vencimento|venc|refer|lote|lanc|filial|t[ií]tulo|supplier|reference|amount|journal)/i;
  for (const entry of sorted.slice(0, 20)) {
    const texts = [...entry[1].values()].filter((v): v is string => typeof v === "string");
    const score =
      texts.filter((v) => v.trim().length <= 40).length +
      5 * texts.filter((v) => KNOWN.test(v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim())).length;
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
  const above = sorted
    .filter(([r]) => r < headerRow)
    .map(([, cells]) => Array.from({ length: width }, (_, c) => cells.get(c)))
    .filter((r) => r.some((v) => v !== undefined && String(v).trim() !== ""));
  return {
    name: sheet.name,
    headerRow,
    above,
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
  /** Coluna que agrupa documentos (ex.: FATURA com vários CT-es). */
  group?: number;
  supplier?: number;
  /** CNPJ/CPF do fornecedor ou beneficiário. */
  taxId?: number;
  amount?: number;
  due?: number;
}

export interface SapColumns {
  doc: number;
  /** Nome do fornecedor (para achar lançamentos sem nº de título). */
  name?: number;
  doc2?: number;
  taxId?: number;
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
  const group = find(headers, [/^fatura|n[ºo°.]?\s*(da\s+)?fatura|^duplicata/]);
  const others = headers.map((h, i) => (i === group ? "" : h));
  return {
    doc:
      find(others, [
        /^(n[ºo°.]?\s*)?(do\s+)?(ct-?e|conhecimento)/,
        /^(n[ºo°.]?\s*)?(da\s+)?(nf|nfe|nota)/,
        /nota fiscal|n\.? ?f\.?\b|ct-?e\b/,
        /documento|doc\b|titulo|referencia|numero|^n[ºo°]/,
      ]) ??
      group ??
      0,
    group: group !== undefined && find(others, [/ct-?e|conhecimento|nota|nf|documento|doc\b|titulo|referencia|numero/]) !== undefined
      ? group
      : undefined,
    supplier: find(headers, [/nome (do )?fornecedor|razao|beneficiario|credor|emitente/, /fornecedor|cliente|tomador/, /^nome/], /fatura|imposto|nf ent/),
    taxId: find(headers, [/cnpj|cpf|tax number/]),
    amount: find(headers, [/^valor (em )?aberto|^a pagar|^valor|montante|total|saldo/], /desc|juros|multa|ctrl/),
    due: find(headers, [/venc/]),
  };
}

export function guessSapColumns(headers: string[]): SapColumns {
  return {
    doc:
      find(headers, [/^referencia|^refer|^reference/, /^titulo$/, /^(nº |n )?nota|^nf\b/, /n[ºo°.]?\s*doc|documento|^journal entry$/], /compens|clearing|imposto/) ??
      find(headers, [/nota|nf/], /compens|clearing|filial|serie|fornec/) ??
      0,
    doc2: find(headers, [/n[ºo°.]?\s*doc|^documento|^journal entry$/, /^nf entrada|^nf\b|^nota fiscal/, /atribuic|^assignment/], /compens|clearing|refer|date|data|filial|serie/),
    name: find(headers, [/supplier name|nome (do )?fornecedor|razao social|beneficiario/, /^nome/, /^fornecedor$/]),
    taxId: find(headers, [/cnpj|cpf|tax number/]),
    amount: find(headers, [/montante.*(interna|mi\b)|montante|^amount/, /^valor (em )?aberto/, /^a pagar/, /^valor/, /^total$/], /desc|juros|multa|ctrl|red\./),
    due: find(headers, [/net due|venc|due date/]),
    clearingDate: find(headers, [/data.*compens|compens.*data|clearing date/]),
    clearingDoc: find(headers, [/doc.*compens|compens.*doc|clearing (journal|doc|entry)/]),
  };
}

// ---------- Cruzamento ----------

export type PostedStatus = "posted" | "posted_diff" | "not_posted";
export type PaymentState = "paid" | "open_overdue" | "open" | "unknown";

export interface ReconcileRow {
  index: number;
  doc: string;
  /** Valor da coluna de agrupamento (ex.: nº da fatura). */
  group?: string;
  /** Como foi encontrado no SAP: pelo próprio documento ou pelo agrupador. */
  matchedBy?: "doc" | "group";
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
  const lookup = (keys: string[]) => [...new Set(keys.flatMap((k) => index.get(k) ?? []))].map((j) => sap.rows[j]);
  // CNPJ: compara a raiz (8 dígitos), para aceitar matriz e filial; CPF inteiro.
  const taxKey = (v: CellValue | undefined) => {
    const d = v === undefined ? "" : String(v).replace(/\D/g, "");
    if (d.length >= 12) return d.padStart(14, "0").slice(0, 8);
    return d.length >= 9 ? d.padStart(11, "0") : "";
  };
  const byTax = new Map<string, number[]>();
  if (sc.taxId !== undefined) {
    sap.rows.forEach((row, i) => {
      const k = taxKey(row[sc.taxId!]);
      if (k) byTax.set(k, [...(byTax.get(k) ?? []), i]);
    });
  }

  const groupOf = (row: (CellValue | undefined)[]) => {
    const v = rc.group !== undefined ? row[rc.group] : undefined;
    return v === undefined || String(v).trim() === "" ? undefined : String(v).trim();
  };
  // Soma dos documentos de cada grupo (ex.: total da fatura = soma dos CT-es).
  const groupTotals = new Map<string, number>();
  if (rc.group !== undefined && rc.amount !== undefined) {
    for (const row of report.rows) {
      const g = groupOf(row);
      const a = toAmount(row[rc.amount]);
      if (g && a !== undefined && docKeys(row[rc.doc]).length) groupTotals.set(g, (groupTotals.get(g) ?? 0) + a);
    }
  }

  const sapAmountOf = (r: (CellValue | undefined)[]) => (sc.amount !== undefined ? toAmount(r[sc.amount]) : undefined);
  const cleared = (r: (CellValue | undefined)[]) =>
    (sc.clearingDate !== undefined && !!toDate(r[sc.clearingDate])) ||
    (sc.clearingDoc !== undefined && docKeys(r[sc.clearingDoc]).length > 0);

  return report.rows.flatMap((row, i): ReconcileRow[] => {
    const docCell = row[rc.doc];
    const keys = docKeys(docCell);
    if (!keys.length) return []; // linhas de total, subtítulos etc.
    const amount = rc.amount !== undefined ? toAmount(row[rc.amount]) : undefined;
    const supplier = rc.supplier !== undefined && row[rc.supplier] !== undefined ? String(row[rc.supplier]).trim() : undefined;
    const reportDue = rc.due !== undefined ? toDate(row[rc.due]) : undefined;
    const group = groupOf(row);
    const tax = rc.taxId !== undefined && sc.taxId !== undefined ? taxKey(row[rc.taxId]) : "";
    // Com CNPJ dos dois lados, só vale lançamento do mesmo fornecedor (evita nº curto de outro fornecedor).
    const sameTax = (r: (CellValue | undefined)[]) => !tax || !taxKey(r[sc.taxId!]) || taxKey(r[sc.taxId!]) === tax;

    // 1º pelo próprio documento; se não achar, pelo agrupador (fatura lançada inteira).
    let matchedBy: "doc" | "group" = "doc";
    let candidates = lookup(keys).filter(sameTax);
    let expected = amount;
    if (!candidates.length && group) {
      const byGroup = lookup(docKeys(group)).filter(sameTax);
      if (byGroup.length) {
        candidates = byGroup;
        matchedBy = "group";
        expected = groupTotals.get(group) ?? amount;
      }
    }

    const sameAmount = (r: (CellValue | undefined)[]) => {
      const a = sapAmountOf(r);
      return expected !== undefined && a !== undefined && Math.abs(Math.abs(a) - Math.abs(expected)) <= AMOUNT_TOLERANCE;
    };
    // Sem o número: mesmo CNPJ e mesmo valor (de preferência o mesmo vencimento).
    let matchedByTax = false;
    if (!candidates.length && tax && expected !== undefined) {
      const same = (byTax.get(tax) ?? []).map((j) => sap.rows[j]).filter(sameAmount);
      const sameDue = same.filter((r) => reportDue && sc.due !== undefined && toDate(r[sc.due]) === reportDue);
      candidates = sameDue.length ? sameDue : same;
      matchedByTax = candidates.length > 0;
    }
    // Prefere a linha com o mesmo valor; depois a já compensada.
    const match =
      candidates.find((r) => sameAmount(r) && cleared(r)) ??
      candidates.find(sameAmount) ??
      candidates.find(cleared) ??
      candidates[0];

    const base = { index: i, doc: String(docCell).trim(), group, supplier, amount };
    if (!match) {
      const overdue = !!reportDue && reportDue < today;
      return [
        {
          ...base,
          dueDate: reportDue,
          posted: "not_posted",
          payment: "unknown",
          note: overdue ? "Não encontrado no sistema — e já venceu" : "Não encontrado no sistema",
        },
      ];
    }

    const sapAmount = sapAmountOf(match);
    const diff = expected !== undefined && sapAmount !== undefined && !sameAmount(match);
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
    if (matchedBy === "group") notes.push(`Lançado pela fatura ${group}`);
    if (matchedByTax) notes.push("Achado pelo CNPJ e valor (nº diferente)");
    if (diff) notes.push(matchedBy === "group" ? "Total da fatura diferente no sistema" : "Valor diferente no sistema");
    if (candidates.length > 1)
      notes.push(matchedByTax ? `${candidates.length} lançamentos desse CNPJ com esse valor` : `${candidates.length} lançamentos com esse número no sistema`);
    return [
      {
        ...base,
        matchedBy,
        dueDate,
        posted: diff ? "posted_diff" : "posted",
        sapAmount,
        sapDoc: sc.doc2 !== undefined && match[sc.doc2] !== undefined ? String(match[sc.doc2]) : undefined,
        payment,
        paidDate: isPaid ? clearingDate : undefined,
        note: notes.join(" · "),
      },
    ];
  });
}

// ---------- Visão por grupo (fatura) ----------

export interface GroupResult {
  group: string;
  count: number;
  total: number;
  dueDate?: string;
  postedCount: number;
  diffCount: number;
  paidCount: number;
  posted: "posted" | "partial" | "not_posted";
  payment: "paid" | "partial" | "open_overdue" | "open" | "unknown";
  rows: ReconcileRow[];
}

export function groupResults(rows: ReconcileRow[], today: string): GroupResult[] {
  const map = new Map<string, ReconcileRow[]>();
  for (const r of rows) if (r.group) map.set(r.group, [...(map.get(r.group) ?? []), r]);
  return [...map].map(([group, list]) => {
    const postedCount = list.filter((r) => r.posted !== "not_posted").length;
    const paidCount = list.filter((r) => r.payment === "paid").length;
    const dueDate = list.map((r) => r.dueDate).filter(Boolean).sort()[0];
    const unknown = list.every((r) => r.payment === "unknown");
    return {
      group,
      count: list.length,
      total: Math.round(list.reduce((s, r) => s + Math.abs(r.amount ?? 0), 0) * 100) / 100,
      dueDate,
      postedCount,
      diffCount: list.filter((r) => r.posted === "posted_diff").length,
      paidCount,
      posted: postedCount === list.length ? "posted" : postedCount ? "partial" : "not_posted",
      payment:
        paidCount === list.length
          ? "paid"
          : paidCount
            ? "partial"
            : unknown
              ? "unknown"
              : dueDate && dueDate < today
                ? "open_overdue"
                : "open",
      rows: list,
    };
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
  if (rows.some((r) => r.group)) return groupEmailText(rows, today, formatDate);
  const s = reconcileSummary(rows, today);
  const money = (n?: number) =>
    n === undefined
      ? ""
      : ` — ${Math.abs(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ")}`;
  const line = (r: ReconcileRow) => `• ${r.doc}${r.supplier ? ` (${r.supplier})` : ""}${money(r.amount)}`;
  const parts = [
    `Segue a análise do relatório (${s.total} itens), conferida no sistema em ${formatDate(today)}:`,
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
    parts.push("", "Lançados com valor diferente:", ...diff.map((r) => `${line(r)} — no sistema${money(r.sapAmount)}`));
  }
  parts.push("", "O detalhe item a item está na planilha em anexo.");
  return parts.join("\n");
}

/** Resumo por fatura (quando o relatório agrupa documentos). */
function groupEmailText(rows: ReconcileRow[], today: string, formatDate: (iso: string) => string): string {
  const groups = groupResults(rows, today);
  const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const line = (g: GroupResult) =>
    `• Fatura ${g.group} — ${plural(g.count, "documento", "documentos")} — ${money(g.total)}${g.dueDate ? ` — venc. ${formatDate(g.dueDate)}` : ""}`;
  const overdue = groups.filter((g) => g.dueDate && g.dueDate < today);
  const notPosted = groups.filter((g) => g.posted === "not_posted");
  const partial = groups.filter((g) => g.posted === "partial");
  const open = overdue.filter((g) => g.posted !== "not_posted" && g.payment !== "paid");

  const parts = [
    `Segue a análise do relatório (${plural(groups.length, "fatura", "faturas")}, ${plural(rows.length, "documento", "documentos")}), conferida no sistema em ${formatDate(today)}:`,
    "",
    `• Faturas lançadas: ${groups.filter((g) => g.posted === "posted").length}${partial.length ? ` (+ ${partial.length} parcialmente)` : ""}`,
    `• Faturas não lançadas: ${notPosted.length}`,
    `• Vencidas: ${overdue.length} (pagas: ${overdue.filter((g) => g.payment === "paid").length}; em aberto: ${open.length}; não lançadas: ${overdue.filter((g) => g.posted === "not_posted").length})`,
  ];
  if (notPosted.length) parts.push("", "Faturas não lançadas:", ...notPosted.map(line));
  if (partial.length) {
    parts.push(
      "",
      "Faturas lançadas em parte (documentos que faltam no sistema):",
      ...partial.map(
        (g) => `${line(g)} — faltam: ${g.rows.filter((r) => r.posted === "not_posted").map((r) => r.doc).join(", ")}`,
      ),
    );
  }
  if (open.length) parts.push("", "Vencidas e ainda em aberto:", ...open.map(line));
  const diff = groups.filter((g) => g.diffCount > 0);
  if (diff.length) parts.push("", "Com valor diferente no sistema:", ...diff.map(line));
  parts.push("", "O detalhe item a item está na planilha em anexo.");
  return parts.join("\n");
}
