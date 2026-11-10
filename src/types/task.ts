import type { z } from "zod";
import type {
  PrioritySchema,
  StatusSchema,
  SubtaskSchema,
  TaskInputSchema,
  TaskSchema,
} from "@/lib/task-schema";

// Tipos derivados dos schemas Zod: uma única fonte da verdade.
export type Status = z.infer<typeof StatusSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskInput = z.infer<typeof TaskInputSchema>;

export type ToastKind = "success" | "info" | "error";
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}
