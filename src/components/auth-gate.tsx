"use client";

import { useAuth } from "@/hooks/use-auth";
import { LoginScreen } from "./login-screen";
import { TaskApp } from "./task-app";

export function AuthGate() {
  const { status, login, logout } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true" aria-label="Carregando">
        <div className="size-8 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-600 dark:border-zinc-700" />
      </div>
    );
  }
  if (status === "locked") return <LoginScreen onLogin={login} />;
  return <TaskApp onLogout={status === "authenticated" ? logout : undefined} />;
}
