"use client";

import { useId, useState } from "react";
import { CircleCheck, Download, FileCheck, List, Lock, Trash2 } from "lucide-react";
import { exportStatementsXlsx } from "@/lib/bank-export";
import { readStatementPdf, type Statement } from "@/lib/bank-statement";
import { formatBR } from "@/lib/work-tools";
import { downloadBytes, Warnings } from "./bank-reconcile-view";
import { btnGhost, btnPrimary, cx } from "./ui";

const brl = (n: number | undefined) =>
  n === undefined ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Item =
  | { id: number; fileName: string; status: "loading" }
  | { id: number; fileName: string; status: "ok"; data: Statement }
  | { id: number; fileName: string; status: "error"; error: string };

type Loaded = Extract<Item, { status: "ok" }>;

const fileBase = (st: Statement) => `${st.bank}${st.period ? ` ${st.period.replace(/\//g, "-")}` : ""}`;
const sum = (st: Statement, sign: 1 | -1) =>
  Math.round(st.entries.reduce((s, e) => s + Math.max(sign * e.amount, 0), 0) * 100) / 100;

let nextId = 1;

export function StatementConvertView({ toast }: { toast: (message: string, kind?: "success" | "info" | "error") => void }) {
  const uid = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = async (files: File[]) => {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
    if (pdfs.length < files.length) toast("Só arquivos PDF são convertidos; os outros foram ignorados.", "info");
    if (!pdfs.length) return;
    const added = pdfs.map((f) => ({ id: nextId++, fileName: f.name, status: "loading" as const }));
    setItems((cur) => [...cur, ...added]);
    await Promise.all(
      pdfs.map(async (file, i) => {
        const id = added[i].id;
        let next: Item;
        try {
          next = { id, fileName: file.name, status: "ok", data: await readStatementPdf(file) };
        } catch (e) {
          next = { id, fileName: file.name, status: "error", error: e instanceof Error ? e.message : "Não foi possível ler o extrato." };
        }
        setItems((cur) => cur.map((it) => (it.id === id ? next : it)));
        if (next.status === "ok") setPreviewId((p) => p ?? id);
      }),
    );
  };

  const loaded = items.filter((it): it is Loaded => it.status === "ok");
  const preview = loaded.find((it) => it.id === previewId) ?? loaded[0];

  const download = (list: Loaded[]) => {
    if (!list.length) return;
    const name = list.length === 1 ? `Extrato ${fileBase(list[0].data)}.xlsx` : `Extratos (${list.length}).xlsx`;
    downloadBytes(exportStatementsXlsx(list), name);
    toast(list.length === 1 ? "Extrato em Excel baixado" : `${list.length} extratos baixados em um Excel`, "success");
  };

  const remove = (id: number) => {
    setItems((cur) => cur.filter((it) => it.id !== id));
    if (previewId === id) setPreviewId(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        Suba um ou mais extratos em PDF (Bradesco, Banco do Brasil, Santander, Caixa e outros) e baixe em Excel com
        Data, Histórico, Documento, Entrada, Saída e Saldo. Os arquivos são lidos só no seu navegador — nada é enviado nem salvo.
      </p>

      <label
        htmlFor={`${uid}-pdf`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles([...e.dataTransfer.files]);
        }}
        className={cx(
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm transition-colors",
          dragging
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
            : "border-zinc-300 hover:border-indigo-400 dark:border-zinc-700",
        )}
      >
        <FileCheck className="size-7 text-emerald-600" aria-hidden />
        <span className="font-medium">Escolher extratos em PDF</span>
        <span className="text-xs text-zinc-500">ou arraste os arquivos para cá — pode mandar vários de uma vez</span>
        <input
          id={`${uid}-pdf`}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void addFiles(files);
          }}
        />
      </label>

      {items.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {loaded.length} de {items.length} extrato(s) lido(s)
            </h3>
            <div className="flex flex-wrap gap-2">
              {loaded.length > 1 && (
                <button type="button" className={btnPrimary} onClick={() => download(loaded)}>
                  <Download className="size-4" aria-hidden />
                  Baixar todos em um Excel
                </button>
              )}
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  setItems([]);
                  setPreviewId(null);
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                Limpar
              </button>
            </div>
          </div>

          <ul className="grid gap-3 lg:grid-cols-2">
            {items.map((it) => (
              <li
                key={it.id}
                className={cx(
                  "flex flex-col gap-2 rounded-xl border bg-white p-4 dark:bg-zinc-900",
                  it.status === "ok" && preview?.id === it.id
                    ? "border-indigo-400 dark:border-indigo-500"
                    : "border-zinc-200 dark:border-zinc-800",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium" title={it.fileName}>
                    {it.fileName}
                  </p>
                  <button
                    type="button"
                    aria-label={`Remover ${it.fileName}`}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                    onClick={() => remove(it.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>

                {it.status === "loading" && <p className="text-sm text-zinc-500">Lendo o PDF…</p>}
                {it.status === "error" && <p className="text-sm text-red-600 dark:text-red-400">{it.error}</p>}
                {it.status === "ok" && (
                  <>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <dt className="text-zinc-500">Banco</dt>
                      <dd className="font-medium">{it.data.bank}</dd>
                      {it.data.account && (
                        <>
                          <dt className="text-zinc-500">Conta</dt>
                          <dd className="font-medium">{it.data.account}</dd>
                        </>
                      )}
                      {it.data.period && (
                        <>
                          <dt className="text-zinc-500">Período</dt>
                          <dd className="font-medium">{it.data.period}</dd>
                        </>
                      )}
                      <dt className="text-zinc-500">Saldo inicial</dt>
                      <dd className="font-medium tabular-nums">{brl(it.data.opening)}</dd>
                      <dt className="text-zinc-500">Entradas</dt>
                      <dd className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{brl(sum(it.data, 1))}</dd>
                      <dt className="text-zinc-500">Saídas</dt>
                      <dd className="font-medium tabular-nums text-red-700 dark:text-red-400">{brl(sum(it.data, -1))}</dd>
                      <dt className="text-zinc-500">Saldo final</dt>
                      <dd className="font-medium tabular-nums">{brl(it.data.closing)}</dd>
                      <dt className="text-zinc-500">Lançamentos</dt>
                      <dd className="font-medium">{it.data.entries.length}</dd>
                    </dl>
                    {!it.data.warnings.length && (
                      <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                        <CircleCheck className="size-3.5" aria-hidden />
                        Saldo inicial + lançamentos = saldo final. Leitura conferida.
                      </p>
                    )}
                    <Warnings list={it.data.warnings} />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnGhost} onClick={() => download([it])}>
                        <Download className="size-4" aria-hidden />
                        Baixar em Excel
                      </button>
                      <button
                        type="button"
                        className={btnGhost}
                        aria-pressed={preview?.id === it.id}
                        onClick={() => setPreviewId(it.id)}
                      >
                        <List className="size-4" aria-hidden />
                        Ver lançamentos
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Lançamentos — {preview.data.bank}
            {preview.data.period ? ` · ${preview.data.period}` : ""}
          </h3>
          <div className="max-h-[32rem] overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-100 text-left text-xs uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Histórico</th>
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2 text-right">Entrada</th>
                  <th className="px-3 py-2 text-right">Saída</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {preview.data.entries.map((e, i) => (
                  <tr key={i} className="bg-white dark:bg-zinc-900">
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{formatBR(e.date)}</td>
                    <td className="px-3 py-1.5">{e.description}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{e.doc ?? ""}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                      {e.amount > 0 ? brl(e.amount) : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-red-700 dark:text-red-400">
                      {e.amount < 0 ? brl(-e.amount) : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{e.balance !== undefined ? brl(e.balance) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
