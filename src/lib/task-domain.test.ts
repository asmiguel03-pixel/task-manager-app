import { describe, expect, it } from "vitest";
import {
  buildTask,
  computeMetrics,
  DEFAULT_FILTERS,
  duplicateInput,
  filterTasks,
  isOverdue,
  listCategories,
  patchTask,
  sortForBoard,
  sortTasks,
  subtaskProgress,
  todayISO,
} from "./task-domain";
import { TaskInputSchema, TaskSchema, type TaskInput } from "./task-schema";

const input = (over: Partial<TaskInput> = {}): TaskInput => ({
  title: "Tarefa",
  status: "todo",
  priority: "medium",
  category: "",
  subtasks: [],
  ...over,
});
const TODAY = "2026-06-15";

describe("schema", () => {
  it("exige título e limita a 120 caracteres", () => {
    expect(TaskInputSchema.safeParse(input({ title: "   " })).success).toBe(false);
    expect(TaskInputSchema.safeParse(input({ title: "a".repeat(121) })).success).toBe(false);
    expect(TaskInputSchema.safeParse(input({ title: "a".repeat(120) })).success).toBe(true);
  });

  it("rejeita status, prioridade e datas inválidos", () => {
    expect(TaskInputSchema.safeParse({ ...input(), status: "x" }).success).toBe(false);
    expect(TaskInputSchema.safeParse({ ...input(), priority: "x" }).success).toBe(false);
    expect(TaskInputSchema.safeParse(input({ dueDate: "15/06/2026" })).success).toBe(false);
    expect(TaskInputSchema.safeParse(input({ dueDate: "2026-02-30" })).success).toBe(false);
  });
});

describe("buildTask / patchTask", () => {
  it("cria uma tarefa válida, com título aparado", () => {
    const task = buildTask(input({ title: "  Olá  " }));
    expect(TaskSchema.safeParse(task).success).toBe(true);
    expect(task.title).toBe("Olá");
    expect(task.completedAt).toBeUndefined();
    expect(task.createdAt).toBe(task.updatedAt);
  });

  it("define completedAt ao concluir, preserva ao editar e limpa ao reabrir", () => {
    const task = buildTask(input(), new Date("2026-01-01T10:00:00Z"));
    const done = patchTask(task, { status: "done" }, new Date("2026-01-02T10:00:00Z"));
    expect(done.completedAt).toBe("2026-01-02T10:00:00.000Z");
    expect(done.updatedAt).toBe("2026-01-02T10:00:00.000Z");
    expect(done.createdAt).toBe(task.createdAt);

    const edited = patchTask(done, { title: "Novo" }, new Date("2026-01-03T10:00:00Z"));
    expect(edited.completedAt).toBe(done.completedAt);

    expect(patchTask(edited, { status: "todo" }).completedAt).toBeUndefined();
    expect(buildTask(input({ status: "done" })).completedAt).toBeDefined();
  });

  it("recusa alterações inválidas", () => {
    expect(() => patchTask(buildTask(input()), { title: "" })).toThrow();
  });
});

describe("duplicateInput", () => {
  it("copia como pendente, com subtarefas zeradas e novos ids", () => {
    const task = buildTask(
      input({ status: "done", subtasks: [{ id: "s1", title: "A", completed: true }] }),
    );
    const copy = duplicateInput(task);
    expect(copy.title).toBe("Tarefa (cópia)");
    expect(copy.status).toBe("todo");
    expect(copy.subtasks[0]).toMatchObject({ title: "A", completed: false });
    expect(copy.subtasks[0].id).not.toBe("s1");
  });

  it("mantém o título dentro do limite", () => {
    const copy = duplicateInput(buildTask(input({ title: "a".repeat(120) })));
    expect(copy.title).toHaveLength(120);
    expect(TaskInputSchema.safeParse(copy).success).toBe(true);
  });
});

