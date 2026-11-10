"use client";

import { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import type { PaymentPatch } from "@/hooks/use-payments";
import { todayISO } from "@/lib/task-domain";
import {
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  type Payment,
  type PaymentStatus,
} from "@/lib/payment-schema";
import { btnGhost, btnPrimary, cx, inputCls, Modal } from "./ui";

const labelCls = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

/** Aceita "1.234,56", "1234,56" ou "1234.56". Vazio → null. */
export function parseMoney(text: string): number | null | undefined {
  const t = text.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!t) return null;
  const normalized = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(t)
      ? t.replace(/\./g, "") // "1.234" = mil duzentos e trinta e quatro
      : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : undefined;
}

export const moneyInput = (n: number | undefined) =>
  n === undefined ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PaymentFormValues {
  supplier: string;
  branch: string;
  competence: string;
  issueDate: string;
  amount: string;
  dueDate: string;
  paidDate: string;
  titleNumber: string;
  status: PaymentStatus;
  notes: string;
}

export function PaymentFormDialog({
  entry,
  branches,
  showTitle,
  onClose,
  onSubmit,
  onDelete,
}: {
  entry?: Payment;
  branches: string[];
  showTitle: boolean;
  onClose: () => void;
  onSubmit: (patch: PaymentPatch & { supplier: string; branch: string; status: PaymentStatus }) => Promise<unknown>;
  onDelete?: () => void;
}) {
  const uid = useId();
  const [v, setV] = useState<PaymentFormValues>({
    supplier: entry?.supplier ?? "",
    branch: entry?.branch ?? "",
    competence: entry?.competence ?? "",
    issueDate: entry?.issueDate ?? "",
    amount: moneyInput(entry?.amount),
    dueDate: entry?.dueDate ?? "",
    paidDate: entry?.paidDate ?? "",
    titleNumber: entry?.titleNumber ?? "",
    status: entry?.status ?? "nao_recebido",
    notes: entry?.notes ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof PaymentFormValues, string>>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof PaymentFormValues>(k: K, value: PaymentFormValues[K]) => {
    setV((prev) => ({ ...prev, [k]: value }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!v.supplier.trim()) next.supplier = "Informe o fornecedor.";
    const amount = parseMoney(v.amount);
    if (amount === undefined) next.amount = "Valor inválido. Use, por exemplo, 1.234,56.";
    if (v.status === "pago" && !v.paidDate) next.paidDate = "Informe a data em que foi pago.";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setSaving(true);
    const orNull = (s: string) => (s.trim() ? s.trim() : null);
    const ok = await onSubmit({
      supplier: v.supplier.trim(),
      branch: v.branch.trim(),
      competence: orNull(v.competence),
      issueDate: orNull(v.issueDate),
      amount: amount ?? null,
      dueDate: orNull(v.dueDate),
      paidDate: orNull(v.paidDate),
      titleNumber: orNull(v.titleNumber),
      status: v.status,
      notes: orNull(v.notes),
    });
    setSaving(false);
    if (ok) onClose();
  };

  const field = (k: keyof PaymentFormValues, label: string, input: React.ReactNode) => (
    <div>
      <label htmlFor={`${uid}-${k}`} className={labelCls}>
        {label}
      </label>
      {input}
      {errors[k] && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {errors[k]}
        </p>
      )}
    </div>
  );
  const dateInput = (k: "competence" | "issueDate" | "dueDate" | "paidDate") => (
    <input
      id={`${uid}-${k}`}
      type="date"
      value={v[k]}
      onChange={(e) => set(k, e.target.value)}
      aria-invalid={!!errors[k]}
      className={inputCls}
    />
  );

  return (
    <Modal title={entry ? "Editar lançamento" : "Novo lançamento"} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {field(
            "supplier",
            "Fornecedor *",
            <input
              id={`${uid}-supplier`}
              value={v.supplier}
              onChange={(e) => set("supplier", e.target.value)}
              maxLength={120}
              autoFocus={!entry}
              aria-invalid={!!errors.supplier}
              className={inputCls}
            />,
          )}
          <div className="grid grid-cols-2 gap-3">
            {field(
              "branch",
              "Filial",
              <>
                <input
                  id={`${uid}-branch`}
                  value={v.branch}
                  onChange={(e) => set("branch", e.target.value)}
                  list={`${uid}-branches`}
                  maxLength={40}
                  className={inputCls}
                />
                <datalist id={`${uid}-branches`}>
                  {branches.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </>,
            )}
            {field(
              "amount",
              "Valor (R$)",
              <input
                id={`${uid}-amount`}
                value={v.amount}
                onChange={(e) => set("amount", e.target.value)}
                onBlur={() => {
                  const n = parseMoney(v.amount);
                  if (typeof n === "number") set("amount", moneyInput(n));
                }}
                inputMode="decimal"
                placeholder="0,00"
                aria-invalid={!!errors.amount}
                className={cx(inputCls, "text-right tabular-nums")}
              />,
            )}
            {field("competence", "Competência", dateInput("competence"))}
            {field("issueDate", "Emissão", dateInput("issueDate"))}
            {field("dueDate", "Vencimento", dateInput("dueDate"))}
            {field("paidDate", "Data efetiva do pagamento", dateInput("paidDate"))}
          </div>
          {showTitle &&
            field(
              "titleNumber",
              "Nº do título",
              <input
                id={`${uid}-titleNumber`}
                value={v.titleNumber}
                onChange={(e) => set("titleNumber", e.target.value)}
                maxLength={200}
                className={inputCls}
              />,
            )}
          {field(
            "status",
            "Status",
            <select
              id={`${uid}-status`}
              value={v.status}
              onChange={(e) => {
                const status = e.target.value as PaymentStatus;
                set("status", status);
                if (status === "pago" && !v.paidDate) set("paidDate", todayISO());
              }}
              className={inputCls}
            >
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PAYMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>,
          )}
          {field(
            "notes",
            "Observações",
            <textarea
              id={`${uid}-notes`}
              value={v.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              maxLength={500}
              className={cx(inputCls, "h-auto resize-y py-2")}
            />,
          )}
        </div>
        <footer className="flex items-center gap-2 border-t border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className={cx(btnGhost, "text-red-600 dark:text-red-400")}
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="hidden sm:inline">Excluir</span>
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={btnGhost}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {entry ? "Salvar" : "Adicionar"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
