import {
  PRIORITIES,
  STATUSES,
  TaskInputSchema,
  type Priority,
  type Status,
  type Task,
  type TaskInput,
} from "./task-schema";

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback para contextos não seguros (http fora de localhost).
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ ((Math.random() * 16) >> (+c / 4))).toString(16),
  );
}

/** Data local de hoje em `YYYY-MM-DD` (comparável lexicograficamente). */
export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isOverdue(task: Task, today = todayISO()): boolean {
  return (
    !!task.dueDate &&
    task.dueDate < today &&
    task.status !== "done" &&
    task.status !== "archived"
  );
}

export function formatDueDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    ...(y !== new Date().getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

/** Cria uma entidade completa a partir da entrada validada. */
export function buildTask(input: TaskInput, now = new Date()): Task {
  const data = TaskInputSchema.parse(input);
  const ts = now.toISOString();
  return {
    ...data,
    id: newId(),
    completedAt: data.status === "done" ? ts : undefined,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Aplica uma alteração parcial mantendo `completedAt`/`updatedAt` coerentes. */
export function patchTask(
  task: Task,
  patch: Partial<TaskInput>,
  now = new Date(),
): Task {
  const { id, createdAt, completedAt } = task;
  const data = TaskInputSchema.parse({ ...task, ...patch });
  const ts = now.toISOString();
  return {
    ...data,
    id,
    createdAt,
    updatedAt: ts,
    completedAt: data.status === "done" ? (completedAt ?? ts) : undefined,
  };
}

export function duplicateInput(task: Task): TaskInput {
  const suffix = " (cópia)";
  return {
    title: task.title.slice(0, 120 - suffix.length) + suffix,
    description: task.description,
    status: "todo",
    priority: task.priority,
    category: task.category,
    dueDate: task.dueDate,
    subtasks: task.subtasks.map((s) => ({
      ...s,
      id: newId(),
      completed: false,
    })),
  };
}

export function subtaskProgress(task: Task) {
  const total = task.subtasks.length;
  const done = task.subtasks.filter((s) => s.completed).length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

// ---------- Filtros ----------

export type StatusFilter = Status | "active" | "all";

export interface TaskFilters {
  search: string;
  priority: Priority | "all";
  category: string | "all";
  status: StatusFilter;
}

export const DEFAULT_FILTERS: TaskFilters = {
  search: "",
  priority: "all",
  category: "all",
  status: "active",
};

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function filterTasks(tasks: Task[], f: TaskFilters): Task[] {
  const q = normalize(f.search.trim());
  return tasks.filter((t) => {
    if (f.status === "active" ? t.status === "archived" : f.status !== "all" && t.status !== f.status)
      return false;
    if (f.priority !== "all" && t.priority !== f.priority) return false;
    if (f.category !== "all" && t.category !== f.category) return false;
    if (q && !normalize(`${t.title}\n${t.description ?? ""}`).includes(q))
      return false;
    return true;
  });
}

export function listCategories(tasks: Task[]): string[] {
  return [...new Set(tasks.map((t) => t.category).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "pt-BR"),
  );
}

// ---------- Ordenação ----------

export type SortKey = "title" | "status" | "priority" | "dueDate";
export type SortDir = "asc" | "desc";
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

const rank = <T,>(list: readonly T[], v: T) => list.indexOf(v);

export function sortTasks(tasks: Task[], { key, dir }: SortState): Task[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    let cmp = 0;
    if (key === "title") cmp = a.title.localeCompare(b.title, "pt-BR");
    else if (key === "status") cmp = rank(STATUSES, a.status) - rank(STATUSES, b.status);
    else if (key === "priority")
      cmp = rank(PRIORITIES, a.priority) - rank(PRIORITIES, b.priority);
    else {
      // Tarefas sem prazo ficam sempre no fim, em qualquer direção.
      if (!a.dueDate && !b.dueDate) cmp = 0;
      else if (!a.dueDate) return 1;
      else if (!b.dueDate) return -1;
      else cmp = a.dueDate.localeCompare(b.dueDate);
    }
    return cmp * sign || b.updatedAt.localeCompare(a.updatedAt);
  });
}

/** Ordem padrão do Kanban: mais prioritárias primeiro, depois prazo mais próximo. */
export function sortForBoard(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      rank(PRIORITIES, b.priority) - rank(PRIORITIES, a.priority) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}

// ---------- Métricas ----------

export function computeMetrics(tasks: Task[], today = todayISO()) {
  const live = tasks.filter((t) => t.status !== "archived");
  const done = live.filter((t) => t.status === "done").length;
  return {
    total: live.length,
    pending: live.length - done,
    done,
    overdue: live.filter((t) => isOverdue(t, today)).length,
    completionRate: live.length ? Math.round((done / live.length) * 100) : 0,
  };
}
