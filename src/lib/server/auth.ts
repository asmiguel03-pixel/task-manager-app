import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Proteção por senha única (variável APP_PASSWORD). Sem a variável, o acesso é livre.
 * A sessão é um cookie httpOnly assinado (HMAC); trocar a senha invalida todas as sessões.
 */
export const SESSION_COOKIE = "tm_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

export class UnauthorizedError extends Error {}

const password = () => process.env.APP_PASSWORD || null;

export const authRequired = () => password() !== null;

const digest = (value: string) => createHash("sha256").update(value).digest();

const sign = (payload: string, secret: string) =>
  createHmac("sha256", digest(`task-manager:${secret}`)).update(payload).digest("base64url");

/** Comparação em tempo constante (sobre hashes, para não vazar o tamanho). */
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function checkPassword(attempt: string): boolean {
  const expected = password();
  return expected !== null && safeEqual(attempt, expected);
}

function isValidToken(token: string | undefined, now = Date.now()): boolean {
  const secret = password();
  if (!secret || !token) return false;
  const [exp, signature] = token.split(".");
  if (!exp || !signature || !/^\d+$/.test(exp)) return false;
  return safeEqual(signature, sign(exp, secret)) && Number(exp) > now;
}

export async function isAuthenticated(): Promise<boolean> {
  if (!authRequired()) return true;
  return isValidToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) throw new UnauthorizedError();
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;

export async function startSession(): Promise<void> {
  const secret = password();
  if (!secret) return;
  const exp = String(Date.now() + MAX_AGE_S * 1000);
  (await cookies()).set(SESSION_COOKIE, `${exp}.${sign(exp, secret)}`, {
    ...cookieOptions,
    maxAge: MAX_AGE_S,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

// ---------- Limite de tentativas (por instância do servidor) ----------

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;
const failures = new Map<string, { count: number; resetAt: number }>();

export function isBlocked(client: string, now = Date.now()): boolean {
  const entry = failures.get(client);
  if (entry && entry.resetAt <= now) failures.delete(client);
  return (failures.get(client)?.count ?? 0) >= MAX_FAILURES;
}

export function recordFailure(client: string, now = Date.now()): void {
  const entry = failures.get(client);
  if (entry && entry.resetAt > now) entry.count += 1;
  else failures.set(client, { count: 1, resetAt: now + WINDOW_MS });
}

export const clearFailures = (client: string) => void failures.delete(client);
