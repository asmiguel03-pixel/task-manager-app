"use client";

import { useId, useState } from "react";
import { ListChecks, Lock } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { btnPrimary, cx, inputCls } from "./ui";

export function LoginScreen({ onLogin }: { onLogin: (password: string) => Promise<string | null> }) {
  const uid = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return setError("Digite a senha.");
    setBusy(true);
    const message = await onLogin(password);
    setBusy(false);
    if (message) {
      setError(message);
      setPassword("");
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <form
        onSubmit={submit}
        noValidate
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <ListChecks className="size-5" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Tarefas</h1>
        </div>
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Este quadro é protegido. Digite a senha para entrar.
        </p>
        <label htmlFor={`${uid}-password`} className="mt-5 mb-1 block text-sm font-medium">
          Senha
        </label>
        <input
          id={`${uid}-password`}
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          autoFocus
          autoComplete="current-password"
          aria-invalid={!!error}
          aria-describedby={error ? `${uid}-error` : undefined}
          className={inputCls}
        />
        {error && (
          <p id={`${uid}-error`} role="alert" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={cx(btnPrimary, "mt-5 w-full")}>
          <Lock className="size-4" aria-hidden />
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
