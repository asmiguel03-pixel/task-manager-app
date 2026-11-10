"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Calculator,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  FileCheck,
  Landmark,
  Link,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { newId, todayISO } from "@/lib/task-domain";
import {
  addBusinessDays,
  businessDaysBetween,
  evaluateExpression,
  formatBoletoLine,
  formatBR,
  formatNumberBR,
  groupKey,
  parseAccessKey,
  parseBoleto,
  weekdayName,
} from "@/lib/work-tools";
import { btnGhost, cx, IconButton, inputCls } from "./ui";

const STORAGE = {
  notes: "task-manager:tools:notes",
  links: "task-manager:tools:links",
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const labelCls = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";
const smallBtn = cx(btnGhost, "h-8 px-2.5 text-xs");

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
    >
      {done ? <Check className="size-4 text-emerald-500" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </IconButton>
  );
}

function Section({
  title,
  Icon,
  defaultOpen,
  children,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <Icon className="size-4 text-indigo-600 dark:text-indigo-400" />
        {title}
        <span className="ml-auto text-zinc-400 transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
      </summary>
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">{children}</div>
    </details>
  );
}

// ---------- Bloco de notas ----------

function NotesTool() {
  const [text, setText] = useState("");
  useEffect(() => setText(load(STORAGE.notes, "")), []);
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          save(STORAGE.notes, e.target.value);
        }}
        rows={6}
        placeholder="Anotações rápidas… (salvas só neste aparelho)"
        aria-label="Bloco de notas"
        className={cx(inputCls, "h-auto resize-y py-2")}
      />
      <p className="mt-1 text-xs text-zinc-500">Salvo automaticamente neste aparelho.</p>
    </div>
  );
}

// ---------- Calculadora ----------

