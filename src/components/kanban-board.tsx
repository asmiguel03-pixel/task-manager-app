"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { TaskActions } from "@/hooks/use-tasks";
import { sortForBoard } from "@/lib/task-domain";
import { STATUS_LABELS, type Status, type Task } from "@/lib/task-schema";
import { TaskCard } from "./task-card";
import { cx, IconButton } from "./ui";

const DOT: Record<Status, string> = {
  todo: "bg-zinc-400",
  in_progress: "bg-indigo-500",
  done: "bg-emerald-500",
  archived: "bg-zinc-300 dark:bg-zinc-600",
};

export function KanbanBoard({
  tasks,
  columns,
  actions,
  onCreate,
}: {
  tasks: Task[];
  columns: Status[];
  actions: TaskActions;
  onCreate: (status: Status) => void;
}) {
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<Status | null>(null);

  const drop = (status: Status) => {
    if (dragging && dragging.status !== status) {
      actions.updateTask(dragging.id, { status });
    }
    setDragging(null);
    setOver(null);
  };

  return (
    <div
      className={cx(
        "grid gap-4",
        columns.length === 1 ? "md:grid-cols-1" : columns.length === 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3",
      )}
    >
      {columns.map((status) => {
        const items = sortForBoard(tasks.filter((t) => t.status === status));
        const isTarget = over === status && dragging?.status !== status;
        return (
          <section
            key={status}
            aria-label={`${STATUS_LABELS[status]} (${items.length})`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== status) setOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(status);
            }}
            className={cx(
              "flex min-h-40 flex-col rounded-2xl border p-2 transition-colors",
              isTarget
                ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40"
                : "border-transparent bg-zinc-100 dark:bg-zinc-900/50",
            )}
          >
            <header className="flex items-center gap-2 px-2 py-1.5">
              <span className={cx("size-2 rounded-full", DOT[status])} aria-hidden />
              <h2 className="text-sm font-semibold">{STATUS_LABELS[status]}</h2>
              <span className="rounded-full bg-zinc-200 px-2 text-xs font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {items.length}
              </span>
              {status !== "archived" && (
                <IconButton
                  label={`Nova tarefa em ${STATUS_LABELS[status]}`}
                  className="ml-auto"
                  onClick={() => onCreate(status)}
                >
                  <Plus className="size-4" aria-hidden />
                </IconButton>
              )}
            </header>
            <ul className="mt-1 flex flex-1 flex-col gap-2">
              {items.map((task) => (
                <li key={task.id}>
                  <TaskCard
                    task={task}
                    actions={actions}
                    dragging={dragging?.id === task.id}
                    onDragStart={(t, e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", t.id);
                      setDragging(t);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  />
                </li>
              ))}
              {items.length === 0 && (
                <li className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-300 px-3 py-8 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  {dragging ? "Solte aqui" : "Nenhuma tarefa"}
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
