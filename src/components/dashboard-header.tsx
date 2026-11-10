import { CircleCheck, Clock, ListTodo, TriangleAlert } from "lucide-react";
import type { computeMetrics } from "@/lib/task-domain";
import { cx } from "./ui";

type Metrics = ReturnType<typeof computeMetrics>;

export function DashboardHeader({ metrics }: { metrics: Metrics }) {
  const cards = [
    { label: "Total", value: metrics.total, Icon: ListTodo, tone: "text-indigo-600 dark:text-indigo-400" },
    { label: "Pendentes", value: metrics.pending, Icon: Clock, tone: "text-amber-600 dark:text-amber-400" },
    { label: "Concluídas", value: metrics.done, Icon: CircleCheck, tone: "text-emerald-600 dark:text-emerald-400" },
  ];
  const hasOverdue = metrics.overdue > 0;

  return (
    <section aria-label="Resumo das tarefas">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, tone }) => (
          <div
            key={label}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <dt className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Icon className={cx("size-4", tone)} aria-hidden />
              {label}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
            {label === "Concluídas" && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${metrics.completionRate}%` }} />
              </div>
            )}
          </div>
        ))}
        <div
          className={cx(
            "rounded-xl border p-4",
            hasOverdue
              ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
              : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
          )}
        >
          <dt
            className={cx(
              "flex items-center gap-2 text-sm",
              hasOverdue ? "font-medium text-red-700 dark:text-red-300" : "text-zinc-500 dark:text-zinc-400",
            )}
          >
            <TriangleAlert className={cx("size-4", hasOverdue && "animate-pulse")} aria-hidden />
            Atrasadas
          </dt>
          <dd
            className={cx(
              "mt-1 text-2xl font-semibold tabular-nums",
              hasOverdue && "text-red-700 dark:text-red-300",
            )}
          >
            {metrics.overdue}
          </dd>
        </div>
      </dl>
    </section>
  );
}
