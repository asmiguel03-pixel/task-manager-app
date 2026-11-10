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

### Persistência

A UI só conhece a interface `TaskRepository` (`list`, `create`, `update`, `remove`, `subscribe?`), toda assíncrona.

- **Padrão — compartilhado:** `ApiTaskRepository` usa a API `/api/tasks` e consulta o servidor a cada 4 s, então
  todos que abrem o site veem e editam as mesmas tarefas. No servidor (`src/lib/server/task-store.ts`):
  - **Produção:** Redis via REST (Upstash). Variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN`
    (ou `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
  - **Desenvolvimento:** sem essas variáveis, grava em `.data/tasks.json`.
  - Na Vercel sem banco configurado, o app avisa e salva só no navegador.
- **Somente local:** `NEXT_PUBLIC_TASK_STORAGE=local` usa apenas o `localStorage`.

### Configurar o banco na Vercel

1. No projeto, abra **Storage → Create Database → Upstash → Redis** (plano gratuito).
2. Conecte o banco ao projeto (as variáveis `KV_REST_API_*` são criadas automaticamente).
3. Faça **Redeploy** em Deployments.

### Proteger com senha

Defina a variável de ambiente `APP_PASSWORD` (na Vercel: **Settings → Environment Variables**, depois Redeploy).
O site passa a pedir essa senha; quem entra fica conectado por 30 dias naquele navegador (cookie httpOnly assinado).
Trocar o valor de `APP_PASSWORD` desconecta todo mundo. Sem a variável, o acesso é livre para quem tem o link.

Localmente: `APP_PASSWORD=minha-senha npm run dev`.
