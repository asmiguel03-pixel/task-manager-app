"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, Plus, SearchX, X } from "lucide-react";
import { useTasks, type TaskActions } from "@/hooks/use-tasks";
import { useToasts } from "@/hooks/use-toasts";
import {
  computeMetrics,
  DEFAULT_FILTERS,
  filterTasks,
  listCategories,
  type SortState,
  type TaskFilters,
} from "@/lib/task-domain";
import { STATUS_LABELS, type Status, type Task, type TaskInput } from "@/lib/task-schema";
import { DashboardHeader } from "./dashboard-header";
import { KanbanBoard } from "./kanban-board";
import { TaskFormDialog } from "./task-form-dialog";
import { TaskList } from "./task-list";
import { Toaster } from "./toaster";
import { ThemeToggle } from "./theme-toggle";
import { Toolbar, type View } from "./toolbar";
import { btnGhost, btnPrimary, ConfirmDialog } from "./ui";

type FormState = { mode: "create"; status: Status } | { mode: "edit"; task: Task } | null;

const EMPTY_METRICS = { total: 0, pending: 0, done: 0, overdue: 0, completionRate: 0 };

export function TaskApp() {
  const { tasks, loading, error, notice, dismissError, createTask, updateTask, deleteTask, duplicateTask, toggleSubtask } =
    useTasks();
  const [view, setView] = useState<View>("kanban");
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState>({ key: "dueDate", dir: "asc" });
  const [form, setForm] = useState<FormState>(null);
  const [toDelete, setToDelete] = useState<Task | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { toasts, toast, dismiss } = useToasts();

  // Toda alteração passa por aqui para gerar o feedback visual adequado.
  const updateWithToast = async (id: string, patch: Partial<TaskInput>) => {
    const before = tasks.find((t) => t.id === id);
    const after = await updateTask(id, patch);
    if (!after) return undefined;
    if (before && before.status !== after.status) {
      toast(
        after.status === "archived"
          ? "Tarefa arquivada"
          : `Tarefa movida para “${STATUS_LABELS[after.status]}”`,
        after.status === "done" ? "success" : "info",
      );
    } else if (!patch.subtasks || Object.keys(patch).length > 1) {
      toast("Tarefa atualizada", "success");
    }
    return after;
  };

  // Durante o pré-render/carregamento não há tarefas nem "hoje" confiável.
  const metrics = useMemo(
    () => (loading ? EMPTY_METRICS : computeMetrics(tasks)),
    [tasks, loading],
  );
  const categories = useMemo(() => listCategories(tasks), [tasks]);
  const visible = useMemo(() => filterTasks(tasks, filters), [tasks, filters]);

  const columns: Status[] =
    filters.status === "active"
      ? ["todo", "in_progress", "done"]
      : filters.status === "all"
        ? ["todo", "in_progress", "done", "archived"]
        : [filters.status];

  // Atalhos: "N" nova tarefa, "/" foca a busca.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.closest("input, textarea, select, [contenteditable], dialog")) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setForm({ mode: "create", status: "todo" });
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const actions: TaskActions = {
    updateTask: updateWithToast,
    duplicateTask: async (task) => {
      const copy = await duplicateTask(task);
      if (copy) toast("Tarefa duplicada", "success");
      return copy;
    },
    toggleSubtask,
    onEdit: (task) => setForm({ mode: "edit", task }),
    onDelete: setToDelete,
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:py-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <ListChecks className="size-5" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Tarefas</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            className={btnPrimary}
            aria-keyshortcuts="N"
            onClick={() => setForm({ mode: "create", status: "todo" })}
          >
            <Plus className="size-4" aria-hidden />
            Nova tarefa
            <kbd className="hidden rounded bg-white/20 px-1.5 text-xs font-normal sm:inline">N</kbd>
          </button>
        </div>
      </header>

      <DashboardHeader metrics={metrics} />

      <Toolbar
        filters={filters}
        onChange={setFilters}
        categories={categories}
        view={view}
        onViewChange={setView}
        searchRef={searchRef}
        resultCount={visible.length}
      />

      <Toaster toasts={toasts} onDismiss={dismiss} />

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {notice}
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
          <button type="button" onClick={dismissError} aria-label="Dispensar aviso" className="rounded p-1">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      <main className="flex-1">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-3" aria-busy="true" aria-label="Carregando tarefas">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-64 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-6" aria-hidden />}
            title="Nenhuma tarefa ainda"
            text="Crie a primeira tarefa para começar a se organizar."
            action={
              <button type="button" className={btnPrimary} onClick={() => setForm({ mode: "create", status: "todo" })}>
                <Plus className="size-4" aria-hidden />
                Nova tarefa
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchX className="size-6" aria-hidden />}
            title="Nenhuma tarefa encontrada"
            text="Nenhuma tarefa corresponde à busca e aos filtros atuais."
            action={
              <button type="button" className={btnGhost} onClick={() => setFilters(DEFAULT_FILTERS)}>
                Limpar filtros
              </button>
            }
          />
        ) : view === "kanban" ? (
          <KanbanBoard
            tasks={visible}
            columns={columns}
            actions={actions}
            onCreate={(status) => setForm({ mode: "create", status })}
          />
        ) : (
          <TaskList tasks={visible} sort={sort} onSortChange={setSort} actions={actions} />
        )}
      </main>

      {form && (
        <TaskFormDialog
          key={form.mode === "edit" ? form.task.id : "new"}
          task={form.mode === "edit" ? form.task : undefined}
          defaultStatus={form.mode === "create" ? form.status : undefined}
          categories={categories}
          onClose={() => setForm(null)}
          onSubmit={async (input) => {
            if (form.mode === "edit") return updateWithToast(form.task.id, input);
            const created = await createTask(input);
            if (created) toast("Tarefa criada", "success");
            return created;
          }}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title="Excluir tarefa?"
          message={
            <>
              A tarefa <strong className="font-semibold">“{toDelete.title}”</strong> será excluída
              permanentemente. Esta ação não pode ser desfeita.
            </>
          }
          confirmLabel="Excluir"
          onCancel={() => setToDelete(null)}
          onConfirm={async () => {
            setToDelete(null);
            if (await deleteTask(toDelete.id)) toast("Tarefa excluída", "info");
          }}
        />
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
      <span className="flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        {icon}
      </span>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{text}</p>
      <div className="mt-5">{action}</div>
    </div>
  );
}
