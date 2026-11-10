import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageTaskRepository } from "./task-repository";
import type { TaskInput } from "./task-schema";

const KEY = "test:tasks";
const input: TaskInput = {
  title: "Tarefa",
  status: "todo",
  priority: "medium",
  category: "",
  subtasks: [],
};

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

describe("LocalStorageTaskRepository", () => {
  it("popula com dados de exemplo apenas quando não há nada salvo", async () => {
    const repo = new LocalStorageTaskRepository(KEY);
    expect((await repo.list()).length).toBeGreaterThan(0);

    store.set(KEY, "[]");
    expect(await repo.list()).toEqual([]);
  });

  it("cria, atualiza e remove persistindo no storage", async () => {
    store.set(KEY, "[]");
    const repo = new LocalStorageTaskRepository(KEY);

    const created = await repo.create(input);
    expect(await repo.list()).toEqual([created]);

    const updated = await repo.update(created.id, { status: "done" });
    expect(updated.completedAt).toBeDefined();
    expect(JSON.parse(store.get(KEY)!)[0].status).toBe("done");

    await repo.remove(created.id);
    expect(await repo.list()).toEqual([]);
  });

  it("falha ao atualizar tarefa inexistente", async () => {
    store.set(KEY, "[]");
    await expect(new LocalStorageTaskRepository(KEY).update("x", {})).rejects.toThrow();
  });

  it("descarta registros corrompidos sem perder os válidos", async () => {
    store.set(KEY, "[]");
    const repo = new LocalStorageTaskRepository(KEY);
    const good = await repo.create(input);
    store.set(KEY, JSON.stringify([good, { id: 1, title: "" }, "lixo"]));
    expect(await repo.list()).toEqual([good]);

    store.set(KEY, "{não é json");
    expect(await repo.list()).toEqual([]);
  });
});
