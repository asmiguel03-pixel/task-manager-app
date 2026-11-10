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
  /** Aviso persistente sobre o modo de armazenamento, se houver. Opcional. */
  notice?(): string | null;
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

const POLL_MS = 4000;

class StoreUnavailableError extends Error {}

/**
 * Persistência compartilhada via API (`/api/tasks`): todos os visitantes veem
 * os mesmos dados. `subscribe` consulta o servidor periodicamente e ao voltar
 * para a aba, para refletir as alterações feitas por outras pessoas.
 */
export class ApiTaskRepository implements TaskRepository {
  /** Preenchido quando o servidor não tem banco configurado (HTTP 503). */
  private fallback: LocalStorageTaskRepository | null = null;

  constructor(private readonly baseUrl = "/api/tasks") {}

  notice() {
    return this.fallback
      ? "Banco de dados não configurado no servidor: as tarefas estão sendo salvas apenas neste navegador e não são compartilhadas."
      : null;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      cache: "no-store",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
    if (res.status === 503) throw new StoreUnavailableError();
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const parsed = z.object({ error: z.string() }).safeParse(body);
      throw new Error(parsed.success ? parsed.data.error : `Erro ${res.status}`);
    }
    return res.status === 204 ? undefined : res.json();
  }

  async list() {
    if (this.fallback) return this.fallback.list();
    try {
      return z.array(TaskSchema).parse(await this.request(""));
    } catch (e) {
      if (!(e instanceof StoreUnavailableError)) throw e;
      // Sem banco no servidor: o app continua utilizável, só que local.
      this.fallback = new LocalStorageTaskRepository();
      return this.fallback.list();
    }
  }

  async create(input: TaskInput) {
    if (this.fallback) return this.fallback.create(input);
    return TaskSchema.parse(
      await this.request("", { method: "POST", body: JSON.stringify(input) }),
    );
  }

  async update(id: string, patch: Partial<TaskInput>) {
    if (this.fallback) return this.fallback.update(id, patch);
    return TaskSchema.parse(
      await this.request(`/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    );
  }

  async remove(id: string) {
    if (this.fallback) return this.fallback.remove(id);
    await this.request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  subscribe(listener: () => void) {
    const tick = () => document.visibilityState === "visible" && listener();
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }
}

/**
 * Padrão: dados compartilhados no servidor. Defina
 * NEXT_PUBLIC_TASK_STORAGE=local para guardar apenas no navegador.
 */
export const taskRepository: TaskRepository =
  process.env.NEXT_PUBLIC_TASK_STORAGE === "local"
    ? new LocalStorageTaskRepository()
    : new ApiTaskRepository();
