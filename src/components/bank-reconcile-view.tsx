"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CircleCheck, Download, FileCheck, Lock, TriangleAlert } from "lucide-react";
import { exportBankXlsx, type CapaInfo } from "@/lib/bank-export";
import {
  bestLedgerTable,
  guessLedgerColumns,
  ledgerForPeriod,
  statementRange,
  ledgerFromPdfLines,
  ledgerFromTable,
  reconcileBank,
  reconSummary,
  type Ledger,
  type LedgerColumns,
} from "@/lib/bank-reconcile";
import { parseStatement, type Statement } from "@/lib/bank-statement";
import { readPdfText, toLines } from "@/lib/pdf-text";
import type { Table } from "@/lib/reconcile";
import { formatBR } from "@/lib/work-tools";
import { XLSX_MIME } from "@/lib/xlsx";
import { ColumnSelect, loadTables } from "./reconcile-view";
import { btnGhost, btnPrimary, cx, inputCls } from "./ui";

const brl = (n: number | undefined) =>
  n === undefined ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function downloadBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DropZone({ id, label, accept, onFile }: { id: string; label: string; accept: string; onFile: (f: File) => void }) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-zinc-300 p-3 text-sm hover:border-indigo-400 dark:border-zinc-700"
    >
      <FileCheck className="size-5 shrink-0 text-emerald-600" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

const CAPA_KEY = "task-manager:bank-capa";

function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <ul className="space-y-1">
      {list.map((w, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {w}
        </li>
      ))}
    </ul>
  );
}

