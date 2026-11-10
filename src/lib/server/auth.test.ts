import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

import {
  authRequired,
  checkPassword,
  clearFailures,
  endSession,
  isAuthenticated,
  isBlocked,
  recordFailure,
  requireAuth,
  SESSION_COOKIE,
  startSession,
  UnauthorizedError,
} from "./auth";

beforeEach(() => {
  jar.clear();
  vi.stubEnv("APP_PASSWORD", "segredo");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("senha única", () => {
  it("sem APP_PASSWORD o acesso é livre", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect(authRequired()).toBe(false);
    expect(await isAuthenticated()).toBe(true);
    expect(checkPassword("")).toBe(false);
  });

  it("confere a senha", () => {
    expect(checkPassword("segredo")).toBe(true);
    expect(checkPassword("Segredo")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });

  it("exige sessão, aceita cookie válido e encerra no logout", async () => {
    expect(await isAuthenticated()).toBe(false);
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);

    await startSession();
    expect(await isAuthenticated()).toBe(true);

    await endSession();
    expect(await isAuthenticated()).toBe(false);
  });

  it("rejeita cookie adulterado, expirado ou de outra senha", async () => {
    await startSession();
    const token = jar.get(SESSION_COOKIE)!;
    const [exp, signature] = token.split(".");

    jar.set(SESSION_COOKIE, `${Number(exp) + 1000}.${signature}`);
    expect(await isAuthenticated()).toBe(false);
    jar.set(SESSION_COOKIE, "lixo");
    expect(await isAuthenticated()).toBe(false);

    jar.set(SESSION_COOKIE, token);
    vi.stubEnv("APP_PASSWORD", "outra");
    expect(await isAuthenticated()).toBe(false);

    vi.stubEnv("APP_PASSWORD", "segredo");
    expect(await isAuthenticated()).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await isAuthenticated()).toBe(false);
  });

  it("bloqueia após muitas falhas e libera depois da janela", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 7; i++) recordFailure("ip", t0);
    expect(isBlocked("ip", t0)).toBe(false);
    recordFailure("ip", t0);
    expect(isBlocked("ip", t0)).toBe(true);
    expect(isBlocked("outro", t0)).toBe(false);
    expect(isBlocked("ip", t0 + 11 * 60 * 1000)).toBe(false);

    for (let i = 0; i < 8; i++) recordFailure("ip2", t0);
    clearFailures("ip2");
    expect(isBlocked("ip2", t0)).toBe(false);
  });
});
