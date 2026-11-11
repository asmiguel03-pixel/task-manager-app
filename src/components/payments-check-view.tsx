"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeft, Check, CircleCheck, Copy, Download, FileCheck, Lock, TriangleAlert } from "lucide-react";
import { monthLabel, paymentAlerts, paymentSummary, type PaymentAlert } from "@/lib/payment-domain";
import { exportPaymentsXlsx, paymentFileName, type ExtraColumns } from "@/lib/payment-export";
import { parsePaymentWorkbook, type ImportedMonth } from "@/lib/payment-import";
import {
  PAYMENT_SHEETS,
  PAYMENT_STATUS_LABELS,
  SHEET_LABELS,
  type Payment,
  type PaymentSheet,
  type PaymentStatus,
} from "@/lib/payment-schema";
import {
  checkPaymentsAgainstSap,
  paymentCheckText,
  sapStateText,
  type PaymentSapResult,
  type SapState,
} from "@/lib/payment-sap";
import { guessSapColumns, type SapColumns } from "@/lib/reconcile";
import { todayISO } from "@/lib/task-domain";
import { formatBR } from "@/lib/work-tools";
import { XLSX_MIME, type StyleName } from "@/lib/xlsx";
import { readXlsx } from "@/lib/xlsx-read";
import { PaymentsView } from "./payments-view";
import { ColumnSelect, loadTables, SourceCard, type Source } from "./reconcile-view";
import { btnGhost, btnPrimary, cx, inputCls } from "./ui";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_BADGE: Record<PaymentStatus, string> = {
  pago: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  enviado: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  recebido: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  novo_boleto: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
  nao_recebido: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};
const SAP_BADGE: Record<SapState, string> = {
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  partial: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
  open: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  not_found: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  no_sap: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};
const SAP_STYLE: Record<SapState, StyleName> = {
  paid: "statusGreen",
  partial: "statusOrange",
  open: "statusBlue",
  overdue: "statusRed",
  not_found: "statusGray",
  no_sap: "statusGray",
};

type Filter = "all" | "issues" | "open" | "to_update" | "not_found";

interface Issue {
  entry: Payment;
  severity: "danger" | "warning";
  message: string;
}

// Alertas da planilha que o SAP já resolve quando mostra o título como pago.
const SUPERSEDED_BY_SAP_PAID = new Set<PaymentAlert["kind"]>(["overdue", "due_today", "due_soon", "date_not_paid"]);

