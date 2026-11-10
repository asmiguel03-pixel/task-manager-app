"use client";

import { useId, useState } from "react";
import { FileCheck, TriangleAlert } from "lucide-react";
import { monthLabel } from "@/lib/payment-domain";
import { parsePaymentWorkbook, type ImportedMonth } from "@/lib/payment-import";
import { PAYMENT_SHEETS, SHEET_LABELS, type Payment, type PaymentInput, type PaymentSheet } from "@/lib/payment-schema";
import { readXlsx } from "@/lib/xlsx-read";
import { btnGhost, btnPrimary, cx, inputCls, Modal } from "./ui";

export function PaymentImportDialog({
  existing,
  defaultSheet,
  currentYear,
  onClose,
  onImport,
}: {
  existing: Payment[];
  defaultSheet: PaymentSheet;
  currentYear: number;
  onClose: () => void;
  onImport: (
    inputs: PaymentInput[],
    replace: { sheet: PaymentSheet; month: string }[],
    target: { sheet: PaymentSheet; month: string },
  ) => Promise<boolean>;
}) {
  const uid = useId();
  const [months, setMonths] = useState<ImportedMonth[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<PaymentSheet>(defaultSheet);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setMonths(null);
    setFileName(file.name);
    try {
      const found = parsePaymentWorkbook(await readXlsx(new Uint8Array(await file.arrayBuffer())), currentYear);
      if (!found.length) {
        setError("Não encontrei abas de mês com a coluna \"Fornecedor\" nessa planilha.");
        return;
      }
      setMonths(found);
      // Por padrão: os dois meses mais recentes.
      setSelected(new Set(found.slice(0, 2).map((m) => m.month)));
      const votes = found.filter((m) => m.sheetGuess === "criticos").length;
      setSheet(votes > found.length / 2 ? "criticos" : "rh");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  };

  const toggle = (month: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });

  const chosen = (months ?? []).filter((m) => selected.has(m.month));
  const replacing = chosen
    .map((m) => ({ m, count: existing.filter((p) => p.sheet === sheet && p.month === m.month).length }))
    .filter((x) => x.count > 0);
  const warnings = chosen.flatMap((m) => m.warnings.map((w) => `${monthLabel(m.month)} — ${w}`));

  const confirm = async () => {
    if (!chosen.length) return;
    setBusy(true);
    const inputs: PaymentInput[] = chosen.flatMap((m) => m.rows.map((r) => ({ ...r, sheet })));
    const ok = await onImport(
      inputs,
      chosen.map((m) => ({ sheet, month: m.month })),
      { sheet, month: chosen[0].month },
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title="Importar planilha" onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
        <p className="text-zinc-600 dark:text-zinc-400">
          Escolha o arquivo .xlsx de controle. Cada aba de mês (ex.: &quot;11. Novembro&quot;) vira um mês no app,
          com fornecedor, filial, datas, valor, nº do título e status lidos das observações.
        </p>
        <label
          htmlFor={`${uid}-file`}
          className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-zinc-300 p-4 hover:border-indigo-400 dark:border-zinc-700"
        >
          <FileCheck className="size-6 shrink-0 text-emerald-600" aria-hidden />
          <span className="min-w-0 truncate">{fileName || "Clique para escolher a planilha (.xlsx)"}</span>
          <input
            id={`${uid}-file`}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}

        {months && (
          <>
            <div>
              <label htmlFor={`${uid}-sheet`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Importar para
              </label>
              <select
                id={`${uid}-sheet`}
                value={sheet}
                onChange={(e) => setSheet(e.target.value as PaymentSheet)}
                className={inputCls}
              >
                {PAYMENT_SHEETS.map((s) => (
                  <option key={s} value={s}>
                    {SHEET_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Meses encontrados</legend>
              <ul className="max-h-56 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {months.map((m) => (
                  <li key={m.month}>
                    <label className="flex items-center gap-3 px-3 py-2">
                      <input type="checkbox" checked={selected.has(m.month)} onChange={() => toggle(m.month)} />
                      <span className="font-medium">{monthLabel(m.month)}</span>
                      <span className="text-xs text-zinc-500">aba &quot;{m.tab}&quot;</span>
                      <span className="ml-auto text-xs tabular-nums text-zinc-500">{m.rows.length} linhas</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {replacing.length > 0 && (
              <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Vai substituir o que já existe no app em:{" "}
                  {replacing.map((x) => `${monthLabel(x.m.month)} (${x.count} lançamentos)`).join(", ")}.
                </span>
              </p>
            )}
            {warnings.length > 0 && (
              <details className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800/60">
                <summary className="cursor-pointer text-xs font-medium">
                  {warnings.length} valor(es) não reconhecido(s) — guardados nas observações
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
      <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
        <button type="button" onClick={onClose} className={btnGhost}>
          Cancelar
        </button>
        <button type="button" onClick={confirm} disabled={!chosen.length || busy} className={cx(btnPrimary)}>
          {busy ? "Importando…" : `Importar ${chosen.length || ""} ${chosen.length === 1 ? "mês" : "meses"}`}
        </button>
      </footer>
    </Modal>
  );
}
