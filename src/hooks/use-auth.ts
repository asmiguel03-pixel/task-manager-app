"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

const UNAUTHORIZED_EVENT = "task-manager:unauthorized";

/** `open`: o site não exige senha. */
export type AuthStatus = "loading" | "open" | "locked" | "authenticated";

const SessionSchema = z.object({ required: z.boolean(), authenticated: z.boolean() });
const ErrorSchema = z.object({ error: z.string() });

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (res) => SessionSchema.parse(await res.json()))
      .then((s) => alive && setStatus(!s.required ? "open" : s.authenticated ? "authenticated" : "locked"))
      // Se a verificação falhar, segue adiante: a API de tarefas ainda exige a sessão.
      .catch(() => alive && setStatus("open"));
    // Sessão expirada ou encerrada em outra aba: a API responde 401.
    const lock = () => setStatus("locked");
    window.addEventListener(UNAUTHORIZED_EVENT, lock);
    return () => {
      alive = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, lock);
    };
  }, []);

  /** Retorna a mensagem de erro, ou `null` em caso de sucesso. */
  const login = useCallback(async (password: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setStatus("authenticated");
        return null;
      }
      const parsed = ErrorSchema.safeParse(await res.json().catch(() => null));
      return parsed.success ? parsed.data.error : "Não foi possível entrar.";
    } catch {
      return "Sem conexão com o servidor. Tente novamente.";
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setStatus("locked");
  }, []);

  return { status, login, logout };
}
