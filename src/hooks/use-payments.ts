"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { PaymentSchema, type Payment, type PaymentInput, type PaymentSheet } from "@/lib/payment-schema";

const UNAUTHORIZED_EVENT = "task-manager:unauthorized";
const POLL_MS = 6000;

/** Alteração parcial; `null` apaga o campo. */
export type PaymentPatch = { [K in keyof PaymentInput]?: PaymentInput[K] | null };

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/payments${path}`, {
    ...init,
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new Error("Sessão expirada. Entre novamente.");
  }
  if (res.status === 503) {
    throw new Error("Banco de dados não configurado no servidor: o controle de pagamentos precisa dele para salvar.");
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const parsed = z.object({ error: z.string() }).safeParse(body);
    throw new Error(parsed.success ? parsed.data.error : `Erro ${res.status}`);
  }
  return res.status === 204 ? undefined : res.json();
}

const ListSchema = z.array(PaymentSchema);

export function usePayments() {
  const [entries, setEntries] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      request("")
        .then((data) => {
          if (!alive) return;
          const list = ListSchema.parse(data);
          setEntries((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Erro ao carregar."))
        .finally(() => alive && setLoading(false));
    load();
    const tick = () => document.visibilityState === "visible" && load();
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const run = useCallback(async <T,>(op: () => Promise<T>): Promise<T | undefined> => {
    try {
      const r = await op();
      setError(null);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar. Tente novamente.");
      return undefined;
    }
  }, []);

  const createMany = useCallback(
    (inputs: PaymentInput[], replace?: { sheet: PaymentSheet; month: string }[]) =>
      run(async () => {
        const created = ListSchema.parse(await request("", { method: "POST", body: JSON.stringify({ entries: inputs, replace }) }));
        const keys = new Set((replace ?? []).map((r) => `${r.sheet}|${r.month}`));
        setEntries((prev) => [...prev.filter((p) => !keys.has(`${p.sheet}|${p.month}`)), ...created]);
        return created;
      }),
    [run],
  );

  const update = useCallback(
    (id: string, patch: PaymentPatch) =>
      run(async () => {
        const next = PaymentSchema.parse(
          await request(`/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
        );
        setEntries((prev) => prev.map((p) => (p.id === id ? next : p)));
        return next;
      }),
    [run],
  );

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
        setEntries((prev) => prev.filter((p) => p.id !== id));
        return true;
      }),
    [run],
  );

  return { entries, loading, error, dismissError: () => setError(null), createMany, update, remove };
}
