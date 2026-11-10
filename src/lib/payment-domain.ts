import type { Payment, PaymentInput, PaymentSheet } from "./payment-schema";
import { formatBR, nextBusinessDay } from "./work-tools";

// ---------- Meses ----------

export const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export const currentMonth = (today: string) => today.slice(0, 7);

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? "?"}/${y}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

const daysBetween = (a: string, b: string) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
};

// ---------- Filtros e ordenação ----------

export const entriesFor = (all: Payment[], sheet: PaymentSheet, month: string) =>
  all.filter((p) => p.sheet === sheet && p.month === month).sort((a, b) => a.order - b.order);

/** Meses que já têm lançamentos na planilha, do mais recente ao mais antigo. */
export const monthsWithData = (all: Payment[], sheet: PaymentSheet) =>
  [...new Set(all.filter((p) => p.sheet === sheet).map((p) => p.month))].sort().reverse();

/** Linhas do novo mês: mesmos fornecedores e filiais do mês anterior mais recente, em branco. */
export function newMonthInputs(all: Payment[], sheet: PaymentSheet, month: string): PaymentInput[] {
  const previous = monthsWithData(all, sheet).find((m) => m < month);
  if (!previous) return [];
  return entriesFor(all, sheet, previous).map((p, i) => ({
    sheet,
    month,
    order: i,
    supplier: p.supplier,
    branch: p.branch,
    status: "nao_recebido",
  }));
}

// ---------- Alertas ----------

export type AlertKind =
  | "overdue"
  | "due_today"
  | "due_soon"
  | "paid_no_date"
  | "date_not_paid"
  | "no_amount"
  | "duplicate_title"
  | "odd_date";

export interface PaymentAlert {
  entryId: string;
  kind: AlertKind;
  severity: "danger" | "warning";
  message: string;
}

const SOON_DAYS = 3;
const ODD_DATE_MONTHS = 6;

const normalizeTitle = (t: string) => t.replace(/[\s.;/]+/g, ",").replace(/,+/g, ",").replace(/^,|,$/g, "").toLowerCase();

const FIELD_LABELS = {
  competence: "Competência",
  issueDate: "Emissão",
  dueDate: "Vencimento",
  paidDate: "Data do pagamento",
} as const;

/**
 * Confere as linhas de um mês. Vencimento em fim de semana ou feriado só conta
 * como atrasado depois do próximo dia útil (o banco aceita o pagamento nele).
 */
export function paymentAlerts(entries: Payment[], today: string): PaymentAlert[] {
  const alerts: PaymentAlert[] = [];
  const titles = new Map<string, Payment[]>();

  for (const p of entries) {
    const add = (kind: AlertKind, severity: PaymentAlert["severity"], message: string) =>
      alerts.push({ entryId: p.id, kind, severity, message });
    const paid = p.status === "pago";

    if (!paid && p.dueDate) {
      const effective = nextBusinessDay(p.dueDate);
      const diff = daysBetween(today, effective);
      const due = formatBR(p.dueDate);
      const shifted = effective !== p.dueDate;
      if (diff < 0) add("overdue", "danger", `Venceu em ${due} e não está como pago.`);
      else if (diff === 0) {
        add(
          "due_today",
          "danger",
          shifted
            ? `Último dia para pagar é hoje (vencimento ${due} caiu em fim de semana/feriado).`
            : "Vence hoje e não está como pago.",
        );
      } else if (diff <= SOON_DAYS) {
        const days = `${diff} ${diff === 1 ? "dia" : "dias"}`;
        add(
          "due_soon",
          "warning",
          shifted
            ? `Vencimento ${due} cai em fim de semana/feriado: pode pagar até ${formatBR(effective)} (em ${days}).`
            : `Vence em ${days} (${due}).`,
        );
      }
    }
    if (paid && !p.paidDate) add("paid_no_date", "warning", "Marcado como pago, mas sem a data do pagamento.");
    if (!paid && p.paidDate) {
      add("date_not_paid", "warning", `Tem data de pagamento (${formatBR(p.paidDate)}), mas o status não é "pago".`);
    }
    if ((p.status === "enviado" || paid) && p.amount === undefined) {
      add("no_amount", "warning", paid ? "Pago sem valor preenchido." : "Enviado para pagamento sem valor preenchido.");
    }

    const [my, mm] = p.month.split("-").map(Number);
    const monthIndex = my * 12 + mm - 1;
    for (const field of ["competence", "issueDate", "dueDate", "paidDate"] as const) {
      const value = p[field];
      if (!value) continue;
      const [y, m] = value.split("-").map(Number);
      if (Math.abs(y * 12 + m - 1 - monthIndex) > ODD_DATE_MONTHS) {
        add("odd_date", "warning", `${FIELD_LABELS[field]} ${formatBR(value)} parece fora do período. Confira o ano.`);
      }
    }

    const title = p.titleNumber ? normalizeTitle(p.titleNumber) : "";
    if (title.replace(/\D/g, "").length >= 2) titles.set(title, [...(titles.get(title) ?? []), p]);
  }

  for (const group of titles.values()) {
    if (group.length < 2) continue;
    for (const p of group) {
      const others = group.filter((o) => o !== p).map((o) => `${o.supplier.trim()}${o.branch ? ` (${o.branch})` : ""}`);
      alerts.push({
        entryId: p.id,
        kind: "duplicate_title",
        severity: "warning",
        message: `Nº de título repetido em: ${others.join(", ")}. Confira se não é cópia.`,
      });
    }
  }

  const rank = (a: PaymentAlert) => (a.severity === "danger" ? 0 : 1);
  const order = new Map(entries.map((p, i) => [p.id, i]));
  return alerts.sort((a, b) => rank(a) - rank(b) || (order.get(a.entryId) ?? 0) - (order.get(b.entryId) ?? 0));
}

// ---------- Resumo ----------

export function paymentSummary(entries: Payment[], today: string) {
  const sum = (list: Payment[]) => list.reduce((s, p) => s + (p.amount ?? 0), 0);
  const paid = entries.filter((p) => p.status === "pago");
  const open = entries.filter((p) => p.status !== "pago");
  const overdue = open.filter((p) => p.dueDate && daysBetween(today, nextBusinessDay(p.dueDate)) < 0);
  return {
    count: entries.length,
    paidCount: paid.length,
    openCount: open.length,
    overdueCount: overdue.length,
    notReceived: entries.filter((p) => p.status === "nao_recebido").length,
    total: Math.round(sum(entries) * 100) / 100,
    paidTotal: Math.round(sum(paid) * 100) / 100,
    openTotal: Math.round(sum(open) * 100) / 100,
  };
}