function CalculatorTool() {
  const [expr, setExpr] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<{ expr: string; result: string }[]>([]);

  const run = () => {
    try {
      const result = formatNumberBR(evaluateExpression(expr));
      setHistory((h) => [{ expr, result }, ...h].slice(0, 5));
      setExpr(result.replace(/\./g, ""));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="flex gap-2"
      >
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder="Ex.: 1250,50 * 3"
          aria-label="Conta"
          aria-invalid={!!error}
          className={cx(inputCls, "font-mono")}
        />
        <button type="submit" className={cx(smallBtn, "h-9 px-3 text-sm")}>
          =
        </button>
      </form>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {history.length > 0 && (
        <ul className="space-y-1 text-sm">
          {history.map((h, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md bg-zinc-50 px-2 py-1 dark:bg-zinc-800/60">
              <span className="truncate font-mono text-xs text-zinc-500">{h.expr} =</span>
              <span className="ml-auto font-mono font-semibold tabular-nums">{h.result}</span>
              <CopyButton text={h.result} label="Copiar resultado" />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-500">Use vírgula para decimais. % depois de um número divide por 100.</p>
    </div>
  );
}

// ---------- Dias úteis ----------

function BusinessDaysTool() {
  const uid = useId();
  const [mode, setMode] = useState<"add" | "between">("add");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [days, setDays] = useState("5");
  const [optional, setOptional] = useState(false);

  useEffect(() => {
    setStart(todayISO());
    setEnd(todayISO());
  }, []);

  const n = Number(days);
  const added = mode === "add" && start && Number.isInteger(n) ? addBusinessDays(start, n, optional) : null;
  const between = mode === "between" && start && end ? businessDaysBetween(start, end, optional) : null;

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Tipo de cálculo" className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-0.5 text-xs dark:bg-zinc-800">
        {(
          [
            ["add", "Somar dias úteis"],
            ["between", "Contar entre datas"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cx(
              "rounded-md px-2 py-1.5 font-medium",
              mode === value ? "bg-white shadow-sm dark:bg-zinc-900" : "text-zinc-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${uid}-start`} className={labelCls}>
            {mode === "add" ? "A partir de" : "De"}
          </label>
          <input id={`${uid}-start`} type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        </div>
        {mode === "add" ? (
          <div>
            <label htmlFor={`${uid}-days`} className={labelCls}>
              Dias úteis (− volta)
            </label>
            <input
              id={`${uid}-days`}
              type="number"
              step={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={inputCls}
            />
          </div>
        ) : (
          <div>
            <label htmlFor={`${uid}-end`} className={labelCls}>
              Até
            </label>
            <input id={`${uid}-end`} type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} />
        Não trabalhar no Carnaval e em Corpus Christi
      </label>

      <div className="rounded-lg bg-indigo-50 p-3 text-sm dark:bg-indigo-950/40" aria-live="polite">
        {mode === "add" &&
          (added ? (
            <>
              <p className="font-semibold">
                {formatBR(added.date)} <span className="font-normal text-zinc-500">({weekdayName(added.date)})</span>
              </p>
              {added.skipped.length > 0 && (
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Feriados pulados: {added.skipped.map((h) => `${formatBR(h.date)} ${h.name}`).join("; ")}
                </p>
              )}
            </>
          ) : (
            <p className="text-zinc-500">Informe uma data e um número inteiro de dias.</p>
          ))}
        {mode === "between" &&
          (between !== null ? (
            <p className="font-semibold">
              {Math.abs(between)} {Math.abs(between) === 1 ? "dia útil" : "dias úteis"}
              {between < 0 && <span className="font-normal text-zinc-500"> (datas invertidas)</span>}
            </p>
          ) : (
            <p className="text-zinc-500">Informe as duas datas.</p>
          ))}
      </div>
      <p className="text-xs text-zinc-500">
        Considera fins de semana e feriados nacionais. Feriados estaduais e municipais não entram.
      </p>
    </div>
  );
}

// ---------- Chave de acesso NF-e / CT-e ----------

function AccessKeyTool() {
  const [raw, setRaw] = useState("");
  const result = raw.trim() ? parseAccessKey(raw) : null;
  const rows: [string, string | number][] =
    result && result.ok
      ? [
          ["Documento", result.model],
          ["UF", result.uf],
          ["Emissão (mês)", result.month],
          ["CNPJ emitente", result.cnpj],
          ["Série", result.series],
          ["Número", result.number],
          ["Tipo de emissão", result.emission],
        ]
      : [];

  return (
    <div className="space-y-2">
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={2}
        inputMode="numeric"
        placeholder="Cole a chave de 44 dígitos"
        aria-label="Chave de acesso"
        aria-invalid={result ? !result.ok : undefined}
        className={cx(inputCls, "h-auto resize-none py-2 font-mono text-xs")}
      />
      {result && !result.ok && <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>}
      {result && result.ok && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
          <p className="mb-2 flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
            <Check className="size-4" aria-hidden /> Chave válida
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 flex items-center gap-1">
            <span className="truncate font-mono text-[11px] text-zinc-500">{groupKey(result.digits)}</span>
            <CopyButton text={result.digits} label="Copiar chave só com números" />
          </div>
        </div>
      )}
      <p className="text-xs text-zinc-500">Funciona para NF-e, NFC-e, CT-e e MDF-e. Não consulta a SEFAZ.</p>
    </div>
  );
}

// ---------- Boleto ----------

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function daysFromToday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

function dueLabel(iso: string) {
  const diff = daysFromToday(iso);
  if (diff === 0) return { text: "vence hoje", tone: "text-amber-600 dark:text-amber-400" };
  if (diff > 0) return { text: `vence em ${diff} ${diff === 1 ? "dia" : "dias"}`, tone: "text-emerald-600 dark:text-emerald-400" };
  return { text: `vencido há ${-diff} ${diff === -1 ? "dia" : "dias"}`, tone: "text-red-600 dark:text-red-400" };
}

function BoletoTool() {
  const [raw, setRaw] = useState("");
  const result = raw.trim() ? parseBoleto(raw, todayISO()) : null;

  return (
    <div className="space-y-2">
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={2}
        inputMode="numeric"
        placeholder="Cole a linha digitável ou o código de barras"
        aria-label="Linha digitável do boleto"
        aria-invalid={result ? !result.ok : undefined}
        className={cx(inputCls, "h-auto resize-none py-2 font-mono text-xs")}
      />
      {result && !result.ok && <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>}
      {result && result.ok && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
          <p className="mb-2 flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
            <Check className="size-4" aria-hidden /> Código válido
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-zinc-500">Tipo</dt>
            <dd className="font-medium">{result.kind === "bancario" ? "Boleto bancário" : "Conta / tributo (arrecadação)"}</dd>
            <dt className="text-zinc-500">{result.kind === "bancario" ? "Banco" : "Segmento"}</dt>
            <dd className="font-medium">{result.kind === "bancario" ? result.bank : result.segment}</dd>
            <dt className="text-zinc-500">Valor</dt>
            <dd className="font-medium">{result.amount !== null ? brl(result.amount) : "não informado no código"}</dd>
            {result.kind === "bancario" && (
              <>
                <dt className="text-zinc-500">Vencimento</dt>
                <dd className="font-medium">
                  {result.dueDate ? (
                    <>
                      {formatBR(result.dueDate)}{" "}
                      <span className={dueLabel(result.dueDate).tone}>({dueLabel(result.dueDate).text})</span>
                    </>
                  ) : (
                    "sem vencimento no código"
                  )}
                </dd>
              </>
            )}
          </dl>
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500">{formatBoletoLine(result.line)}</span>
              <CopyButton text={result.line} label="Copiar linha digitável" />
            </div>
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500">Barras: {result.barcode}</span>
              <CopyButton text={result.barcode} label="Copiar código de barras" />
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Confere os dígitos e lê banco, valor e vencimento gravados no código. Não consulta o banco: não confirma se o
        boleto está registrado ou já foi pago — isso só no internet banking/DDA. Confira sempre o beneficiário na hora de
        pagar.
      </p>
    </div>
  );
}

// ---------- Links úteis ----------

interface SavedLink {
  id: string;
  label: string;
  url: string;
}

const normalizeUrl = (u: string) => {
  const t = u.trim();
  if (!t) return "";
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const parsed = new URL(withProto);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
};

function LinksTool() {
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setLinks(load<SavedLink[]>(STORAGE.links, [])), []);

  const update = (next: SavedLink[]) => {
    setLinks(next);
    save(STORAGE.links, next);
  };

  const add = () => {
    const clean = normalizeUrl(url);
    if (!clean) {
      setError("Endereço inválido.");
      return;
    }
    const name = label.trim() || new URL(clean).hostname.replace(/^www\./, "");
    update([...links, { id: newId(), label: name.slice(0, 40), url: clean }]);
    setLabel("");
    setUrl("");
    setError("");
  };

  return (
    <div className="space-y-2">
      {links.length > 0 ? (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-1">
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <ExternalLink className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                <span className="truncate">{l.label}</span>
              </a>
              <IconButton label={`Remover ${l.label}`} onClick={() => update(links.filter((x) => x.id !== l.id))}>
                <Trash2 className="size-3.5" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-500">Nenhum link ainda. Adicione os sistemas que você mais usa.</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="space-y-2 border-t border-zinc-200 pt-2 dark:border-zinc-800"
      >
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nome (ex.: SIEG)"
          aria-label="Nome do link"
          maxLength={40}
          className={inputCls}
        />
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Endereço (ex.: hub.sieg.com)"
            aria-label="Endereço do link"
            aria-invalid={!!error}
            inputMode="url"
            className={inputCls}
          />
          <button type="submit" className={cx(smallBtn, "h-9")} aria-label="Adicionar link">
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </form>
      <p className="text-xs text-zinc-500">Salvos só neste aparelho.</p>
    </div>
  );
}

// ---------- Gaveta ----------

export function ToolsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ferramentas"
        className="absolute inset-y-0 left-0 flex w-[22rem] max-w-[90vw] flex-col bg-zinc-50 shadow-2xl dark:bg-zinc-950"
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-base font-semibold">Ferramentas</h2>
          <IconButton label="Fechar ferramentas" onClick={onClose} className="size-8">
            <X className="size-4.5" aria-hidden />
          </IconButton>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          <Section title="Bloco de notas" Icon={StickyNote} defaultOpen>
            <NotesTool />
          </Section>
          <Section title="Calculadora" Icon={Calculator}>
            <CalculatorTool />
          </Section>
          <Section title="Prazo em dias úteis" Icon={CalendarDays}>
            <BusinessDaysTool />
          </Section>
          <Section title="Validar chave NF-e / CT-e" Icon={FileCheck}>
            <AccessKeyTool />
          </Section>
          <Section title="Verificar boleto" Icon={Landmark}>
            <BoletoTool />
          </Section>
          <Section title="Links úteis" Icon={Link}>
            <LinksTool />
          </Section>
        </div>
      </aside>
    </div>
  );
}
