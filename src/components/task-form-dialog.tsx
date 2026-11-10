"use client";

import { useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { newId } from "@/lib/task-domain";
import {
  ASSIGNEE_MAX,
  CATEGORY_MAX,
  DESCRIPTION_MAX,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  TaskInputSchema,
  TITLE_MAX,
  type Priority,
  type Status,
  type Subtask,
  type Task,
  type TaskInput,
} from "@/lib/task-schema";
import { Markdown } from "./markdown";
import { btnGhost, btnPrimary, cx, IconButton, inputCls, Modal } from "./ui";

type Errors = Partial<Record<"title" | "description" | "category" | "assignee" | "dueDate" | "subtasks", string>>;

const labelCls = "mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300";

export function TaskFormDialog({
  task,
  defaultStatus = "todo",
  defaultAssignee = "",
  categories,
  assignees,
  onSubmit,
  onClose,
}: {
  task?: Task;
  defaultStatus?: Status;
  defaultAssignee?: string;
  categories: string[];
  assignees: string[];
  onSubmit: (input: TaskInput) => Promise<unknown> | void;
  onClose: () => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<Status>(task?.status ?? defaultStatus);
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [category, setCategory] = useState(task?.category ?? "");
  const [assignee, setAssignee] = useState(task?.assignee ?? defaultAssignee);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [subtasks, setSubtasks] = useState<Subtask[]>(task?.subtasks ?? []);
  const [newSubtask, setNewSubtask] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const addSubtask = () => {
    const value = newSubtask.trim();
    if (!value) return;
    setSubtasks((prev) => [...prev, { id: newId(), title: value.slice(0, TITLE_MAX), completed: false }]);
    setNewSubtask("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pending = newSubtask.trim();
    const result = TaskInputSchema.safeParse({
      title,
      description: description.trim() ? description : undefined,
      status,
      priority,
      category,
      assignee,
      dueDate: dueDate || undefined,
      // Uma subtarefa digitada mas não adicionada também é salva.
      subtasks: pending
        ? [...subtasks, { id: newId(), title: pending, completed: false }]
        : subtasks,
    });
    if (!result.success) {
      const next: Errors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof Errors;
        next[field] ??= issue.message;
      }
      setErrors(next);
      const first = Object.keys(next)[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setSaving(true);
    await onSubmit(result.data);
    setSaving(false);
    onClose();
  };

  const err = (field: keyof Errors) =>
    errors[field] && (
      <p id={`${uid}-${field}-error`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
        {errors[field]}
      </p>
    );
  const aria = (field: keyof Errors) => ({
    "aria-invalid": !!errors[field],
    "aria-describedby": errors[field] ? `${uid}-${field}-error` : undefined,
  });

  return (
    <Modal title={task ? "Editar tarefa" : "Nova tarefa"} onClose={onClose}>
      <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor={`${uid}-title`} className={labelCls}>
                Título <span aria-hidden className="text-red-500">*</span>
              </label>
              <span
                className={cx(
                  "text-xs tabular-nums",
                  title.length > TITLE_MAX ? "text-red-600 dark:text-red-400" : "text-zinc-400",
                )}
              >
                {title.length}/{TITLE_MAX}
              </span>
            </div>
            <input
              id={`${uid}-title`}
              name="title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
              }}
              required
              autoFocus
              autoComplete="off"
              placeholder="O que precisa ser feito?"
              className={inputCls}
              {...aria("title")}
            />
            {err("title")}
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor={`${uid}-description`} className={labelCls}>
                Descrição <span className="font-normal text-zinc-400">(Markdown)</span>
              </label>
              <button
                type="button"
                aria-pressed={preview}
                onClick={() => setPreview((v) => !v)}
                className="rounded text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {preview ? "Editar" : "Pré-visualizar"}
              </button>
            </div>
            {preview ? (
              <div className="min-h-[6.5rem] rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
                {description.trim() ? (
                  <Markdown>{description}</Markdown>
                ) : (
                  <p className="text-zinc-400">Nada para pré-visualizar.</p>
                )}
              </div>
            ) : (
              <textarea
                id={`${uid}-description`}
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={DESCRIPTION_MAX}
                placeholder="Detalhes, contexto, links… Aceita **negrito**, listas e `código`."
                className={cx(inputCls, "h-auto resize-y py-2")}
                {...aria("description")}
              />
            )}
            {err("description")}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={`${uid}-assignee`} className={labelCls}>
                Responsável
              </label>
              <input
                id={`${uid}-assignee`}
                name="assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                list={`${uid}-assignees`}
                maxLength={ASSIGNEE_MAX}
                autoComplete="off"
                placeholder="Nome do funcionário (opcional)"
                className={inputCls}
                {...aria("assignee")}
              />
              <datalist id={`${uid}-assignees`}>
                {assignees.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
              {err("assignee")}
            </div>
            <div>
              <label htmlFor={`${uid}-status`} className={labelCls}>
                Status
              </label>
              <select
                id={`${uid}-status`}
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-priority`} className={labelCls}>
                Prioridade
              </label>
              <select
                id={`${uid}-priority`}
                name="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={inputCls}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-category`} className={labelCls}>
                Categoria / Projeto
              </label>
              <input
                id={`${uid}-category`}
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list={`${uid}-categories`}
                maxLength={CATEGORY_MAX}
                autoComplete="off"
                placeholder="Ex.: Produto"
                className={inputCls}
                {...aria("category")}
              />
              <datalist id={`${uid}-categories`}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {err("category")}
            </div>
            <div>
              <label htmlFor={`${uid}-dueDate`} className={labelCls}>
                Prazo
              </label>
              <input
                id={`${uid}-dueDate`}
                name="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputCls}
                {...aria("dueDate")}
              />
              {err("dueDate")}
            </div>
          </div>

          <fieldset>
            <legend className={labelCls}>
              Subtarefas
              {subtasks.length > 0 && (
                <span className="ml-2 font-normal text-zinc-400">
                  {subtasks.filter((s) => s.completed).length}/{subtasks.length}
                </span>
              )}
            </legend>
            {subtasks.length > 0 && (
              <ul className="mb-2 space-y-1.5">
                {subtasks.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={s.completed}
                      aria-label={`Concluir subtarefa ${i + 1}`}
                      onChange={() =>
                        setSubtasks((prev) =>
                          prev.map((x) => (x.id === s.id ? { ...x, completed: !x.completed } : x)),
                        )
                      }
                      className="size-4 shrink-0 accent-indigo-600"
                    />
                    <input
                      value={s.title}
                      aria-label={`Título da subtarefa ${i + 1}`}
                      maxLength={TITLE_MAX}
                      onChange={(e) =>
                        setSubtasks((prev) =>
                          prev.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)),
                        )
                      }
                      className={cx(inputCls, "h-8", s.completed && "text-zinc-400 line-through")}
                    />
                    <IconButton
                      label={`Remover subtarefa ${i + 1}`}
                      onClick={() => setSubtasks((prev) => prev.filter((x) => x.id !== s.id))}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                name="subtasks"
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSubtask();
                  }
                }}
                maxLength={TITLE_MAX}
                placeholder="Adicionar subtarefa e pressionar Enter"
                aria-label="Nova subtarefa"
                className={cx(inputCls, "h-8")}
                {...aria("subtasks")}
              />
              <button type="button" onClick={addSubtask} className={cx(btnGhost, "h-8 px-2.5")}>
                <Plus className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">Adicionar</span>
              </button>
            </div>
            {err("subtasks")}
          </fieldset>
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <button type="button" onClick={onClose} className={btnGhost}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {task ? "Salvar alterações" : "Criar tarefa"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
