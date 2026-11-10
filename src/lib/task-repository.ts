import { z } from "zod";
import { buildTask, patchTask } from "./task-domain";
import { mockTasks } from "./mock-data";
import { TaskSchema, type Task, type TaskInput } from "./task-schema";

/**
 * Contrato de persistência. A UI depende apenas desta interface, então trocar
 * LocalStorage por uma API REST, SQLite (Prisma/Drizzle) etc. significa apenas
 * fornecer outra implementação em `taskRepository` abaixo.
 */
export interface TaskRepository {
  list(): Promise<Task[]>;
  create(input: TaskInput): Promise<Task>;
  update(id: string, patch: Partial<TaskInput>): Promise<Task>;
  remove(id: string): Promise<void>;
  /** Notifica mudanças externas (ex.: outra aba). Opcional. */
  subscribe?(listener: () => void): () => void;
}

const STORAGE_KEY = "task-manager:tasks:v1";

export class LocalStorageTaskRepository implements TaskRepository {
  constructor(private readonly key = STORAGE_KEY) {}

  private read(): Task[] {
    const raw = window.localStorage.getItem(this.key);
    if (raw === null) {
      const seeded = mockTasks();
      this.write(seeded);
      return seeded;
    }
    try {
      const parsed = z.array(z.unknown()).parse(JSON.parse(raw));
      // Registros corrompidos são descartados individualmente, não o conjunto todo.
      return parsed.flatMap((item) => {
        const result = TaskSchema.safeParse(item);
        return result.success ? [result.data] : [];
      });
    } catch {
      return [];
    }
  }

  private write(tasks: Task[]) {
    window.localStorage.setItem(this.key, JSON.stringify(tasks));
  }

  async list() {
    return this.read();
  }

  async create(input: TaskInput) {
    const task = buildTask(input);
    this.write([task, ...this.read()]);
    return task;
  }

  async update(id: string, patch: Partial<TaskInput>) {
    const tasks = this.read();
    const current = tasks.find((t) => t.id === id);
    if (!current) throw new Error("Tarefa não encontrada.");
    const next = patchTask(current, patch);
    this.write(tasks.map((t) => (t.id === id ? next : t)));
    return next;
  }

  async remove(id: string) {
    this.write(this.read().filter((t) => t.id !== id));
  }

  subscribe(listener: () => void) {
    const handler = (e: StorageEvent) => {
      if (e.key === this.key || e.key === null) listener();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }
}

export const taskRepository: TaskRepository = new LocalStorageTaskRepository();