export function BankReconcileView({ toast }: { toast: (message: string, kind?: "success" | "info" | "error") => void }) {
  const uid = useId();
  const [statement, setStatement] = useState<{ fileName: string; data: Statement } | null>(null);
  const [statementError, setStatementError] = useState("");
  const [ledgerFile, setLedgerFile] = useState<
    | { fileName: string; kind: "pdf"; ledger: Ledger }
    | { fileName: string; kind: "table"; tables: Table[]; tableIndex: number; columns: LedgerColumns }
    | null
  >(null);
  const [ledgerError, setLedgerError] = useState("");
  const [windowDays, setWindowDays] = useState(3);
  const [showMatched, setShowMatched] = useState(false);
  // Dados da capa (empresa e quem assina), lembrados neste navegador.
  const [capa, setCapa] = useState<CapaInfo>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CAPA_KEY);
      if (raw) setCapa(JSON.parse(raw) as CapaInfo);
    } catch {
      /* sem armazenamento: segue sem os dados */
    }
  }, []);
  const updateCapa = (patch: Partial<CapaInfo>) => {
    const next = { ...capa, ...patch };
    setCapa(next);
    try {
      localStorage.setItem(CAPA_KEY, JSON.stringify(next));
    } catch {
      /* ignora */
    }
  };

  const openStatement = async (file: File) => {
    setStatementError("");
    try {
      if (!/\.pdf$/i.test(file.name)) throw new Error("Por enquanto o extrato precisa ser o PDF do banco.");
      const lines = toLines(await readPdfText(new Uint8Array(await file.arrayBuffer())));
      if (!lines.length) throw new Error("Não consegui ler texto nesse PDF (pode ser imagem escaneada).");
      const data = parseStatement(lines);
      if (!data.entries.length) throw new Error("Não encontrei lançamentos nesse extrato. Me mande este modelo para eu incluir.");
      setStatement({ fileName: file.name, data });
    } catch (e) {
      setStatement(null);
      setStatementError(e instanceof Error ? e.message : "Não foi possível ler o extrato.");
    }
  };

  const openLedger = async (file: File) => {
    setLedgerError("");
    try {
      if (/\.pdf$/i.test(file.name)) {
        const ledger = ledgerFromPdfLines(toLines(await readPdfText(new Uint8Array(await file.arrayBuffer()))));
        if (!ledger.entries.length) throw new Error(ledger.warnings[0] ?? "Não encontrei lançamentos no razão em PDF. Tente exportar em Excel.");
        setLedgerFile({ fileName: file.name, kind: "pdf", ledger });
      } else {
        const tables = await loadTables(file);
        const tableIndex = bestLedgerTable(tables);
        setLedgerFile({ fileName: file.name, kind: "table", tables, tableIndex, columns: guessLedgerColumns(tables[tableIndex].headers) });
      }
    } catch (e) {
      setLedgerFile(null);
      setLedgerError(e instanceof Error ? e.message : "Não foi possível ler o razão.");
    }
  };

  const fullLedger: Ledger | undefined = useMemo(() => {
    if (!ledgerFile) return undefined;
    if (ledgerFile.kind === "pdf") return ledgerFile.ledger;
    return ledgerFromTable(ledgerFile.tables[ledgerFile.tableIndex], ledgerFile.columns);
  }, [ledgerFile]);

  const st = statement?.data;
  // Usa do razão só o período do extrato (o razão costuma vir com meses anteriores).
  const range = useMemo(() => (st ? statementRange(st.period, st.entries.map((e) => e.date)) : undefined), [st]);
  const periodLedger = useMemo(
    () => (fullLedger && range ? ledgerForPeriod(fullLedger, range) : undefined),
    [fullLedger, range],
  );
  const ledger: Ledger | undefined = periodLedger ?? fullLedger;
  const outside = periodLedger ? periodLedger.cut.before + periodLedger.cut.after : 0;
  const br = (iso: string) => iso.split("-").reverse().join("/");
  const ledgerSpan = fullLedger?.entries.length
    ? [br(fullLedger.entries.map((e) => e.date).sort()[0]), br(fullLedger.entries.map((e) => e.date).sort().at(-1)!)]
    : undefined;
  const ledgerOffPeriod = !!periodLedger && !periodLedger.entries.length && !!fullLedger?.entries.length;
  const result = useMemo(
    () => (st && ledger ? reconcileBank(st.entries, ledger.entries, windowDays) : undefined),
    [st, ledger, windowDays],
  );
  const summary = st && ledger && result ? reconSummary(st, ledger, st.entries, ledger.entries, result) : undefined;
  const explained = summary?.unexplained !== undefined && Math.abs(summary.unexplained) < 0.005;
  const pending = result ? result.onlyStatement.length + result.onlyLedger.length : 0;
  const conciliated = explained && pending === 0;

  const fileBase = st ? `${st.bank}${st.period ? ` ${st.period.replace(/\//g, "-")}` : ""}` : "extrato";
  const downloadStatement = () => {
    if (!st) return;
    downloadBytes(exportBankXlsx(st), `Extrato ${fileBase}.xlsx`);
    toast("Extrato em Excel baixado", "success");
  };
  const downloadRecon = () => {
    if (!st || !ledger || !result || !summary) return;
    downloadBytes(exportBankXlsx(st, ledger, result, summary, capa, range?.[1]), `Conciliacao ${fileBase}.xlsx`);
    toast("Conciliação baixada", "success");
  };

  const tableHeaders = ledgerFile?.kind === "table" ? ledgerFile.tables[ledgerFile.tableIndex].headers : [];
  const setCols = (patch: Partial<LedgerColumns>) =>
    ledgerFile?.kind === "table" && setLedgerFile({ ...ledgerFile, columns: { ...ledgerFile.columns, ...patch } });

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        Suba o extrato em PDF e o razão da conta banco. O app lê o extrato, cruza com o razão por valor e data e monta a
        conciliação. Os arquivos são lidos só no seu navegador — nada é enviado nem salvo.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">1</span>
            Extrato do banco (PDF)
          </h3>
          <DropZone id={`${uid}-st`} label={statement?.fileName || "Escolher o extrato em PDF"} accept=".pdf" onFile={openStatement} />
          {statementError && <p className="text-sm text-red-600 dark:text-red-400">{statementError}</p>}
          {st && (
            <>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-zinc-500">Banco</dt>
                <dd className="font-medium">{st.bank}</dd>
                {st.account && (
                  <>
                    <dt className="text-zinc-500">Conta</dt>
                    <dd className="font-medium">{st.account}</dd>
                  </>
                )}
                {st.period && (
                  <>
                    <dt className="text-zinc-500">Período</dt>
                    <dd className="font-medium">{st.period}</dd>
                  </>
                )}
                <dt className="text-zinc-500">Saldo inicial</dt>
                <dd className="font-medium tabular-nums">{brl(st.opening)}</dd>
                <dt className="text-zinc-500">Saldo final</dt>
                <dd className="font-medium tabular-nums">{brl(st.closing)}</dd>
                <dt className="text-zinc-500">Lançamentos</dt>
                <dd className="font-medium">{st.entries.length}</dd>
              </dl>
              {!st.warnings.length && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                  <CircleCheck className="size-3.5" aria-hidden />
                  Saldo inicial + lançamentos = saldo final. Leitura conferida.
                </p>
              )}
              <Warnings list={st.warnings} />
              <button type="button" className={cx(btnGhost, "self-start")} onClick={downloadStatement}>
                <Download className="size-4" aria-hidden />
                Baixar extrato em Excel
              </button>
            </>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">2</span>
            Razão da conta banco (Contmatic)
          </h3>
          <DropZone
            id={`${uid}-lg`}
            label={ledgerFile?.fileName || "Escolher o razão (Excel, CSV ou PDF)"}
            accept=".xlsx,.csv,.txt,.pdf"
            onFile={openLedger}
          />
          {ledgerError && <p className="text-sm text-red-600 dark:text-red-400">{ledgerError}</p>}
          {ledgerFile?.kind === "table" && (
            <div className="grid grid-cols-2 gap-2">
              {ledgerFile.tables.length > 1 && (
                <select
                  aria-label="Aba da planilha"
                  value={ledgerFile.tableIndex}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setLedgerFile({ ...ledgerFile, tableIndex: i, columns: guessLedgerColumns(ledgerFile.tables[i].headers) });
                  }}
                  className={cx(inputCls, "col-span-2")}
                >
                  {ledgerFile.tables.map((t, i) => (
                    <option key={i} value={i}>
                      Aba: {t.name}
                    </option>
                  ))}
                </select>
              )}
              <ColumnSelect label="Data" required value={ledgerFile.columns.date} headers={tableHeaders} onChange={(v) => setCols({ date: v ?? 0 })} />
              <ColumnSelect label="Histórico" value={ledgerFile.columns.description} headers={tableHeaders} onChange={(v) => setCols({ description: v })} />
              <ColumnSelect label="Débito (entrada)" value={ledgerFile.columns.debit} headers={tableHeaders} onChange={(v) => setCols({ debit: v })} />
              <ColumnSelect label="Crédito (saída)" value={ledgerFile.columns.credit} headers={tableHeaders} onChange={(v) => setCols({ credit: v })} />
              <ColumnSelect label="Saldo" value={ledgerFile.columns.balance} headers={tableHeaders} onChange={(v) => setCols({ balance: v })} />
              <ColumnSelect label="Documento / lote" value={ledgerFile.columns.doc} headers={tableHeaders} onChange={(v) => setCols({ doc: v })} />
            </div>
          )}
          {ledger && (
            <>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-zinc-500">Saldo inicial</dt>
                <dd className="font-medium tabular-nums">{brl(ledger.opening)}</dd>
                <dt className="text-zinc-500">Saldo final</dt>
                <dd className="font-medium tabular-nums">{brl(ledger.closing)}</dd>
                <dt className="text-zinc-500">Lançamentos</dt>
                <dd className="font-medium">{ledger.entries.length}</dd>
              </dl>
              {ledgerSpan && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Datas no razão: {ledgerSpan[0]} a {ledgerSpan[1]}
                </p>
              )}
              {ledgerOffPeriod && (
                <Warnings
                  list={[
                    `Nenhum lançamento do razão cai no período do extrato (${st?.period ?? ""}). Confira se é o razão do mesmo mês ou se a aba escolhida é a certa.`,
                  ]}
                />
              )}
              {outside > 0 && !ledgerOffPeriod && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {outside} lançamento{outside > 1 ? "s" : ""} do razão fora do período do extrato não entra
                  {outside > 1 ? "m" : ""} na conciliação. Saldo inicial calculado no início do período.
                </p>
              )}
              <Warnings list={ledger.warnings} />
            </>
          )}
        </section>
      </div>

      {st && ledger && result && summary && !ledgerOffPeriod && (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Saldo no extrato", value: brl(summary.statementClosing), tone: "" },
              { label: "Saldo no razão", value: brl(summary.ledgerClosing), tone: "" },
              { label: "Diferença", value: brl(summary.difference), tone: "" },
              {
                label: conciliated ? "Conciliado ✓" : explained ? `Explicada por ${pending} pendência${pending > 1 ? "s" : ""}` : "Diferença não explicada",
                value: brl(summary.unexplained),
                tone: conciliated ? "green" : explained ? "amber" : "red",
              },
            ].map((c) => (
              <div
                key={c.label}
                className={cx(
                  "rounded-xl border p-4",
                  c.tone === "green"
                    ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                    : c.tone === "amber"
                      ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                    : c.tone === "red"
                      ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
                )}
              >
                <dt className="text-sm text-zinc-500 dark:text-zinc-400">{c.label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{c.value}</dd>
              </div>
            ))}
          </dl>
          {!explained && summary.unexplained !== undefined && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              A diferença não explicada costuma vir de saldo inicial diferente entre extrato e razão, ou de um lançamento
              com valor errado (aparece nas duas listas abaixo com valores parecidos).
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              Folga de datas
              <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className={cx(inputCls, "w-auto")}>
                {[0, 1, 2, 3, 5, 7].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "mesmo dia" : `até ${d} dia${d > 1 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-zinc-500">
              {result.matches.length} conciliações · {result.onlyStatement.length} só no extrato · {result.onlyLedger.length} só no razão
            </span>
            <span className="flex-1" />
            <button type="button" className={btnPrimary} onClick={downloadRecon}>
              <Download className="size-4" aria-hidden />
              Baixar conciliação
            </button>
          </div>

          <details className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <summary className="cursor-pointer font-medium">Dados da capa da conciliação</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["company", "Empresa"],
                  ["signer", "Quem assina"],
                  ["role", "Cargo"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-xs text-zinc-500">
                  {label}
                  <input
                    className={inputCls}
                    value={capa[key] ?? ""}
                    onChange={(e) => updateCapa({ [key]: e.target.value } as Partial<CapaInfo>)}
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">Ficam salvos só neste navegador e vão para a aba CAPA do arquivo baixado.</p>
          </details>

          <div className="grid gap-4 xl:grid-cols-2">
            {[
              {
                title: "No extrato e não no razão (falta lançar)",
                rows: result.onlyStatement.map((i) => st.entries[i]),
                hint: "Lançamentos do banco que a contabilidade ainda não registrou.",
              },
              {
                title: "No razão e não no extrato",
                rows: result.onlyLedger.map((i) => ledger.entries[i]),
                hint: "Lançado na contabilidade, mas não passou no banco (ou valor/data diferentes).",
              },
            ].map((block) => (
              <section key={block.title} className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <h3 className="text-sm font-semibold">
                    {block.title} <span className="text-zinc-500">({block.rows.length})</span>
                  </h3>
                  <p className="text-xs text-zinc-500">{block.hint}</p>
                </header>
                {block.rows.length === 0 ? (
                  <p className="flex items-center gap-1.5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                    <CircleCheck className="size-4" aria-hidden /> Nenhum
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {block.rows.map((e, i) => (
                        <tr key={i}>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-500">{formatBR(e.date)}</td>
                          <td className="px-3 py-2">{e.description}</td>
                          <td className={cx("whitespace-nowrap px-3 py-2 text-right tabular-nums", e.amount < 0 && "text-red-600 dark:text-red-400")}>
                            {brl(e.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))}
          </div>

          <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setShowMatched((v) => !v)}
              aria-expanded={showMatched}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
            >
              Conciliados ({result.matches.length})
              <span className="text-xs font-normal text-indigo-600 dark:text-indigo-400">{showMatched ? "Esconder" : "Mostrar"}</span>
            </button>
            {showMatched && (
              <table className="w-full border-t border-zinc-200 text-sm dark:border-zinc-800">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/60">
                  <tr>
                    <th className="px-3 py-2 font-medium">Extrato</th>
                    <th className="px-3 py-2 font-medium">Razão</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {result.matches.map((m, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-2">
                        {m.statement.map((si) => (
                          <p key={si}>
                            <span className="tabular-nums text-zinc-500">{formatBR(st.entries[si].date)}</span> {st.entries[si].description}
                            {m.statement.length > 1 && <span className="tabular-nums text-zinc-500"> ({brl(st.entries[si].amount)})</span>}
                          </p>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        {m.ledger.map((li) => (
                          <p key={li}>
                            <span className="tabular-nums text-zinc-500">{formatBR(ledger.entries[li].date)}</span> {ledger.entries[li].description}
                          </p>
                        ))}
                        {m.kind === "grupo" && <p className="text-xs text-sky-700 dark:text-sky-400">somados</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {brl(m.statement.reduce((s, si) => s + st.entries[si].amount, 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