export function PaymentsCheckView({ toast }: { toast: (message: string, kind?: "success" | "info" | "error") => void }) {
  const uid = useId();
  const [today, setToday] = useState("");
  const [savedMode, setSavedMode] = useState(false);
  const [control, setControl] = useState<{ fileName: string; months: ImportedMonth[] } | null>(null);
  const [controlError, setControlError] = useState("");
  const [month, setMonth] = useState("");
  const [sheet, setSheet] = useState<PaymentSheet>("rh");
  const [sap, setSap] = useState<Source<SapColumns> | null>(null);
  const [sapError, setSapError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);

  useEffect(() => setToday(todayISO()), []);

  const openControl = async (file: File) => {
    setControlError("");
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error("Use a planilha de controle em .xlsx.");
      const months = parsePaymentWorkbook(
        await readXlsx(new Uint8Array(await file.arrayBuffer())),
        Number(todayISO().slice(0, 4)),
      );
      if (!months.length) throw new Error('Não encontrei abas de mês com a coluna "Fornecedor" nessa planilha.');
      setControl({ fileName: file.name, months });
      const current = todayISO().slice(0, 7);
      setMonth((months.find((m) => m.month === current) ?? months[0]).month);
      const votes = months.filter((m) => m.sheetGuess === "criticos").length;
      setSheet(votes > months.length / 2 ? "criticos" : "rh");
    } catch (e) {
      setControl(null);
      setControlError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  };

  const openSap = async (file: File) => {
    setSapError("");
    try {
      const tables = await loadTables(file);
      setSap({ fileName: file.name, tables, tableIndex: 0, columns: guessSapColumns(tables[0].headers) });
    } catch (e) {
      setSap(null);
      setSapError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  };

  const selected = control?.months.find((m) => m.month === month);
  const entries: Payment[] = useMemo(
    () =>
      (selected?.rows ?? []).map((r, i) => ({
        ...r,
        id: `l${i}`,
        sheet,
        createdAt: "",
        updatedAt: "",
      })),
    [selected, sheet],
  );
  const sapTable = sap?.tables[sap.tableIndex];
  const sapResults = useMemo(
    () => (sap && sapTable && today ? checkPaymentsAgainstSap(entries, sapTable, sap.columns, today) : undefined),
    [entries, sap, sapTable, today],
  );

  const issues: Issue[] = useMemo(() => {
    if (!today) return [];
    const byId = new Map(entries.map((p) => [p.id, p]));
    const list: Issue[] = [];
    for (const a of paymentAlerts(entries, today)) {
      if (sapResults?.get(a.entryId)?.state === "paid" && SUPERSEDED_BY_SAP_PAID.has(a.kind)) continue;
      const entry = byId.get(a.entryId);
      if (entry) list.push({ entry, severity: a.severity, message: a.message });
    }
    if (sapResults) {
      for (const p of entries) {
        for (const i of sapResults.get(p.id)?.issues ?? []) {
          // Evita repetir "vencido" quando a planilha já acusou.
          if (i.severity === "danger" && /^Vencido/.test(i.message) && list.some((x) => x.entry === p && /^Venceu/.test(x.message))) {
            continue;
          }
          list.push({ entry: p, ...i });
        }
      }
    }
    const order = new Map(entries.map((p, i) => [p.id, i]));
    return list.sort(
      (a, b) =>
        (a.severity === "danger" ? 0 : 1) - (b.severity === "danger" ? 0 : 1) ||
        (order.get(a.entry.id) ?? 0) - (order.get(b.entry.id) ?? 0),
    );
  }, [entries, sapResults, today]);

  const issuesById = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) m.set(i.entry.id, [...(m.get(i.entry.id) ?? []), i]);
    return m;
  }, [issues]);

  if (savedMode) {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={() => setSavedMode(false)} className={cx(btnGhost, "self-start")}>
          <ArrowLeft className="size-4" aria-hidden />
          Voltar para a conferência por arquivo
        </button>
        <PaymentsView toast={toast} />
      </div>
    );
  }

  const summary = paymentSummary(entries, today || "0000-00-00");
  const toUpdate = sapResults ? entries.filter((p) => p.status !== "pago" && sapResults.get(p.id)?.state === "paid") : [];
  const notFound = sapResults ? entries.filter((p) => p.status !== "nao_recebido" && sapResults.get(p.id)?.state === "not_found") : [];
  const isOpen = (p: Payment) => p.status !== "pago" && sapResults?.get(p.id)?.state !== "paid";
  const visible = entries.filter((p) =>
    filter === "issues"
      ? issuesById.has(p.id)
      : filter === "open"
        ? isOpen(p)
        : filter === "to_update"
          ? toUpdate.includes(p)
          : filter === "not_found"
            ? notFound.includes(p)
            : true,
  );
  const danger = issues.filter((i) => i.severity === "danger").length;
  const title = `${SHEET_LABELS[sheet]} — ${month ? monthLabel(month) : ""}`;

  const extra: ExtraColumns | undefined = sapResults
    ? {
        header: ["SAP", "Conferência"],
        widths: [24, 46],
        cells: (p) => {
          const r: PaymentSapResult | undefined = sapResults.get(p.id);
          const msgs = (issuesById.get(p.id) ?? []).map((i) => i.message).join(" ");
          return [
            { v: sapStateText(r), s: SAP_STYLE[r?.state ?? "no_sap"] },
            { v: msgs, s: issuesById.get(p.id)?.some((i) => i.severity === "danger") ? "statusRed" : "tdWrap" },
          ];
        },
      }
    : {
        header: ["Conferência"],
        widths: [46],
        cells: (p) => [
          {
            v: (issuesById.get(p.id) ?? []).map((i) => i.message).join(" "),
            s: issuesById.get(p.id)?.some((i) => i.severity === "danger") ? "statusRed" : "tdWrap",
          },
        ],
      };

  const download = () => {
    const blob = new Blob([exportPaymentsXlsx(entries, sheet, month, today, extra) as BlobPart], { type: XLSX_MIME });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = paymentFileName(sheet, month).replace(/\.xlsx$/, " - conferido.xlsx");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Planilha conferida baixada", "success");
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(paymentCheckText({ title, entries, issues, sap: sapResults, today }));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Não foi possível copiar.", "error");
    }
  };

  const who = (p: Payment) => (
    <>
      <span className="font-medium">{p.supplier}</span>
      {p.branch && <span className="ml-1.5 text-xs text-zinc-500">· {p.branch}</span>}
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-2">
        <p className="flex flex-1 items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          Suba a planilha de controle e, se quiser, a extração do SAP. O app confere o mês escolhido, cruza com o SAP e
          gera a planilha marcada. Os arquivos são lidos só no seu navegador.
        </p>
        <button type="button" onClick={() => setSavedMode(true)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          Lançamentos salvos no app
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">1</span>
            Planilha de controle
          </h3>
          <label
            htmlFor={`${uid}-control`}
            className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-zinc-300 p-3 text-sm hover:border-indigo-400 dark:border-zinc-700"
          >
            <FileCheck className="size-5 shrink-0 text-emerald-600" aria-hidden />
            <span className="min-w-0 truncate">{control?.fileName || "Escolher a planilha (Pagamentos RH ou Títulos críticos)"}</span>
            <input
              id={`${uid}-control`}
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) openControl(f);
                e.target.value = "";
              }}
            />
          </label>
          {controlError && <p className="text-sm text-red-600 dark:text-red-400">{controlError}</p>}
          {control && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`${uid}-month`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Mês
                </label>
                <select id={`${uid}-month`} value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls}>
                  {control.months.map((m) => (
                    <option key={m.month} value={m.month}>
                      {monthLabel(m.month)} ({m.rows.length} linhas)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-sheet`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Tipo
                </label>
                <select id={`${uid}-sheet`} value={sheet} onChange={(e) => setSheet(e.target.value as PaymentSheet)} className={inputCls}>
                  {PAYMENT_SHEETS.map((s) => (
                    <option key={s} value={s}>
                      {SHEET_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </section>

        <SourceCard
          step={2}
          title="Extração do SAP (opcional)"
          hint="Escolher a extração de partidas do fornecedor"
          source={sap}
          error={sapError}
          onFile={openSap}
          onTable={(i) => sap && setSap({ ...sap, tableIndex: i, columns: guessSapColumns(sap.tables[i].headers) })}
        >
          {sapTable && (
            <>
              <ColumnSelect label="Referência / Nº NF" required value={sap?.columns.doc} headers={sapTable.headers} onChange={(v) => sap && setSap({ ...sap, columns: { ...sap.columns, doc: v ?? 0 } })} />
              <ColumnSelect label="Outro nº (ex.: Journal Entry)" value={sap?.columns.doc2} headers={sapTable.headers} onChange={(v) => sap && setSap({ ...sap, columns: { ...sap.columns, doc2: v } })} />
              <ColumnSelect label="Nome do fornecedor" value={sap?.columns.name} headers={sapTable.headers} onChange={(v) => sap && setSap({ ...sap, columns: { ...sap.columns, name: v } })} />
              <ColumnSelect label="Montante" value={sap?.columns.amount} headers={sapTable.headers} onChange={(v) => sap && setSap({ ...sap, columns: { ...sap.columns, amount: v } })} />
              <ColumnSelect label="Vencimento" value={sap?.columns.due} headers={sapTable.headers} onChange={(v) => sap && setSap({ ...sap, columns: { ...sap.columns, due: v } })} />
              <ColumnSelect label="Data de compensação" value={sap?.columns.clearingDate} headers={sapTable.headers} onChange={(v) => sap && setSap({ ...sap, columns: { ...sap.columns, clearingDate: v } })} />
              <ColumnSelect label="Doc. compensação" value={sap?.columns.clearingDoc} headers={sapTable.headers} onChange={(v) => sap && setSap({ ...sap, columns: { ...sap.columns, clearingDoc: v } })} />
            </>
          )}
        </SourceCard>
      </div>

      {sap && sap.columns.clearingDate === undefined && sap.columns.clearingDoc === undefined && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Sem coluna de compensação não dá para saber o que já foi pago. Exporte o SAP com partidas em aberto e
          compensadas, incluindo &quot;Clearing Journal Entry&quot; / &quot;Data de compensação&quot;.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { k: "all" as const, label: "Lançamentos", value: String(entries.length), sub: `total ${brl(summary.total)}`, tone: "" },
              {
                k: "open" as const,
                label: "Em aberto",
                value: String(entries.filter(isOpen).length),
                sub: brl(entries.filter(isOpen).reduce((s, p) => s + (p.amount ?? 0), 0)),
                tone: "",
              },
              {
                k: "issues" as const,
                label: "Com alerta",
                value: String(issuesById.size),
                sub: danger ? `${danger} urgente(s)` : "nenhum urgente",
                tone: danger ? "red" : "",
              },
              sapResults
                ? {
                    k: "to_update" as const,
                    label: "Pago no SAP, falta na planilha",
                    value: String(toUpdate.length),
                    sub: `${notFound.length} não encontrado(s) no SAP`,
                    tone: toUpdate.length ? "amber" : "",
                  }
                : { k: "all" as const, label: "Conferido com o SAP", value: "—", sub: "suba a extração no passo 2", tone: "" },
            ].map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setFilter(filter === c.k ? "all" : c.k)}
                aria-pressed={filter === c.k && c.k !== "all"}
                className={cx(
                  "rounded-xl border p-4 text-left",
                  filter === c.k && c.k !== "all" && "ring-2 ring-indigo-500",
                  c.tone === "red"
                    ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                    : c.tone === "amber"
                      ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
                )}
              >
                <dt className="text-sm text-zinc-500 dark:text-zinc-400">{c.label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{c.value}</dd>
                <dd className="mt-0.5 text-xs text-zinc-500">{c.sub}</dd>
              </button>
            ))}
          </dl>

          {issues.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50/60 p-4 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CircleCheck className="size-4" aria-hidden />
              Conferência ok: nada vencido em aberto e nenhuma divergência{sapResults ? " com o SAP" : ""}.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filtrar" className={cx(inputCls, "w-auto")}>
              <option value="all">Todas as linhas</option>
              <option value="issues">Com alerta</option>
              <option value="open">Em aberto</option>
              {sapResults && <option value="to_update">Pago no SAP, falta na planilha</option>}
              {sapResults && <option value="not_found">Não encontrado no SAP</option>}
            </select>
            <span className="text-xs text-zinc-500">
              {visible.length} de {entries.length}
            </span>
            <span className="flex-1" />
            <button type="button" className={btnGhost} onClick={copySummary}>
              {copied ? <Check className="size-4 text-emerald-500" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              Copiar resumo
            </button>
            <button type="button" className={btnPrimary} onClick={download}>
              <Download className="size-4" aria-hidden />
              Baixar planilha conferida
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Fornecedor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 font-medium">Vencimento</th>
                  <th className="px-3 py-2.5 font-medium">Planilha</th>
                  {sapResults && <th className="px-3 py-2.5 font-medium">SAP</th>}
                  <th className="px-3 py-2.5 font-medium">Conferência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {visible.map((p) => {
                  const list = issuesById.get(p.id) ?? [];
                  const sev = list.some((i) => i.severity === "danger") ? "danger" : list.length ? "warning" : null;
                  const r = sapResults?.get(p.id);
                  return (
                    <tr key={p.id} className={cx("align-top", sev === "danger" && "bg-red-50/60 dark:bg-red-950/20")}>
                      <td className={cx("max-w-sm border-l-4 px-3 py-2", sev === "danger" ? "border-red-500" : sev === "warning" ? "border-amber-400" : "border-transparent")}>
                        {who(p)}
                        {p.titleNumber && <p className="mt-0.5 text-xs text-zinc-500">Título: {p.titleNumber}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{p.amount !== undefined ? brl(p.amount) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{p.dueDate ? formatBR(p.dueDate) : "—"}</td>
                      <td className="px-3 py-2">
                        <span className={cx("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE[p.status])}>
                          {PAYMENT_STATUS_LABELS[p.status]}
                        </span>
                        {p.paidDate && <p className="mt-1 text-xs text-zinc-500">em {formatBR(p.paidDate)}</p>}
                      </td>
                      {sapResults && (
                        <td className="px-3 py-2">
                          <span className={cx("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", SAP_BADGE[r?.state ?? "no_sap"])}>
                            {sapStateText(r)}
                          </span>
                          {r?.matchedBy === "supplier" && <p className="mt-1 text-xs text-zinc-500">achado por nome + valor</p>}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <ul className="space-y-0.5">
                          {list.map((i, k) => (
                            <li
                              key={k}
                              className={cx(
                                "flex items-start gap-1 text-xs",
                                i.severity === "danger" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400",
                              )}
                            >
                              <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                              {i.message}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