describe("isOverdue", () => {
  it("considera atrasada apenas a tarefa aberta com prazo anterior a hoje", () => {
    expect(isOverdue(buildTask(input({ dueDate: "2026-06-14" })), TODAY)).toBe(true);
    expect(isOverdue(buildTask(input({ dueDate: TODAY })), TODAY)).toBe(false);
    expect(isOverdue(buildTask(input()), TODAY)).toBe(false);
    expect(isOverdue(buildTask(input({ dueDate: "2026-06-14", status: "done" })), TODAY)).toBe(false);
    expect(isOverdue(buildTask(input({ dueDate: "2026-06-14", status: "archived" })), TODAY)).toBe(false);
  });

  it("todayISO usa a data local", () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("filtros", () => {
  const tasks = [
    buildTask(input({ title: "Relatório mensal", category: "Financeiro", priority: "high" })),
    buildTask(input({ title: "Bug", description: "erro na AUTENTICAÇÃO", category: "Dev", priority: "urgent", status: "in_progress" })),
    buildTask(input({ title: "Antiga", category: "Dev", status: "archived" })),
  ];
  const titles = (f: Partial<typeof DEFAULT_FILTERS>) =>
    filterTasks(tasks, { ...DEFAULT_FILTERS, ...f }).map((t) => t.title);

  it("oculta arquivadas por padrão", () => {
    expect(titles({})).toEqual(["Relatório mensal", "Bug"]);
    expect(titles({ status: "all" })).toHaveLength(3);
    expect(titles({ status: "archived" })).toEqual(["Antiga"]);
  });

  it("busca em título e descrição ignorando caixa e acentos", () => {
    expect(titles({ search: "relatorio" })).toEqual(["Relatório mensal"]);
    expect(titles({ search: "autenticacao" })).toEqual(["Bug"]);
    expect(titles({ search: "nada" })).toEqual([]);
  });

  it("combina filtros", () => {
    expect(titles({ category: "Dev" })).toEqual(["Bug"]);
    expect(titles({ category: "Dev", priority: "high" })).toEqual([]);
    expect(titles({ category: "Dev", status: "all", search: "ant" })).toEqual(["Antiga"]);
  });

  it("lista categorias únicas em ordem", () => {
    expect(listCategories(tasks)).toEqual(["Dev", "Financeiro"]);
  });
});

describe("ordenação", () => {
  const tasks = [
    buildTask(input({ title: "B", priority: "low", dueDate: "2026-03-01", status: "done" })),
    buildTask(input({ title: "A", priority: "urgent" })),
    buildTask(input({ title: "C", priority: "high", dueDate: "2026-01-01", status: "in_progress" })),
  ];
  const order = (key: Parameters<typeof sortTasks>[1]["key"], dir: "asc" | "desc") =>
    sortTasks(tasks, { key, dir }).map((t) => t.title).join("");

  it("ordena por título, prioridade e status", () => {
    expect(order("title", "asc")).toBe("ABC");
    expect(order("priority", "desc")).toBe("ACB");
    expect(order("status", "asc")).toBe("ACB");
  });

  it("mantém tarefas sem prazo no fim nas duas direções", () => {
    expect(order("dueDate", "asc")).toBe("CBA");
    expect(order("dueDate", "desc")).toBe("BCA");
  });

  it("não altera o array original; quadro prioriza urgência", () => {
    expect(tasks.map((t) => t.title).join("")).toBe("BAC");
    expect(sortForBoard(tasks).map((t) => t.title).join("")).toBe("ACB");
  });
});

describe("métricas", () => {
  it("conta total, pendentes, concluídas e atrasadas sem as arquivadas", () => {
    const tasks = [
      buildTask(input({ dueDate: "2026-06-01" })),
      buildTask(input({ status: "in_progress", dueDate: "2026-07-01" })),
      buildTask(input({ status: "done", dueDate: "2026-06-01" })),
      buildTask(input({ status: "archived", dueDate: "2026-06-01" })),
    ];
    expect(computeMetrics(tasks, TODAY)).toEqual({
      total: 3,
      pending: 2,
      done: 1,
      overdue: 1,
      completionRate: 33,
    });
    expect(computeMetrics([], TODAY).completionRate).toBe(0);
  });

  it("calcula o progresso das subtarefas", () => {
    const task = buildTask(
      input({
        subtasks: [
          { id: "1", title: "a", completed: true },
          { id: "2", title: "b", completed: false },
          { id: "3", title: "c", completed: false },
        ],
      }),
    );
    expect(subtaskProgress(task)).toEqual({ total: 3, done: 1, percent: 33 });
    expect(subtaskProgress(buildTask(input())).percent).toBe(0);
  });
});
