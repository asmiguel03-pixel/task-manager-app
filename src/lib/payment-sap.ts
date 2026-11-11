/**
 * Confere as linhas de uma planilha de controle de pagamentos contra uma
 * extração de partidas de fornecedor do SAP: o que já foi pago (compensado),
 * o que está em aberto e o que a planilha precisa atualizar.
 */
import type { Payment } from "./payment-schema";
import { toDate } from "./payment-import";
import { docKeys, toAmount, type SapColumns, type Table } from "./reconcile";
import { formatBR, nextBusinessDay } from "./work-tools";

export type SapState = "paid" | "partial" | "open" | "overdue" | "not_found" | "no_sap";

export interface SapIssue {
  severity: "danger" | "warning";
  message: string;
}

export interface PaymentSapResult {
  state: SapState;
  matchedBy?: "title" | "supplier";
  /** Linhas do SAP associadas (índices em `sap.rows`). */
  lines: number[];
  sapAmount?: number;
  clearingDate?: string;
  issues: SapIssue[];
}

const AMOUNT_TOLERANCE = 0.05;
const DUE_WINDOW_DAYS = 10;
const MAX_COMBO = 6;
const MAX_CANDIDATES = 12;

const STOP = new Set([
  "LTDA", "SA", "S", "A", "ME", "EPP", "EIRELI", "DO", "DA", "DE", "DOS", "DAS", "E", "EM", "SS", "CIA",
  "COMPANHIA", "BRASIL", "THE", "OF", "INC",
]);

/** Palavras significativas do nome ("Telefônica Brasil S.A." → ["TELEFONICA"]). */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Mesmo fornecedor: as duas primeiras palavras significativas iguais (ou a única, se só houver uma). */
export function sameSupplier(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const k = Math.min(ta.length, tb.length, 2);
  return ta.slice(0, k).join(" ") === tb.slice(0, k).join(" ");
}

const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** Subconjunto (até 6 itens) cuja soma bate com o valor; prefere menos itens. */
function subsetForAmount(amounts: number[], target: number): number[] | null {
  const n = amounts.length;
  for (let size = 1; size <= Math.min(MAX_COMBO, n); size++) {
    const pick: number[] = [];
    const walk = (start: number, sum: number): boolean => {
      if (pick.length === size) return Math.abs(sum - target) <= AMOUNT_TOLERANCE;
      for (let i = start; i < n; i++) {
        pick.push(i);
        if (walk(i + 1, sum + amounts[i])) return true;
        pick.pop();
      }
      return false;
    };
    if (walk(0, 0)) return [...pick];
  }
  return null;
}

interface SapLine {
  index: number;
  keys: string[];
  name: string;
  amount?: number;
  due?: string;
  cleared: boolean;
  clearingDate?: string;
}

