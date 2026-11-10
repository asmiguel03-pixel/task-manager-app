import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { mockTasks } from "@/lib/mock-data";
import { TaskSchema } from "@/lib/task-schema";
import type { Task } from "@/types/task";

/**
 * Armazenamento no servidor, compartilhado por todos os visitantes.
 * - Produção: Redis via REST (Upstash / Vercel KV), configurado por variáveis de ambiente.
 * - Desenvolvimento: arquivo JSON local em `.data/tasks.json`.
 */
export interface TaskStore {
  all(): Promise<Task[]>;
  get(id: string): Promise<Task | undefined>;
  put(task: Task): Promise<void>;
  delete(id: string): Promise<void>;
}

export class StoreNotConfiguredError extends Error {
  constructor() {
    super(
      "Banco de dados não configurado. Defina KV_REST_API_URL e KV_REST_API_TOKEN (Upstash Redis) no ambiente de produção.",
    );
  }
}

const parseTask = (raw: unknown): Task[] => {
  const result = TaskSchema.safeParse(raw);
  return result.success ? [result.data] : [];
};

// ---------- Redis (REST) ----------

const HASH = "task-manager:tasks";
const SEEDED = "task-manager:seeded";

class RedisTaskStore implements TaskStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async command<T>(...args: string[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis respondeu ${res.status}`);
    const body = z.object({ result: z.unknown() }).parse(await res.json());
    return body.result as T;
  }

  private fromJson(values: string[]): Task[] {
    return values.flatMap((v) => {
      try {
        return parseTask(JSON.parse(v));
      } catch {
        return [];
      }
    });
  }

  async all() {
    const values = await this.command<string[]>("HVALS", HASH);
    if (values.length > 0) return this.fromJson(values);
    // Vazio: popula com exemplos uma única vez (SET NX evita repetir após o usuário apagar tudo).
    const first = await this.command<string | null>("SET", SEEDED, "1", "NX");
    if (first !== "OK") return [];
    const seed = mockTasks();
    await this.command("HSET", HASH, ...seed.flatMap((t) => [t.id, JSON.stringify(t)]));
    return seed;
  }

  async get(id: string) {
    const value = await this.command<string | null>("HGET", HASH, id);
    return value ? this.fromJson([value])[0] : undefined;
  }

  async put(task: Task) {
    await this.command("HSET", HASH, task.id, JSON.stringify(task));
  }

  async delete(id: string) {
    await this.command("HDEL", HASH, id);
  }
}

// ---------- Arquivo local (desenvolvimento) ----------

class FileTaskStore implements TaskStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  /** Serializa as operações para evitar gravações concorrentes no arquivo. */
  private exclusive<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<Task[]> {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      return Array.isArray(raw) ? raw.flatMap(parseTask) : [];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const seed = mockTasks();
      await this.write(seed);
      return seed;
    }
  }

  private async write(tasks: Task[]) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(tasks, null, 2));
  }

  all() {
    return this.exclusive(() => this.read());
  }
  get(id: string) {
    return this.exclusive(async () => (await this.read()).find((t) => t.id === id));
  }
  put(task: Task) {
    return this.exclusive(async () => {
      const tasks = await this.read();
      const exists = tasks.some((t) => t.id === task.id);
      await this.write(exists ? tasks.map((t) => (t.id === task.id ? task : t)) : [task, ...tasks]);
    });
  }
  delete(id: string) {
    return this.exclusive(async () => this.write((await this.read()).filter((t) => t.id !== id)));
  }
}

let store: TaskStore | undefined;

export function getTaskStore(): TaskStore {
  if (store) return store;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return (store = new RedisTaskStore(url, token));
  // Em hospedagem serverless o disco não persiste: exigir o banco em vez de perder dados em silêncio.
  if (process.env.VERCEL) throw new StoreNotConfiguredError();
  return (store = new FileTaskStore(
    process.env.TASKS_FILE ?? path.join(process.cwd(), ".data", "tasks.json"),
  ));
}
