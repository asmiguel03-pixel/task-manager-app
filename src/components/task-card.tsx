"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  Trash2,
} from "lucide-react";
import type { TaskActions } from "@/hooks/use-tasks";
import { isOverdue } from "@/lib/task-domain";
import { STATUS_LABELS, type Status, type Task } from "@/lib/task-schema";
import { Markdown } from "./markdown";
import { CategoryBadge, cx, DueDate, IconButton, PriorityBadge, ProgressBar } from "./ui";

const FLOW: Status[] = ["todo", "in_progress", "done"];

export function TaskActionButtons({ task, actions }: { task: Task; actions: TaskActions }) {
  const archived = task.status === "archived";
  return (
    <>
      <IconButton label={`Editar "${task.title}"`} onClick={() => actions.onEdit(task)}>
        <Pencil className="size-3.5" aria-hidden />
      </IconButton>
      <IconButton label={`Duplicar "${task.title}"`} onClick={() => actions.duplicateTask(task)}>
        <Copy className="size-3.5" aria-hidden />
      </IconButton>
      <IconButton
        label={archived ? `Restaurar "${task.title}"` : `Arquivar "${task.title}"`}
        onClick={() => actions.updateTask(task.id, { status: archived ? "todo" : "archived" })}
      >
        {archived ? (
          <ArchiveRestore className="size-3.5" aria-hidden />
        ) : (
          <Archive className="size-3.5" aria-hidden />
        )}
      </IconButton>
      <IconButton
        label={`Excluir "${task.title}"`}
        onClick={() => actions.onDelete(task)}
        className="hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-300"
      >
        <Trash2 className="size-3.5" aria-hidden />
      </IconButton>
    </>
  );
}

export function TaskCard({
  task,
  actions,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  task: Task;
  actions: TaskActions;
  onDragStart: (task: Task, e: React.DragEvent) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const idx = FLOW.indexOf(task.status);
  const prev = idx > 0 ? FLOW[idx - 1] : undefined;
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : undefined;
  const overdue = isOverdue(task);

  return (
    <article
      draggable
      onDragStart={(e) => onDragStart(task, e)}
      onDragEnd={onDragEnd}
      aria-label={task.title}
      className={cx(
        "group cursor-grab rounded-xl border bg-white p-3 shadow-sm transition active:cursor-grabbing dark:bg-zinc-900",
        overdue
          ? "border-red-300 dark:border-red-900"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
        dragging && "opacity-40",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={task.priority} />
        <CategoryBadge category={task.category} />
      </div>

      <h3 className="mt-2 text-sm font-medium leading-snug">
        <button
          type="button"
          onClick={() => actions.onEdit(task)}
          className={cx(
            "rounded text-left break-words hover:underline",
            task.status === "done" && "text-zinc-500 line-through dark:text-zinc-400",
          )}
        >
          {task.title}
        </button>
      </h3>

      {task.description && (
        <Markdown className="mt-1 line-clamp-3 text-xs text-zinc-500 dark:text-zinc-400">
          {task.description}
        </Markdown>
      )}

      {task.subtasks.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer list-none rounded [&::-webkit-details-marker]:hidden">
            <span className="sr-only">Mostrar subtarefas</span>
            <ProgressBar task={task} />
          </summary>
          <ul className="mt-2 space-y-1">
            {task.subtasks.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={s.completed}
                    onChange={() => actions.toggleSubtask(task, s.id)}
                    className="mt-0.5 size-3.5 accent-indigo-600"
                  />
                  <span className={cx("break-words", s.completed && "text-zinc-400 line-through")}>
                    {s.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="mt-3 flex items-center justify-between gap-2">
        <DueDate task={task} />
        <div className="ml-auto flex items-center opacity-100 transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:opacity-0">
          {idx >= 0 && (
            <>
              <IconButton
                label={prev ? `Mover para ${STATUS_LABELS[prev]}` : "Já está na primeira coluna"}
                disabled={!prev}
                onClick={() => prev && actions.updateTask(task.id, { status: prev })}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </IconButton>
              <IconButton
                label={next ? `Mover para ${STATUS_LABELS[next]}` : "Já está na última coluna"}
                disabled={!next}
                onClick={() => next && actions.updateTask(task.id, { status: next })}
              >
                <ChevronRight className="size-4" aria-hidden />
              </IconButton>
            </>
          )}
          <TaskActionButtons task={task} actions={actions} />
        </div>
      </footer>
    </article>
  );
}
