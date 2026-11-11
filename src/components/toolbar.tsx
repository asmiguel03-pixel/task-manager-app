"use client";

import { Kanban, List, Search, X } from "lucide-react";
import {
  DEFAULT_FILTERS,
  DUE_FILTERS,
  DUE_FILTER_LABELS,
  type DueFilter,
  type StatusFilter,
  type TaskFilters,
} from "@/lib/task-domain";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  type Priority,
} from "@/lib/task-schema";
import { cx, inputCls } from "./ui";

export type View = "kanban" | "list";

export function Toolbar({
  filters,
  onChange,
  categories,
  view,
  onViewChange,
  searchRef,
  resultCount,
}: {
  filters: TaskFilters;
  onChange: (f: TaskFilters) => void;
  categories: string[];
  view: View;
  onViewChange: (v: View) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  resultCount: number;
}) {
  const set = (patch: Partial<TaskFilters>) => onChange({ ...filters, ...patch });
  const dirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const selectCls = cx(inputCls.replace("w-full ", ""), "min-w-0 flex-1 sm:flex-none");

  return (
    <section aria-label="Busca e filtros" className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div role="search" className="relative lg:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Buscar por título ou descrição…"
          aria-label="Buscar tarefas"
          aria-keyshortcuts="/"
          className={cx(inputCls, "pl-9")}
        />
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-2">
        <select
          aria-label="Filtrar por status"
          value={filters.status}
          onChange={(e) => set({ status: e.target.value as StatusFilter })}
          className={selectCls}
        >
          <option value="active">Status: ativas</option>
          <option value="all">Status: todas</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por prioridade"
          value={filters.priority}
          onChange={(e) => set({ priority: e.target.value as Priority | "all" })}
          className={selectCls}
        >
          <option value="all">Prioridade: todas</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por categoria"
          value={filters.category}
          onChange={(e) => set({ category: e.target.value })}
          className={selectCls}
        >
          <option value="all">Categoria: todas</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por prazo"
          value={filters.due}
          onChange={(e) => set({ due: e.target.value as DueFilter })}
          className={selectCls}
        >
          {DUE_FILTERS.map((d) => (
            <option key={d} value={d}>
              {DUE_FILTER_LABELS[d]}
            </option>
          ))}
        </select>
        {filters.due === "custom" && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label className="sr-only" htmlFor="due-from">
              Prazo a partir de
            </label>
            <input
              id="due-from"
              type="date"
              value={filters.dueFrom}
              max={filters.dueTo || undefined}
              onChange={(e) => set({ dueFrom: e.target.value })}
              className={cx(selectCls, "sm:w-40")}
            />
            <span className="text-sm text-zinc-500">até</span>
            <label className="sr-only" htmlFor="due-to">
              Prazo até
            </label>
            <input
              id="due-to"
              type="date"
              value={filters.dueTo}
              min={filters.dueFrom || undefined}
              onChange={(e) => set({ dueTo: e.target.value })}
              className={cx(selectCls, "sm:w-40")}
            />
          </div>
        )}
        {dirty && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <X className="size-3.5" aria-hidden />
            Limpar
          </button>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {resultCount} {resultCount === 1 ? "tarefa encontrada" : "tarefas encontradas"}
        </span>
      </div>

      <div
        role="group"
        aria-label="Modo de visualização"
        className="inline-flex self-start rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900 lg:self-auto"
      >
        {(
          [
            ["kanban", "Kanban", Kanban],
            ["list", "Lista", List],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => onViewChange(value)}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
              view === value
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
