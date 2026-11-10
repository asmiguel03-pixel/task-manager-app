import { NextResponse } from "next/server";
import { z } from "zod";
import {
  checkPassword,
  clearFailures,
  isBlocked,
  recordFailure,
  startSession,
} from "@/lib/server/auth";
import { handle, jsonError } from "@/lib/server/http";

const BodySchema = z.object({ password: z.string().max(200) });

export function POST(request: Request) {
  return handle(async () => {
    const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (isBlocked(client)) {
      return jsonError("Muitas tentativas. Aguarde alguns minutos e tente de novo.", 429);
    }
    const { password } = BodySchema.parse(await request.json());
    if (!checkPassword(password)) {
      recordFailure(client);
      // Atraso fixo para desencorajar tentativas em série.
      await new Promise((resolve) => setTimeout(resolve, 500));
      return jsonError("Senha incorreta.", 401);
    }
    clearFailures(client);
    await startSession();
    return NextResponse.json({ ok: true });
  });
}
