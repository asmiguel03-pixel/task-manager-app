import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "./auth";
import { StoreNotConfiguredError } from "./task-store";

export const jsonError = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

/** Converte exceções em respostas JSON consistentes. */
export async function handle(op: () => Promise<Response>): Promise<Response> {
  try {
    return await op();
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError("Autenticação necessária.", 401);
    if (e instanceof ZodError) {
      return jsonError(e.issues[0]?.message ?? "Dados inválidos.", 400);
    }
    if (e instanceof SyntaxError) return jsonError("JSON inválido.", 400);
    if (e instanceof StoreNotConfiguredError) return jsonError(e.message, 503);
    console.error(e);
    return jsonError("Erro interno ao acessar os dados.", 500);
  }
}
