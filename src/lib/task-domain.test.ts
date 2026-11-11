import { describe, expect, it } from "vitest";
import {
  assigneeTabs,
  buildTask,
  computeMetrics,
  DEFAULT_FILTERS,
  duplicateInput,
  filterTasks,
  initials,
  listAssignees,
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

describe("funcionários", () => {
  const tasks = [
    buildTask(input({ title: "1", assignee: "Bruno Lima" })),
    buildTask(input({ title: "2", assignee: "Ana" })),
    buildTask(input({ title: "3", assignee: "Ana", priority: "high" })),
    buildTask(input({ title: "4" })),
    buildTask(input({ title: "5", assignee: "  " })),
    buildTask(input({ title: "6", assignee: "Ana", status: "archived" })),
  ];

  it("lista nomes únicos, ignorando vazios", () => {
    expect(listAssignees(tasks)).toEqual(["Ana", "Bruno Lima"]);
    expect(initials("Bruno Lima")).toBe("BL");
    expect(initials("ana")).toBe("A");
  });

  it("filtra por funcionário e por 'sem responsável'", () => {
    const by = (assignee: string) =>
      filterTasks(tasks, { ...DEFAULT_FILTERS, assignee }).map((t) => t.title);
    expect(by("Ana")).toEqual(["2", "3"]);
    expect(by("")).toEqual(["4", "5"]);
    expect(by("all")).toHaveLength(5);
  });

  it("monta as abas com contagens que respeitam os outros filtros", () => {
    expect(assigneeTabs(tasks, DEFAULT_FILTERS).map((t) => [t.label, t.count])).toEqual([
      ["Todos", 5],
      ["Ana", 2],
      ["Bruno Lima", 1],
      ["Sem responsável", 2],
    ]);
    const high = assigneeTabs(tasks, { ...DEFAULT_FILTERS, priority: "high", assignee: "Ana" });
    expect(high.map((t) => t.count)).toEqual([1, 1, 0, 0]);
    expect(assigneeTabs([tasks[3]], DEFAULT_FILTERS)).toEqual([]);
  });

  it("mantém o responsável ao alterar outros campos e ao duplicar", () => {
    const moved = patchTask(tasks[0], { status: "done" });
    expect(moved.assignee).toBe("Bruno Lima");
    expect(duplicateInput(tasks[0]).assignee).toBe("Bruno Lima");
    expect(patchTask(tasks[0], { assignee: "" }).assignee).toBe("");
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

describe("filtro por prazo", () => {
  const now = new Date("2026-11-01T12:00:00");
  const mk = (title: string, dueDate?: string, status: "todo" | "done" = "todo") =>
    buildTask(input({ title, dueDate, status }), now);
  const list = [
    mk("ontem", "2026-11-10"),
    mk("ontem feita", "2026-11-10", "done"),
    mk("hoje", "2026-11-11"),
    mk("domingo", "2026-11-15"),
    mk("segunda que vem", "2026-11-16"),
    mk("fim do mês", "2026-11-30"),
    mk("dezembro", "2026-12-01"),
    mk("sem prazo"),
  ];
  const titles = (f: Partial<typeof DEFAULT_FILTERS>) =>
    filterTasks(list, { ...DEFAULT_FILTERS, ...f }, "2026-11-11").map((t) => t.title);

  it("atalhos de prazo", () => {
    expect(titles({ due: "overdue" })).toEqual(["ontem"]);
    expect(titles({ due: "today" })).toEqual(["hoje"]);
    expect(titles({ due: "week" })).toEqual(["ontem", "ontem feita", "hoje", "domingo"]);
    expect(titles({ due: "next7" })).toEqual(["hoje", "domingo", "segunda que vem"]);
    expect(titles({ due: "month" })).toEqual([
      "ontem", "ontem feita", "hoje", "domingo", "segunda que vem", "fim do mês",
    ]);
    expect(titles({ due: "none" })).toEqual(["sem prazo"]);
  });

  it("período personalizado, com ou sem limites", () => {
    expect(titles({ due: "custom", dueFrom: "2026-11-15", dueTo: "2026-11-16" })).toEqual(["domingo", "segunda que vem"]);
    expect(titles({ due: "custom", dueFrom: "2026-11-30" })).toEqual(["fim do mês", "dezembro"]);
    expect(titles({ due: "custom" })).toHaveLength(7);
  });
});
