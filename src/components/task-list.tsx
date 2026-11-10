"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { TaskActions } from "@/hooks/use-tasks";
import { sortTasks, type SortKey, type SortState } from "@/lib/task-domain";
import { STATUSES, STATUS_LABELS, type Status, type Task } from "@/lib/task-schema";
import { TaskActionButtons } from "./task-card";
import { AssigneeBadge, CategoryBadge, cx, DueDate, PriorityBadge, ProgressBar } from "./ui";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "title", label: "Tarefa" },
  { key: "status", label: "Status", className: "w-40" },
  { key: "priority", label: "Prioridade", className: "w-32" },
  { key: "dueDate", label: "Prazo", className: "w-40" },
];

export function TaskList({
  tasks,
  sort,
  onSortChange,
  actions,
}: {
  tasks: Task[];
  sort: SortState;
  onSortChange: (s: SortState) => void;
  actions: TaskActions;
}) {
  const sorted = sortTasks(tasks, sort);
  const toggle = (key: SortKey) =>
    onSortChange({
      key,
      dir: sort.key === key && sort.dir === "asc" ? "desc" : "asc",
    });

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <caption className="sr-only">Lista de tarefas</caption>
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <tr>
            {COLUMNS.map(({ key, label, className }) => {
              const active = sort.key === key;
              const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={key}
                  scope="col"
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cx("px-3 py-2 font-medium", className)}
                >
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className={cx(
                      "inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-zinc-900 dark:hover:text-zinc-100",
                      active && "text-zinc-900 dark:text-zinc-100",
                    )}
                  >
                    {label}
                    <Icon className={cx("size-3.5", !active && "opacity-40")} aria-hidden />
                  </button>
                </th>
              );
            })}
            <th scope="col" className="w-36 px-3 py-2 text-right font-medium">
              Ações
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {sorted.map((task) => (
            <tr key={task.id} className="align-middle hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
              <td className="max-w-0 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => actions.onEdit(task)}
                  className={cx(
                    "block max-w-full truncate rounded text-left font-medium hover:underline",
                    task.status === "done" && "text-zinc-500 line-through dark:text-zinc-400",
                  )}
                >
                  {task.title}
                </button>
                <div className="mt-1 flex items-center gap-2">
                  <CategoryBadge category={task.category} />
                  <AssigneeBadge assignee={task.assignee} />
                  <ProgressBar task={task} className="w-28" />
                </div>
              </td>
              <td className="px-3 py-2.5">
                <select
                  aria-label={`Status de "${task.title}"`}
                  value={task.status}
                  onChange={(e) => actions.updateTask(task.id, { status: e.target.value as Status })}
                  className="h-8 w-full rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2.5">
                <PriorityBadge priority={task.priority} />
              </td>
              <td className="px-3 py-2.5">
                {task.dueDate ? <DueDate task={task} /> : <span className="text-zinc-400">—</span>}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex justify-end">
                  <TaskActionButtons task={task} actions={actions} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
