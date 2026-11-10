import { connection, NextResponse } from "next/server";
import { authRequired, isAuthenticated } from "@/lib/server/auth";

export async function GET() {
  // Depende do ambiente e do cookie em tempo de execução: nunca pré-renderizar.
  await connection();
  return NextResponse.json(
    { required: authRequired(), authenticated: await isAuthenticated() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
