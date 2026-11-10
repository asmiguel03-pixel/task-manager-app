import { buildTask, newId, todayISO } from "./task-domain";
import type { Task } from "./task-schema";

const offset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayISO(d);
};

const sub = (title: string, completed = false) => ({ id: newId(), title, completed });

/** Tarefas de exemplo exibidas apenas na primeira execução. */
export function mockTasks(): Task[] {
  return [
    buildTask({
      title: "Planejar o lançamento da versão 1.0",
      description:
        "Definir **escopo final**, checklist de publicação e comunicação.\nAlinhar com o time na reunião semanal.",
      status: "in_progress",
      priority: "high",
      category: "Produto",
      dueDate: offset(3),
      subtasks: [sub("Fechar escopo", true), sub("Checklist de publicação"), sub("Rascunho do anúncio")],
    }),
    buildTask({
      title: "Corrigir bug no fluxo de login",
      description: "Usuários relatam redirecionamento incorreto após autenticar.",
      status: "todo",
      priority: "urgent",
      category: "Engenharia",
      dueDate: offset(-1),
      subtasks: [sub("Reproduzir o problema", true), sub("Escrever teste de regressão")],
    }),
    buildTask({
      title: "Revisar textos da página inicial",
      status: "todo",
      priority: "medium",
      category: "Marketing",
      dueDate: offset(7),
      subtasks: [],
    }),
    buildTask({
      title: "Atualizar dependências do projeto",
      status: "todo",
      priority: "low",
      category: "Engenharia",
      subtasks: [],
    }),
    buildTask({
      title: "Configurar pipeline de CI",
      description: "Lint, type-check e build a cada pull request.",
      status: "done",
      priority: "medium",
      category: "Engenharia",
      dueDate: offset(-2),
      subtasks: [sub("Lint", true), sub("Build", true)],
    }),
  ];
}
