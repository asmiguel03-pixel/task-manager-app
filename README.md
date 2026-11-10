# Tarefas — Gerenciador de Tarefas

Aplicação de gerenciamento de tarefas com Next.js (App Router), TypeScript, Tailwind CSS, Lucide Icons e Zod.

## Executar

```bash
npm install
npm run dev      # desenvolvimento em http://localhost:3000
npm run build && npm start   # produção
npm run lint
npm run typecheck
npm test         # testes unitários (Vitest)
```

## Funcionalidades

- **Kanban** (A Fazer / Em Progresso / Concluído) com arrastar-e-soltar e botões ◀ ▶ para mover pelo teclado.
- **Lista** em tabela com ordenação por tarefa, status, prioridade e prazo, e troca de status na própria linha.
- **Busca instantânea** (título e descrição, ignora acentos) e filtros combinados por status, prioridade e categoria.
- **CRUD completo** em modal com validação Zod, subtarefas com checkbox e barra de progresso, duplicar, arquivar/restaurar e excluir com confirmação.
- **Resumo**: total, pendentes, concluídas e destaque de tarefas atrasadas.
- **Descrição em Markdown** (negrito, listas, links, código) com pré-visualização no formulário.
- **Toasts** de feedback ao criar, excluir, duplicar e mudar o status de tarefas.
- **Tema claro/escuro** (respeita o sistema e lembra a escolha) e atalhos: `N` nova tarefa, `/` busca, `Esc` fecha modais.

## Arquitetura

```
src/
  lib/
    task-schema.ts      # schemas Zod + tipos inferidos (fonte única da verdade)
    task-domain.ts      # regras puras: criar/alterar, filtros, ordenação, métricas
    task-repository.ts  # interface TaskRepository + implementação LocalStorage
    mock-data.ts        # dados de exemplo da primeira execução
  hooks/                # use-tasks (estado sobre o repositório), use-toasts
  types/task.ts         # tipos compartilhados, inferidos dos schemas
  components/           # TaskApp, Kanban, Lista, formulário, cabeçalho, UI base
```

### Trocar a persistência

A UI só conhece a interface `TaskRepository` (`list`, `create`, `update`, `remove`, `subscribe?`), toda assíncrona.
Para usar uma API ou SQLite (Prisma/Drizzle), implemente a interface (por exemplo chamando Route Handlers) e troque
a exportação `taskRepository` em `src/lib/task-repository.ts`. `buildTask` e `patchTask` (em `task-domain.ts`) podem
ser reutilizados no servidor para manter `completedAt`/`updatedAt` consistentes.

Os dados ficam no `localStorage` do navegador (chave `task-manager:tasks:v1`), validados com Zod na leitura.
