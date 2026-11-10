"use client";

import { useEffect, useId, useRef } from "react";
import { Calendar, Flag, TriangleAlert, X } from "lucide-react";
import { formatDueDate, isOverdue, subtaskProgress } from "@/lib/task-domain";
import { PRIORITY_LABELS, type Priority, type Task } from "@/lib/task-schema";

export const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

export const inputCls =
  "h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 aria-[invalid=true]:border-red-500";

export const btnCls =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:opacity-50";
export const btnPrimary = cx(btnCls, "bg-indigo-600 text-white hover:bg-indigo-500");
export const btnGhost = cx(
  btnCls,
  "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
);
export const btnDanger = cx(btnCls, "bg-red-600 text-white hover:bg-red-500");

export function IconButton({
  label,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

const PRIORITY_STYLES: Record<Priority, string> = {
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  medium: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        PRIORITY_STYLES[priority],
      )}
    >
      <Flag className="size-3" aria-hidden />
      <span className="sr-only">Prioridade: </span>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  if (!category) return null;
  return (
    <span className="inline-flex max-w-40 items-center truncate rounded-md border border-zinc-200 px-1.5 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
      {category}
    </span>
  );
}

export function DueDate({ task }: { task: Task }) {
  if (!task.dueDate) return null;
  const overdue = isOverdue(task);
  const Icon = overdue ? TriangleAlert : Calendar;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap text-xs",
        overdue
          ? "font-semibold text-red-600 dark:text-red-400"
          : "text-zinc-500 dark:text-zinc-400",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <time dateTime={task.dueDate}>{formatDueDate(task.dueDate)}</time>
      {overdue && <span>· atrasada</span>}
    </span>
  );
}

export function ProgressBar({ task, className }: { task: Task; className?: string }) {
  const { total, done, percent } = subtaskProgress(task);
  if (!total) return null;
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-label="Progresso das subtarefas"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div
          className={cx(
            "h-full rounded-full transition-[width]",
            percent === 100 ? "bg-emerald-500" : "bg-indigo-500",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        {done}/{total}
      </span>
    </div>
  );
}

/** Modal sobre <dialog> nativo: foco preso, Esc fecha e foco retorna ao gatilho. */
export function Modal({
  title,
  onClose,
  children,
  role,
  size = "lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  role?: "alertdialog";
  size?: "sm" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      role={role}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/60 backdrop:backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
        size === "sm" ? "max-w-sm" : "max-w-xl",
      )}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X className="size-4" aria-hidden />
          </IconButton>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} role="alertdialog" size="sm">
      <p className="px-5 py-4 text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
      <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
        <button type="button" className={btnGhost} onClick={onCancel} autoFocus>
          Cancelar
        </button>
        <button type="button" className={btnDanger} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
