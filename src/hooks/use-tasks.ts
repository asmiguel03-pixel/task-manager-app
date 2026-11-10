"use client";

import { useCallback, useEffect, useState } from "react";
import { duplicateInput } from "@/lib/task-domain";
import { taskRepository, type TaskRepository } from "@/lib/task-repository";
import type { Task, TaskInput } from "@/lib/task-schema";

export function useTasks(repo: TaskRepository = taskRepository) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      repo
        .list()
        .then((list) => alive && setTasks(list))
        .catch(() => alive && setError("Não foi possível carregar as tarefas."))
        .finally(() => alive && setLoading(false));
    load();
    const unsubscribe = repo.subscribe?.(load);
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [repo]);

  const run = useCallback(async <T,>(op: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await op();
      setError(null);
      return result;
    } catch {
      setError("Não foi possível salvar a alteração. Tente novamente.");
      return undefined;
    }
  }, []);

  const createTask = useCallback(
    (input: TaskInput) =>
      run(async () => {
        const task = await repo.create(input);
        setTasks((prev) => [task, ...prev]);
        return task;
      }),
    [repo, run],
  );

  const updateTask = useCallback(
    (id: string, patch: Partial<TaskInput>) =>
      run(async () => {
        const task = await repo.update(id, patch);
        setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
        return task;
      }),
    [repo, run],
  );

  const deleteTask = useCallback(
    (id: string) =>
      run(async () => {
        await repo.remove(id);
        setTasks((prev) => prev.filter((t) => t.id !== id));
        return true;
      }),
    [repo, run],
  );

  const duplicateTask = useCallback(
    (task: Task) => createTask(duplicateInput(task)),
    [createTask],
  );

  const toggleSubtask = useCallback(
    (task: Task, subtaskId: string) =>
      updateTask(task.id, {
        subtasks: task.subtasks.map((s) =>
          s.id === subtaskId ? { ...s, completed: !s.completed } : s,
        ),
      }),
    [updateTask],
  );

  return {
    tasks,
    loading,
    error,
    dismissError: () => setError(null),
    createTask,
    updateTask,
    deleteTask,
    duplicateTask,
    toggleSubtask,
  };
}

export type TaskActions = Pick<
  ReturnType<typeof useTasks>,
  "updateTask" | "duplicateTask" | "toggleSubtask"
> & {
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
};
