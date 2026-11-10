import { isOverdue, subtaskProgress, todayISO } from "./task-domain";
import { PRIORITY_LABELS, STATUS_LABELS, type Task } from "./task-schema";
import { buildXlsx, type XlsxCell, type XlsxSheet } from "./xlsx";

const COLUMNS: { header: string; width: number; value: (t: Task, today: string) => XlsxCell }[] = [
  { header: "Título", width: 40, value: (t) => t.title },
  { header: "Status", width: 14, value: (t) => STATUS_LABELS[t.status] },
  { header: "Prioridade", width: 11, value: (t) => PRIORITY_LABELS[t.priority] },
  { header: "Responsável", width: 18, value: (t) => t.assignee || "Sem responsável" },
  { header: "Categoria", width: 16, value: (t) => t.category },
  { header: "Prazo", width: 12, value: (t) => (t.dueDate ? { date: t.dueDate } : null) },
  { header: "Atrasada", width: 10, value: (t, today) => (isOverdue(t, today) ? "Sim" : "Não") },
  {
    header: "Subtarefas",
    width: 11,
    value: (t) => {
      const p = subtaskProgress(t);
      return p.total ? `${p.done}/${p.total}` : "";
    },
  },
  { header: "Criada em", width: 12, value: (t) => ({ date: localDate(t.createdAt) }) },
  { header: "Concluída em", width: 13, value: (t) => (t.completedAt ? { date: localDate(t.completedAt) } : null) },
  { header: "Descrição", width: 60, value: (t) => t.description ?? "" },
];

/** Converte um instante ISO na data de calendário local (fuso do navegador). */
function localDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : todayISO(d);
}

export function tasksToSheet(tasks: Task[], today = todayISO()): XlsxSheet {
  return {
    name: "Tarefas",
    header: COLUMNS.map((c) => c.header),
    widths: COLUMNS.map((c) => c.width),
    rows: tasks.map((t) => COLUMNS.map((c) => c.value(t, today))),
  };
}

export function exportFileName(label: string | undefined, now = new Date()): string {
  const slug = (label ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `tarefas${slug ? `-${slug}` : ""}-${todayISO(now)}.xlsx`;
}

export function exportTasksXlsx(tasks: Task[]): Uint8Array {
  return buildXlsx(tasksToSheet(tasks));
}
