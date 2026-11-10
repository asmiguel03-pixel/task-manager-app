"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import type { Toast, ToastKind } from "@/types/task";
import { cx } from "./ui";

const ICONS: Record<ToastKind, [typeof Info, string]> = {
  success: [CircleCheck, "text-emerald-500"],
  info: [Info, "text-indigo-500"],
  error: [CircleAlert, "text-red-500"],
};

export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end"
    >
      {toasts.map(({ id, kind, message }) => {
        const [Icon, tone] = ICONS[kind];
        return (
          <div
            key={id}
            className="toast-in pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-xl border border-zinc-200 bg-white py-2.5 pl-3.5 pr-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
          >
            <Icon className={cx("size-4 shrink-0", tone)} aria-hidden />
            <span className="flex-1">{message}</span>
            <button
              type="button"
              onClick={() => onDismiss(id)}
              aria-label="Dispensar notificação"
              className="rounded-md p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