export function checkPaymentsAgainstSap(
  entries: Payment[],
  sap: Table,
  sc: SapColumns,
  today: string,
): Map<string, PaymentSapResult> {
  const canTell = sc.clearingDate !== undefined || sc.clearingDoc !== undefined;
  const lines: SapLine[] = sap.rows.map((row, index) => {
    const clearingDate = sc.clearingDate !== undefined ? toDate(row[sc.clearingDate]) : undefined;
    const clearingDoc = sc.clearingDoc !== undefined ? docKeys(row[sc.clearingDoc]).length > 0 : false;
    return {
      index,
      keys: [sc.doc, sc.doc2].flatMap((c) => (c === undefined ? [] : docKeys(row[c]))),
      name: sc.name !== undefined && row[sc.name] !== undefined ? String(row[sc.name]) : "",
      amount: sc.amount !== undefined ? toAmount(row[sc.amount]) : undefined,
      due: sc.due !== undefined ? toDate(row[sc.due]) : undefined,
      cleared: !!clearingDate || clearingDoc,
      clearingDate,
    };
  });
  const byKey = new Map<string, SapLine[]>();
  for (const l of lines) for (const k of l.keys) byKey.set(k, [...(byKey.get(k) ?? []), l]);
  const used = new Set<number>();
  const result = new Map<string, PaymentSapResult>();

  // 1ª passada: pelo nº do título (mais confiável); 2ª: fornecedor + valor + vencimento.
  const matches = new Map<string, { lines: SapLine[]; by: "title" | "supplier" }>();
  for (const p of entries) {
    const keys = p.titleNumber ? docKeys(p.titleNumber) : [];
    const found = [...new Set(keys.flatMap((k) => byKey.get(k) ?? []))].filter((l) => !used.has(l.index));
    if (found.length) {
      found.forEach((l) => used.add(l.index));
      matches.set(p.id, { lines: found, by: "title" });
    }
  }
  if (sc.name !== undefined) {
    for (const p of entries) {
      if (matches.has(p.id) || p.amount === undefined || p.amount <= 0) continue;
      const candidates = lines
        .filter(
          (l) =>
            !used.has(l.index) &&
            l.amount !== undefined &&
            sameSupplier(p.supplier, l.name) &&
            (!p.dueDate || !l.due || daysApart(p.dueDate, l.due) <= DUE_WINDOW_DAYS),
        )
        .sort((a, b) =>
          p.dueDate && a.due && b.due ? daysApart(p.dueDate, a.due) - daysApart(p.dueDate, b.due) : 0,
        )
        .slice(0, MAX_CANDIDATES);
      const pick = subsetForAmount(
        candidates.map((l) => Math.abs(l.amount ?? 0)),
        p.amount,
      );
      if (pick) {
        const chosen = pick.map((i) => candidates[i]);
        chosen.forEach((l) => used.add(l.index));
        matches.set(p.id, { lines: chosen, by: "supplier" });
      }
    }
  }

  for (const p of entries) {
    const issues: SapIssue[] = [];
    const m = matches.get(p.id);
    const paidInSheet = p.status === "pago";
    const due = p.dueDate ? nextBusinessDay(p.dueDate) : undefined;
    const late = !!due && due < today;

    if (!m) {
      if (paidInSheet) issues.push({ severity: "warning", message: "Marcado como pago, mas não encontrei no SAP." });
      else if (p.status !== "nao_recebido" && (p.amount !== undefined || p.dueDate)) {
        issues.push({
          severity: late ? "danger" : "warning",
          message: late ? "Vencido e não encontrado no SAP (lançado?)." : "Não encontrado no SAP (ainda não lançado?).",
        });
      }
      result.set(p.id, { state: "not_found", lines: [], issues });
      continue;
    }

    const sapAmount = Math.round(m.lines.reduce((s, l) => s + Math.abs(l.amount ?? 0), 0) * 100) / 100;
    const cleared = m.lines.filter((l) => l.cleared);
    const clearingDate = cleared.map((l) => l.clearingDate).filter((d): d is string => !!d).sort().at(-1);
    const state: SapState = !canTell
      ? "open"
      : cleared.length === m.lines.length
        ? "paid"
        : cleared.length
          ? "partial"
          : late
            ? "overdue"
            : "open";

    if (p.amount !== undefined && m.by === "title" && Math.abs(sapAmount - p.amount) > AMOUNT_TOLERANCE) {
      issues.push({
        severity: "warning",
        message: `Valor no SAP ${sapAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (na planilha ${p.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`,
      });
    }
    if (canTell) {
      if (state === "paid" && !paidInSheet) {
        issues.push({
          severity: "warning",
          message: `Já pago no SAP${clearingDate ? ` em ${formatBR(clearingDate)}` : ""} — atualizar a planilha.`,
        });
      } else if (state === "paid" && p.paidDate && clearingDate && p.paidDate !== clearingDate) {
        issues.push({
          severity: "warning",
          message: `Data do pagamento na planilha (${formatBR(p.paidDate)}) diferente do SAP (${formatBR(clearingDate)}).`,
        });
      } else if (state === "partial") {
        issues.push({ severity: "warning", message: `Pago em parte no SAP (${cleared.length} de ${m.lines.length} títulos).` });
      } else if ((state === "open" || state === "overdue") && paidInSheet) {
        issues.push({ severity: "danger", message: "Planilha diz pago, mas está em aberto no SAP." });
      } else if (state === "overdue") {
        issues.push({ severity: "danger", message: `Vencido${p.dueDate ? ` em ${formatBR(p.dueDate)}` : ""} e em aberto no SAP.` });
      }
    }
    result.set(p.id, {
      state,
      matchedBy: m.by,
      lines: m.lines.map((l) => l.index),
      sapAmount,
      clearingDate,
      issues,
    });
  }
  return result;
}

export const SAP_STATE_LABELS: Record<SapState, string> = {
  paid: "Pago no SAP",
  partial: "Pago em parte",
  open: "Em aberto no SAP",
  overdue: "Vencido em aberto",
  not_found: "Não encontrado",
  no_sap: "—",
};

export function sapStateText(r: PaymentSapResult | undefined): string {
  if (!r) return SAP_STATE_LABELS.no_sap;
  if (r.state === "paid" && r.clearingDate) return `Pago no SAP em ${formatBR(r.clearingDate)}`;
  return SAP_STATE_LABELS[r.state];
}

/** Texto curto para mandar por e-mail/WhatsApp junto da planilha. */
export function paymentCheckText(args: {
  title: string;
  entries: Payment[];
  issues: { entry: Payment; severity: "danger" | "warning"; message: string }[];
  sap?: Map<string, PaymentSapResult>;
  today: string;
}): string {
  const { title, entries, issues, sap, today } = args;
  const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
  const isPaid = (p: Payment) => p.status === "pago" || sap?.get(p.id)?.state === "paid";
  const paid = entries.filter(isPaid);
  const open = entries.filter((p) => !isPaid(p));
  const sum = (list: Payment[]) => list.reduce((s, p) => s + (p.amount ?? 0), 0);
  const overdue = open.filter((p) => p.dueDate && nextBusinessDay(p.dueDate) < today);
  const toUpdate = sap ? entries.filter((p) => p.status !== "pago" && sap.get(p.id)?.state === "paid").length : 0;
  const who = (p: Payment) => `${p.supplier.trim()}${p.branch ? ` (${p.branch})` : ""}`;
  const parts = [
    `${title} — conferência em ${formatBR(today)}${sap ? " (com o SAP)" : ""}:`,
    "",
    `• ${entries.length} lançamentos — total ${money(sum(entries))}`,
    `• Pagos: ${paid.length} (${money(sum(paid))}) · Em aberto: ${open.length} (${money(sum(open))})`,
    `• Vencidos em aberto: ${overdue.length}`,
  ];
  if (sap) parts.push(`• Já pagos no SAP e a atualizar na planilha: ${toUpdate}`);
  const urgent = issues.filter((i) => i.severity === "danger");
  if (urgent.length) parts.push("", "Atenção:", ...urgent.map((i) => `• ${who(i.entry)} — ${i.message}`));
  return parts.join("\n");
}
