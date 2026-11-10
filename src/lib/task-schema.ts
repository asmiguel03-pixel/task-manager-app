import { z } from "zod";

export const STATUSES = ["todo", "in_progress", "done", "archived"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const StatusSchema = z.enum(STATUSES);
export const PrioritySchema = z.enum(PRIORITIES);

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 5000;
export const CATEGORY_MAX = 40;

export const SubtaskSchema = z.object({
  id: z.string().min(1),
  title: z
    .string()
    .trim()
    .min(1, "A subtarefa precisa de um título.")
    .max(TITLE_MAX, `Máximo de ${TITLE_MAX} caracteres.`),
  completed: z.boolean(),
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z
    .string()
    .trim()
    .min(1, "O título é obrigatório.")
    .max(TITLE_MAX, `O título deve ter no máximo ${TITLE_MAX} caracteres.`),
  description: z
    .string()
    .max(DESCRIPTION_MAX, `Máximo de ${DESCRIPTION_MAX} caracteres.`)
    .optional(),
  status: StatusSchema,
  priority: PrioritySchema,
  category: z
    .string()
    .trim()
    .max(CATEGORY_MAX, `Máximo de ${CATEGORY_MAX} caracteres.`),
  /** Data de calendário, formato ISO `YYYY-MM-DD`. */
  dueDate: z.iso.date("Data inválida.").optional(),
  completedAt: z.iso.datetime().optional(),
  subtasks: z.array(SubtaskSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** Campos editáveis pelo usuário; o restante é controlado pelo domínio. */
export const TaskInputSchema = TaskSchema.omit({
  id: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
});

import type { Priority, Status } from "@/types/task";
export type { Priority, Status, Subtask, Task, TaskInput } from "@/types/task";

export const STATUS_LABELS: Record<Status, string> = {
  todo: "A Fazer",
  in_progress: "Em Progresso",
  done: "Concluído",
  archived: "Arquivado",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};
