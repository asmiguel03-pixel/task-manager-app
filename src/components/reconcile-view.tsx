"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Check, Copy, Download, FileCheck, Lock, TriangleAlert } from "lucide-react";
import {
  emailText,
  groupResults,
  guessReportColumns,
  guessSapColumns,
  parseDelimited,
  paymentLabel,
  POSTED_LABELS,
  reconcile,
  reconcileSummary,
  tableFromSheet,
  type GroupResult,
  type PaymentState,
  type PostedStatus,
  type ReconcileRow,
  type ReportColumns,
  type SapColumns,
  type Table,
} from "@/lib/reconcile";
import { exportReconcileXlsx } from "@/lib/reconcile-export";
import { todayISO } from "@/lib/task-domain";
import { formatBR } from "@/lib/work-tools";
import { readXlsx, type ReadSheet } from "@/lib/xlsx-read";
import { XLSX_MIME } from "@/lib/xlsx";
import { btnGhost, btnPrimary, cx, inputCls } from "./ui";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const POSTED_BADGE: Record<PostedStatus, string> = {
  posted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  posted_diff: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
  not_posted: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
};
const PAYMENT_BADGE: Record<PaymentState, string> = {
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  open_overdue: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  open: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  unknown: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

type Filter = "all" | "not_posted" | "overdue_open" | "diff" | "paid";

/** Lê .xlsx, ou .csv/.txt (UTF-8 ou o padrão do Windows usado pelo SAP). */
export async function loadTables(file: File): Promise<Table[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let sheets: ReadSheet[];
  if (/\.(csv|txt)$/i.test(file.name)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("windows-1252").decode(bytes);
    }
    sheets = [parseDelimited(text, file.name)];
  } else if (/\.xlsx$/i.test(file.name)) {
    sheets = await readXlsx(bytes);
  } else if (/\.xls$/i.test(file.name)) {
    throw new Error("Arquivo .xls antigo: abra no Excel e salve como .xlsx (Pasta de Trabalho do Excel).");
  } else if (/\.pdf$/i.test(file.name)) {
    throw new Error("PDF ainda não é aceito. Se o relatório vier em PDF, me mande um exemplo para eu incluir.");
  } else {
    throw new Error("Use um arquivo .xlsx, .csv ou .txt.");
  }
  const tables = sheets.filter((s) => !s.hidden).flatMap((s) => tableFromSheet(s) ?? []);
  if (!tables.length) throw new Error("Não encontrei uma tabela com cabeçalho nesse arquivo.");
  return tables;
}

export interface Source<C> {
  fileName: string;
  tables: Table[];
  tableIndex: number;
  columns: C;
}

