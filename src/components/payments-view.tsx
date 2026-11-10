"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCheck,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
  Landmark,
  X,
} from "lucide-react";
import { usePayments, type PaymentPatch } from "@/hooks/use-payments";
import {
  currentMonth,
  entriesFor,
  monthLabel,
  monthsWithData,
  newMonthInputs,
  paymentAlerts,
  paymentSummary,
  shiftMonth,
  type PaymentAlert,
} from "@/lib/payment-domain";
import { exportPaymentsXlsx, paymentFileName } from "@/lib/payment-export";
import {
  PAYMENT_SHEETS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  SHEET_LABELS,
  type Payment,
  type PaymentInput,
  type PaymentSheet,
  type PaymentStatus,
} from "@/lib/payment-schema";
import { todayISO } from "@/lib/task-domain";
import { formatBR } from "@/lib/work-tools";
import { XLSX_MIME } from "@/lib/xlsx";
import { PaymentFormDialog } from "./payment-form-dialog";
import { PaymentImportDialog } from "./payment-import-dialog";
import { btnGhost, btnPrimary, ConfirmDialog, cx, IconButton, inputCls } from "./ui";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SHEET_KEY = "task-manager:payments:sheet";

const STATUS_BADGE: Record<PaymentStatus, string> = {
  pago: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  enviado: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  recebido: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  novo_boleto: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
  nao_recebido: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

type Filter = "all" | "open" | "alerts" | PaymentStatus;
type FormState = { mode: "create" } | { mode: "edit"; entry: Payment } | null;

function StatusSelect({ value, onChange }: { value: PaymentStatus; onChange: (s: PaymentStatus) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as PaymentStatus)}
      aria-label="Status"
      className={cx(
        "h-7 max-w-[11.5rem] cursor-pointer rounded-full border-0 py-0 pl-2.5 pr-7 text-xs font-medium",
        STATUS_BADGE[value],
      )}
    >
      {PAYMENT_STATUSES.map((s) => (
        <option key={s} value={s}>
          {PAYMENT_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

export function PaymentsView({ toast }: { toast: (message: string, kind?: "success" | "info" | "error") => void }) {
  const { entries, loading, error, dismissError, createMany, update, remove } = usePayments();
  const [today, setToday] = useState("");
  const [sheet, setSheet] = useState<PaymentSheet>("rh");
  const [month, setMonth] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [form, setForm] = useState<FormState>(null);
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<Payment | null>(null);
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  // Data e preferências só no navegador (evita divergência com o servidor).
  useEffect(() => {
    const t = todayISO();
    setToday(t);
    setMonth(currentMonth(t));
    try {
      const saved = localStorage.getItem(SHEET_KEY);
      if (saved === "rh" || saved === "criticos") setSheet(saved);
    } catch {}
  }, []);

  const chooseSheet = (s: PaymentSheet) => {
    setSheet(s);
    setFilter("all");
    try {
      localStorage.setItem(SHEET_KEY, s);
    } catch {}
  };

  const monthEntries = useMemo(() => entriesFor(entries, sheet, month), [entries, sheet, month]);
  const alerts = useMemo(() => (today ? paymentAlerts(monthEntries, today) : []), [monthEntries, today]);
  const summary = useMemo(() => paymentSummary(monthEntries, today || "0000-00-00"), [monthEntries, today]);
  const alertsById = useMemo(() => {
    const map = new Map<string, PaymentAlert[]>();
    for (const a of alerts) map.set(a.entryId, [...(map.get(a.entryId) ?? []), a]);
    return map;
  }, [alerts]);
  const branches = useMemo(
    () => [...new Set(entries.map((p) => p.branch).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [entries],
  );
  const showTitle = sheet === "criticos" || monthEntries.some((p) => p.titleNumber);
  const previousMonth = monthsWithData(entries, sheet).find((m) => m < month);

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const visible = monthEntries.filter((p) => {
    if (filter === "open" && p.status === "pago") return false;
    if (filter === "alerts" && !alertsById.has(p.id)) return false;
    if (filter !== "all" && filter !== "open" && filter !== "alerts" && p.status !== filter) return false;
    if (search.trim()) {
      const q = norm(search.trim());
      return norm(`${p.supplier} ${p.branch} ${p.titleNumber ?? ""} ${p.notes ?? ""}`).includes(q);
    }
    return true;
  });

  const danger = alerts.filter((a) => a.severity === "danger").length;
  const warning = alerts.length - danger;

  const changeStatus = async (p: Payment, status: PaymentStatus) => {
    const patch: PaymentPatch = { status };
    if (status === "pago" && !p.paidDate) patch.paidDate = today;
    if (status !== "pago" && p.status === "pago") patch.paidDate = null;
    const next = await update(p.id, patch);
    if (next && patch.paidDate) toast(`Pago em ${formatBR(patch.paidDate)} (data de hoje). Ajuste se precisar.`, "info");
  };

  const startMonth = async () => {
    const inputs = newMonthInputs(entries, sheet, month);
    if (!inputs.length) return;
    const created = await createMany(inputs);
    if (created) toast(`${monthLabel(month)} iniciado com ${created.length} fornecedores`, "success");
  };

  const download = () => {
    const blob = new Blob([exportPaymentsXlsx(monthEntries, sheet, month, today) as BlobPart], { type: XLSX_MIME });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = paymentFileName(sheet, month);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Planilha baixada", "success");
  };

  if (!month) return null;

  const supplierLabel = (p: Payment) => (
    <>
      <span className="font-medium">{p.supplier}</span>
      {p.branch && <span className="ml-1.5 text-xs text-zinc-500">· {p.branch}</span>}
    </>
  );

  const rowAlerts = (p: Payment) => {
    const list = alertsById.get(p.id);
    if (!list) return null;
    return (
      <ul className="mt-1 space-y-0.5">
        {list.map((a, i) => (
          <li
            key={i}
            className={cx(
              "flex items-start gap-1 text-xs",
              a.severity === "danger" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400",
            )}
          >
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {a.message}
          </li>
        ))}
      </ul>
    );
  };

  const shownAlerts = showAllAlerts ? alerts : alerts.slice(0, 6);

  return (
    <div className="flex flex-col gap-5">
      {/* Controles */}
      <section aria-label="Planilha e mês" className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div role="group" aria-label="Planilha" className="inline-flex self-start rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
          {PAYMENT_SHEETS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sheet === s}
              onClick={() => chooseSheet(s)}
              className={cx(
                "h-8 rounded-md px-3 text-sm font-medium transition-colors",
                sheet === s
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              {SHEET_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))} className="size-9">
            <ChevronLeft className="size-5" aria-hidden />
          </IconButton>
          <h2 className="min-w-36 text-center text-base font-semibold" aria-live="polite">
            {monthLabel(month)}
          </h2>
          <IconButton label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))} className="size-9">
            <ChevronRight className="size-5" aria-hidden />
          </IconButton>
          {month !== currentMonth(today) && (
            <button type="button" onClick={() => setMonth(currentMonth(today))} className="ml-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              Mês atual
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 lg:ml-auto">
          <button type="button" className={btnGhost} onClick={() => setImporting(true)}>
            <FileCheck className="size-4" aria-hidden />
            Importar
          </button>
          <button type="button" className={btnGhost} onClick={download} disabled={!monthEntries.length}>
            <Download className="size-4" aria-hidden />
            Baixar planilha
          </button>
          <button type="button" className={btnPrimary} onClick={() => setForm({ mode: "create" })}>
            <Plus className="size-4" aria-hidden />
            Lançamento
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
          <button type="button" onClick={dismissError} aria-label="Dispensar aviso" className="rounded p-1">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {loading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" aria-busy="true" aria-label="Carregando" />
      ) : monthEntries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
          <span className="flex size-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
            <Landmark className="size-6" aria-hidden />
          </span>
          <div>
            <p className="font-semibold">
              {SHEET_LABELS[sheet]} — {monthLabel(month)} ainda está vazio
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {previousMonth
                ? `Comece com a mesma lista de fornecedores de ${monthLabel(previousMonth)} (em branco, só nomes e filiais).`
                : "Importe a planilha que vocês já usam ou adicione os lançamentos um a um."}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {previousMonth && (
              <button type="button" className={btnPrimary} onClick={startMonth}>
                Começar {monthLabel(month)}
              </button>
            )}
            <button type="button" className={btnGhost} onClick={() => setImporting(true)}>
              <FileCheck className="size-4" aria-hidden />
              Importar planilha
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Resumo */}
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Lançamentos", value: String(summary.count), sub: `${summary.paidCount} pagos · ${summary.notReceived} não recebidos` },
              { label: "Total do mês", value: brl(summary.total), sub: "soma dos valores lançados" },
              { label: "Pago", value: brl(summary.paidTotal), sub: `${summary.paidCount} pagamentos` },
              {
                label: "Em aberto",
                value: brl(summary.openTotal),
                sub: summary.overdueCount ? `${summary.overdueCount} vencido(s)` : "nenhum vencido",
                alert: summary.overdueCount > 0,
              },
            ].map((c) => (
              <div
                key={c.label}
                className={cx(
                  "rounded-xl border p-4",
                  c.alert
                    ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
                )}
              >
                <dt className="text-sm text-zinc-500 dark:text-zinc-400">{c.label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{c.value}</dd>
                <dd className={cx("mt-0.5 text-xs", c.alert ? "font-medium text-red-700 dark:text-red-300" : "text-zinc-500")}>{c.sub}</dd>
              </div>
            ))}
          </dl>

          {/* Conferência */}
          <section
            aria-label="Conferência"
            className={cx(
              "rounded-xl border p-4",
              alerts.length
                ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
                : "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
            )}
          >
            {alerts.length === 0 ? (
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                <CircleCheck className="size-4" aria-hidden />
                Conferência ok: nada vencido, nenhuma inconsistência encontrada neste mês.
              </p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <TriangleAlert className="size-4 text-amber-600" aria-hidden />
                    Conferência
                  </h3>
                  {danger > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                      {danger} urgente{danger > 1 ? "s" : ""}
                    </span>
                  )}
                  {warning > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      {warning} aviso{warning > 1 ? "s" : ""}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setFilter(filter === "alerts" ? "all" : "alerts")}
                    className="ml-auto text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {filter === "alerts" ? "Mostrar todas as linhas" : "Mostrar só linhas com alerta"}
                  </button>
                </div>
                <ul className="space-y-1 text-sm">
                  {shownAlerts.map((a, i) => {
                    const p = monthEntries.find((x) => x.id === a.entryId);
                    if (!p) return null;
                    return (
                      <li key={`${a.entryId}-${a.kind}-${i}`}>
                        <button
                          type="button"
                          onClick={() => setForm({ mode: "edit", entry: p })}
                          className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left hover:bg-white/70 dark:hover:bg-zinc-900/60"
                        >
                          <span
                            className={cx("mt-1.5 size-2 shrink-0 rounded-full", a.severity === "danger" ? "bg-red-500" : "bg-amber-500")}
                            aria-hidden
                          />
                          <span>
                            {supplierLabel(p)} <span className="text-zinc-600 dark:text-zinc-400">— {a.message}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {alerts.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAllAlerts((v) => !v)}
                    className="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {showAllAlerts ? "Mostrar menos" : `Ver todos os ${alerts.length} alertas`}
                  </button>
                )}
              </>
            )}
          </section>

          {/* Filtros */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar fornecedor, título…"
                aria-label="Buscar lançamentos"
                className={cx(inputCls, "pl-9")}
              />
            </div>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              aria-label="Filtrar por status"
              className={cx(inputCls, "sm:w-56")}
            >
              <option value="all">Todos os status</option>
              <option value="open">Em aberto (não pagos)</option>
              <option value="alerts">Com alerta</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PAYMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <p className="self-center text-xs text-zinc-500 sm:ml-auto">
              {visible.length} de {monthEntries.length} lançamentos
            </p>
          </div>

          {/* Tabela (computador) */}
          <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Fornecedor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 font-medium">Vencimento</th>
                  <th className="px-3 py-2.5 font-medium">Pago em</th>
                  {showTitle && <th className="px-3 py-2.5 font-medium">Nº título</th>}
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {visible.map((p) => {
                  const list = alertsById.get(p.id);
                  const sev = list?.some((a) => a.severity === "danger") ? "danger" : list ? "warning" : null;
                  return (
                    <tr
                      key={p.id}
                      className={cx(
                        "align-top",
                        sev === "danger" && "bg-red-50/60 dark:bg-red-950/20",
                        sev === "warning" && "bg-amber-50/40 dark:bg-amber-950/10",
                      )}
                    >
                      <td className={cx("max-w-md border-l-4 px-3 py-2", sev === "danger" ? "border-red-500" : sev === "warning" ? "border-amber-400" : "border-transparent")}>
                        {supplierLabel(p)}
                        {p.notes && <p className="mt-0.5 text-xs text-zinc-500">{p.notes}</p>}
                        {rowAlerts(p)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{p.amount !== undefined ? brl(p.amount) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{p.dueDate ? formatBR(p.dueDate) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{p.paidDate ? formatBR(p.paidDate) : "—"}</td>
                      {showTitle && <td className="max-w-40 break-words px-3 py-2 text-xs">{p.titleNumber ?? "—"}</td>}
                      <td className="px-3 py-2">
                        <StatusSelect value={p.status} onChange={(s) => changeStatus(p, s)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <IconButton label={`Editar ${p.supplier}`} onClick={() => setForm({ mode: "edit", entry: p })}>
                          <Pencil className="size-4" aria-hidden />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cartões (celular) */}
          <ul className="space-y-2 md:hidden">
            {visible.map((p) => {
              const list = alertsById.get(p.id);
              const sev = list?.some((a) => a.severity === "danger") ? "danger" : list ? "warning" : null;
              return (
                <li
                  key={p.id}
                  className={cx(
                    "rounded-xl border border-l-4 bg-white p-3 dark:bg-zinc-900",
                    "border-zinc-200 dark:border-zinc-800",
                    sev === "danger" ? "border-l-red-500" : sev === "warning" ? "border-l-amber-400" : "",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button type="button" onClick={() => setForm({ mode: "edit", entry: p })} className="min-w-0 flex-1 text-left text-sm">
                      {supplierLabel(p)}
                    </button>
                    <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
                      {p.amount !== undefined ? brl(p.amount) : "—"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span>Venc.: {p.dueDate ? formatBR(p.dueDate) : "—"}</span>
                    {p.paidDate && <span>Pago: {formatBR(p.paidDate)}</span>}
                    {p.titleNumber && <span>Título: {p.titleNumber}</span>}
                  </div>
                  <div className="mt-2">
                    <StatusSelect value={p.status} onChange={(s) => changeStatus(p, s)} />
                  </div>
                  {rowAlerts(p)}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {form && (
        <PaymentFormDialog
          key={form.mode === "edit" ? form.entry.id : "new"}
          entry={form.mode === "edit" ? form.entry : undefined}
          branches={branches}
          showTitle={showTitle || sheet === "criticos"}
          onClose={() => setForm(null)}
          onDelete={
            form.mode === "edit"
              ? () => {
                  setToDelete(form.entry);
                  setForm(null);
                }
              : undefined
          }
          onSubmit={async (values) => {
            if (form.mode === "edit") {
              const r = await update(form.entry.id, values);
              if (r) toast("Lançamento atualizado", "success");
              return r;
            }
            const input: PaymentInput = {
              sheet,
              month,
              order: monthEntries.length ? Math.max(...monthEntries.map((p) => p.order)) + 1 : 0,
              supplier: values.supplier,
              branch: values.branch,
              status: values.status,
              competence: values.competence ?? undefined,
              issueDate: values.issueDate ?? undefined,
              amount: values.amount ?? undefined,
              dueDate: values.dueDate ?? undefined,
              paidDate: values.paidDate ?? undefined,
              titleNumber: values.titleNumber ?? undefined,
              notes: values.notes ?? undefined,
            };
            const r = await createMany([input]);
            if (r) toast("Lançamento adicionado", "success");
            return r;
          }}
        />
      )}

      {importing && (
        <PaymentImportDialog
          existing={entries}
          defaultSheet={sheet}
          currentYear={Number(today.slice(0, 4))}
          onClose={() => setImporting(false)}
          onImport={async (inputs, replace, target) => {
            const r = await createMany(inputs, replace);
            if (!r) return false;
            chooseSheet(target.sheet);
            setMonth(target.month);
            toast(`${r.length} lançamentos importados`, "success");
            return true;
          }}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title="Excluir lançamento?"
          message={
            <>
              <strong className="font-semibold">{toDelete.supplier}</strong>
              {toDelete.branch ? ` (${toDelete.branch})` : ""} será removido de {monthLabel(toDelete.month)}.
            </>
          }
          confirmLabel="Excluir"
          onCancel={() => setToDelete(null)}
          onConfirm={async () => {
            const p = toDelete;
            setToDelete(null);
            if (await remove(p.id)) toast("Lançamento excluído", "info");
          }}
        />
      )}
    </div>
  );
}
