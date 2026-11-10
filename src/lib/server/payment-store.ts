import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PaymentSchema, type Payment } from "@/lib/payment-schema";
import { StoreNotConfiguredError } from "./task-store";

/**
 * Lançamentos do controle de pagamentos, compartilhados por todos.
 * Mesmo banco das tarefas (Redis via REST), em uma chave separada.
 */
export interface PaymentStore {
  all(): Promise<Payment[]>;
  get(id: string): Promise<Payment | undefined>;
  putMany(entries: Payment[]): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;
}

const HASH = "task-manager:payments";

const parse = (raw: unknown): Payment[] => {
  const r = PaymentSchema.safeParse(raw);
  return r.success ? [r.data] : [];
};

class RedisPaymentStore implements PaymentStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async command<T>(...args: string[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis respondeu ${res.status}`);
    return z.object({ result: z.unknown() }).parse(await res.json()).result as T;
  }

  private fromJson(values: (string | null)[]): Payment[] {
    return values.flatMap((v) => {
      if (!v) return [];
      try {
        return parse(JSON.parse(v));
      } catch {
        return [];
      }
    });
  }

  async all() {
    return this.fromJson(await this.command<string[]>("HVALS", HASH));
  }
  async get(id: string) {
    return this.fromJson([await this.command<string | null>("HGET", HASH, id)])[0];
  }
  async putMany(entries: Payment[]) {
    if (entries.length) await this.command("HSET", HASH, ...entries.flatMap((p) => [p.id, JSON.stringify(p)]));
  }
  async deleteMany(ids: string[]) {
    if (ids.length) await this.command("HDEL", HASH, ...ids);
  }
}

class FilePaymentStore implements PaymentStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  private exclusive<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private async read(): Promise<Payment[]> {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      return Array.isArray(raw) ? raw.flatMap(parse) : [];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  private async write(list: Payment[]) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(list, null, 2));
  }
  all() {
    return this.exclusive(() => this.read());
  }
  get(id: string) {
    return this.exclusive(async () => (await this.read()).find((p) => p.id === id));
  }
  putMany(entries: Payment[]) {
    return this.exclusive(async () => {
      const byId = new Map((await this.read()).map((p) => [p.id, p]));
      for (const p of entries) byId.set(p.id, p);
      await this.write([...byId.values()]);
    });
  }
  deleteMany(ids: string[]) {
    return this.exclusive(async () => {
      const drop = new Set(ids);
      await this.write((await this.read()).filter((p) => !drop.has(p.id)));
    });
  }
}

let store: PaymentStore | undefined;

export function getPaymentStore(): PaymentStore {
  if (store) return store;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return (store = new RedisPaymentStore(url, token));
  if (process.env.VERCEL) throw new StoreNotConfiguredError();
  return (store = new FilePaymentStore(path.join(process.cwd(), ".data", "payments.json")));
}