export function ColumnSelect({
  label,
  value,
  headers,
  required,
  onChange,
}: {
  label: string;
  value: number | undefined;
  headers: string[];
  required?: boolean;
  onChange: (v: number | undefined) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
        {required && " *"}
      </label>
      <select
        id={id}
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className={inputCls}
      >
        {!required && <option value="">— não usar —</option>}
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SourceCard<C extends object>({
  step,
  title,
  hint,
  source,
  onFile,
  onTable,
  error,
  children,
}: {
  step: number;
  title: string;
  hint: string;
  source: Source<C> | null;
  onFile: (f: File) => void;
  onTable: (i: number) => void;
  error: string;
  children?: React.ReactNode;
}) {
  const id = useId();
  const table = source?.tables[source.tableIndex];
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">{step}</span>
        {title}
      </h3>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-zinc-300 p-3 text-sm hover:border-indigo-400 dark:border-zinc-700"
      >
        <FileCheck className="size-5 shrink-0 text-emerald-600" aria-hidden />
        <span className="min-w-0 truncate">{source?.fileName || hint}</span>
        <input
          id={id}
          type="file"
          accept=".xlsx,.csv,.txt,.xls,.pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {source && table && (
        <>
          {source.tables.length > 1 && (
            <select
              aria-label="Aba da planilha"
              value={source.tableIndex}
              onChange={(e) => onTable(Number(e.target.value))}
              className={inputCls}
            >
              {source.tables.map((t, i) => (
                <option key={i} value={i}>
                  Aba: {t.name} ({t.rows.length} linhas)
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-zinc-500">
            {table.rows.length} linhas · cabeçalho na linha {table.headerRow}. Confira as colunas:
          </p>
          <div className="grid grid-cols-2 gap-2">{children}</div>
        </>
      )}
    </section>
  );
}

export function ReconcileView({ toast }: { toast: (message: string, kind?: "success" | "info" | "error") => void }) {
  const [today, setToday] = useState("");
  const [report, setReport] = useState<Source<ReportColumns> | null>(null);
  const [sap, setSap] = useState<Source<SapColumns> | null>(null);
  const [reportError, setReportError] = useState("");
  const [sapError, setSapError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);
  const [byGroup, setByGroup] = useState(true);

  useEffect(() => setToday(todayISO()), []);

  const openReport = async (file: File) => {
    setReportError("");
    try {
      const tables = await loadTables(file);
      setReport({ fileName: file.name, tables, tableIndex: 0, columns: guessReportColumns(tables[0].headers) });
    } catch (e) {
      setReport(null);
      setReportError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
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

  const reportTable = report?.tables[report.tableIndex];
  const sapTable = sap?.tables[sap.tableIndex];

  const rows: ReconcileRow[] = useMemo(
    () =>
      report && sap && reportTable && sapTable && today
        ? reconcile(reportTable, report.columns, sapTable, sap.columns, today)
        : [],
    [report, sap, reportTable, sapTable, today],
  );
  const summary = useMemo(() => reconcileSummary(rows, today), [rows, today]);
  const groups = useMemo(() => groupResults(rows, today), [rows, today]);
  const grouped = groups.length > 0;
  const showGroups = grouped && byGroup;
  const email = useMemo(() => (rows.length ? emailText(rows, today, formatBR) : ""), [rows, today]);

  const visible = rows.filter((r) =>
    filter === "not_posted"
      ? r.posted === "not_posted"
      : filter === "overdue_open"
        ? r.payment === "open_overdue" || (r.posted === "not_posted" && !!r.dueDate && r.dueDate < today)
        : filter === "diff"
          ? r.posted === "posted_diff"
          : filter === "paid"
            ? r.payment === "paid"
            : true,
  );

  const isLate = (g: GroupResult) => !!g.dueDate && g.dueDate < today && g.payment !== "paid";
  const visibleGroups = groups.filter((g) =>
    filter === "not_posted"
      ? g.posted !== "posted"
      : filter === "overdue_open"
        ? isLate(g)
        : filter === "diff"
          ? g.diffCount > 0
          : filter === "paid"
            ? g.payment === "paid"
            : true,
  );
  const cards = showGroups
    ? [
        { k: "all" as const, label: "Faturas no relatório", value: groups.length, tone: "" },
        { k: "not_posted" as const, label: "Faturas com doc. não lançado", value: groups.filter((g) => g.posted !== "posted").length, tone: "red" },
        { k: "overdue_open" as const, label: "Faturas vencidas em aberto", value: groups.filter(isLate).length, tone: "red" },
        { k: "paid" as const, label: "Faturas pagas", value: groups.filter((g) => g.payment === "paid").length, tone: "green" },
      ]
    : [
        { k: "all" as const, label: "Itens no relatório", value: summary.total, tone: "" },
        { k: "not_posted" as const, label: "Não lançados", value: summary.notPosted, tone: "red" },
        { k: "overdue_open" as const, label: "Vencidos em aberto", value: summary.overdueOpen + summary.overdueNotPosted, tone: "red" },
        { k: "paid" as const, label: "Vencidos já pagos", value: summary.overduePaid, tone: "green" },
      ];

  const download = () => {
    if (!report || !reportTable) return;
    const blob = new Blob([exportReconcileXlsx(reportTable, report.columns, rows, today) as BlobPart], { type: XLSX_MIME });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Conferencia relatorio x sistema - ${formatBR(today).replace(/\//g, "-")}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Planilha da conferência baixada", "success");
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Não foi possível copiar. Selecione o texto e copie manualmente.", "error");
    }
  };

  const headersR = reportTable?.headers ?? [];
  const headersS = sapTable?.headers ?? [];
  const setRC = (patch: Partial<ReportColumns>) => report && setReport({ ...report, columns: { ...report.columns, ...patch } });
  const setSC = (patch: Partial<SapColumns>) => sap && setSap({ ...sap, columns: { ...sap.columns, ...patch } });

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        Cruza o relatório recebido com a extração do sistema (SAP ou outro ERP) e mostra o que está lançado, o que não está e, dos vencidos, o
        que já foi pago. Os arquivos são lidos só no seu navegador — nada é enviado nem salvo.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <SourceCard
          step={1}
          title="Relatório recebido"
          hint="Escolher o relatório (.xlsx ou .csv)"
          source={report}
          error={reportError}
          onFile={openReport}
          onTable={(i) => report && setReport({ ...report, tableIndex: i, columns: guessReportColumns(report.tables[i].headers) })}
        >
          <ColumnSelect label="Nº da NF / documento" required value={report?.columns.doc} headers={headersR} onChange={(v) => setRC({ doc: v ?? 0 })} />
          <ColumnSelect label="Fatura (agrupa documentos)" value={report?.columns.group} headers={headersR} onChange={(v) => setRC({ group: v })} />
          <ColumnSelect label="Fornecedor" value={report?.columns.supplier} headers={headersR} onChange={(v) => setRC({ supplier: v })} />
          <ColumnSelect label="CNPJ / CPF" value={report?.columns.taxId} headers={headersR} onChange={(v) => setRC({ taxId: v })} />
          <ColumnSelect label="Valor" value={report?.columns.amount} headers={headersR} onChange={(v) => setRC({ amount: v })} />
          <ColumnSelect label="Vencimento" value={report?.columns.due} headers={headersR} onChange={(v) => setRC({ due: v })} />
        </SourceCard>

        <SourceCard
          step={2}
          title="Extração do sistema"
          hint="Escolher a extração (SAP, Em aberto do ERP...)"
          source={sap}
          error={sapError}
          onFile={openSap}
          onTable={(i) => sap && setSap({ ...sap, tableIndex: i, columns: guessSapColumns(sap.tables[i].headers) })}
        >
          <ColumnSelect label="Referência / Nº NF" required value={sap?.columns.doc} headers={headersS} onChange={(v) => setSC({ doc: v ?? 0 })} />
          <ColumnSelect label="Outro nº (ex.: Nº documento)" value={sap?.columns.doc2} headers={headersS} onChange={(v) => setSC({ doc2: v })} />
          <ColumnSelect label="CNPJ / CPF" value={sap?.columns.taxId} headers={headersS} onChange={(v) => setSC({ taxId: v })} />
          <ColumnSelect label="Montante" value={sap?.columns.amount} headers={headersS} onChange={(v) => setSC({ amount: v })} />
          <ColumnSelect label="Vencimento" value={sap?.columns.due} headers={headersS} onChange={(v) => setSC({ due: v })} />
          <ColumnSelect label="Data de compensação" value={sap?.columns.clearingDate} headers={headersS} onChange={(v) => setSC({ clearingDate: v })} />
          <ColumnSelect label="Doc. compensação" value={sap?.columns.clearingDoc} headers={headersS} onChange={(v) => setSC({ clearingDoc: v })} />
        </SourceCard>
      </div>

      {sap && sap.columns.clearingDate === undefined && sap.columns.clearingDoc === undefined && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Sem coluna de compensação o app só diz se está lançado, não se já foi pago. Se a extração for do SAP (FBL1N), marque
          &quot;Partidas compensadas&quot; e inclua &quot;Data de compensação&quot; no layout antes de exportar.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((c) => (
              <button
                key={c.k}
                type="button"
                aria-pressed={filter === c.k}
                onClick={() => setFilter(filter === c.k ? "all" : c.k)}
                className={cx(
                  "rounded-xl border p-4 text-left transition-shadow hover:shadow-sm",
                  filter === c.k && "ring-2 ring-indigo-500",
                  c.tone === "red" && c.value > 0
                    ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                    : c.tone === "green"
                      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
                )}
              >
                <dt className="text-sm text-zinc-500 dark:text-zinc-400">{c.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</dd>
              </button>
            ))}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filtrar resultado" className={cx(inputCls, "w-auto")}>
              <option value="all">Todos os itens</option>
              <option value="not_posted">Não lançados</option>
              <option value="overdue_open">Vencidos em aberto</option>
              <option value="diff">Valor diferente</option>
              <option value="paid">Pagos</option>
            </select>
            {grouped && (
              <div role="group" aria-label="Visão" className="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
                {(
                  [
                    [true, "Por fatura"],
                    [false, "Por documento"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={byGroup === value}
                    onClick={() => setByGroup(value)}
                    className={cx(
                      "h-8 rounded-md px-3 text-sm font-medium",
                      byGroup === value ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <span className="text-xs text-zinc-500">
              {showGroups ? `${visibleGroups.length} de ${groups.length} faturas` : `${visible.length} de ${rows.length}`}
            </span>
            <span className="flex-1" />
            <button type="button" className={btnGhost} onClick={copyEmail}>
              {copied ? <Check className="size-4 text-emerald-500" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              Copiar resumo p/ e-mail
            </button>
            <button type="button" className={btnPrimary} onClick={download}>
              <Download className="size-4" aria-hidden />
              Baixar planilha
            </button>
          </div>

          {showGroups ? (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Fatura</th>
                    <th className="px-3 py-2.5 text-center font-medium">Docs</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total</th>
                    <th className="px-3 py-2.5 font-medium">Vencimento</th>
                    <th className="px-3 py-2.5 font-medium">Sistema</th>
                    <th className="px-3 py-2.5 font-medium">Pagamento</th>
                    <th className="px-3 py-2.5 font-medium">Não lançados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {visibleGroups.map((g) => (
                    <tr key={g.group}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{g.group}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{g.count}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(g.total)}</td>
                      <td className={cx("whitespace-nowrap px-3 py-2 tabular-nums", isLate(g) && "font-semibold text-red-600 dark:text-red-400")}>
                        {g.dueDate ? formatBR(g.dueDate) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cx(
                            "whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                            POSTED_BADGE[g.posted === "posted" ? (g.diffCount ? "posted_diff" : "posted") : g.posted === "partial" ? "posted_diff" : "not_posted"],
                          )}
                        >
                          {g.posted === "posted"
                            ? g.diffCount
                              ? "Lançada (valor diferente)"
                              : "Lançada"
                            : g.posted === "partial"
                              ? `Parcial (${g.postedCount} de ${g.count})`
                              : "Não lançada"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cx(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            PAYMENT_BADGE[g.payment === "partial" ? "open" : g.payment],
                          )}
                        >
                          {g.payment === "paid"
                            ? "Paga"
                            : g.payment === "partial"
                              ? `Parcial (${g.paidCount} de ${g.count} pagos)`
                              : g.payment === "open_overdue"
                                ? "Em aberto — vencida"
                                : g.payment === "open"
                                  ? "A vencer"
                                  : "—"}
                        </span>
                      </td>
                      <td className="max-w-xs px-3 py-2 text-xs text-zinc-500">
                        {g.rows
                          .filter((r) => r.posted === "not_posted")
                          .map((r) => r.doc)
                          .join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                <tr>
                  {grouped && <th className="px-3 py-2.5 font-medium">Fatura</th>}
                  <th className="px-3 py-2.5 font-medium">Documento</th>
                  <th className="px-3 py-2.5 font-medium">Fornecedor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 font-medium">Vencimento</th>
                  <th className="px-3 py-2.5 font-medium">Sistema</th>
                  <th className="px-3 py-2.5 font-medium">Pagamento</th>
                  <th className="px-3 py-2.5 font-medium">Observação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {visible.map((r) => (
                  <tr key={r.index}>
                    {grouped && <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{r.group ?? "—"}</td>}
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{r.doc}</td>
                    <td className="px-3 py-2">{r.supplier ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.amount !== undefined ? brl(Math.abs(r.amount)) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.dueDate ? formatBR(r.dueDate) : "—"}</td>
                    <td className="px-3 py-2">
                      <span className={cx("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", POSTED_BADGE[r.posted])}>
                        {POSTED_LABELS[r.posted]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", PAYMENT_BADGE[r.payment])}>
                        {paymentLabel(r, formatBR)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {r.note}
                      {r.posted === "posted_diff" && r.sapAmount !== undefined && ` (sistema: ${brl(Math.abs(r.sapAmount))})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          <details className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <summary className="cursor-pointer text-sm font-semibold">Prévia do resumo para o e-mail</summary>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-zinc-700 dark:text-zinc-300">{email}</pre>
          </details>
        </>
      )}

      {report && sap && rows.length === 0 && (
        <p className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
          Nenhum número de documento encontrado na coluna escolhida do relatório. Confira a coluna &quot;Nº da NF /
          documento&quot;.
        </p>
      )}
    </div>
  );
}
