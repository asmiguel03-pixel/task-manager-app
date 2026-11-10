import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { newId } from "@/lib/task-domain";
import { PaymentInputSchema, PaymentSheetSchema, type Payment } from "@/lib/payment-schema";
import { requireAuth } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { getPaymentStore } from "@/lib/server/payment-store";

export function GET() {
  return handle(async () => {
    await connection();
    await requireAuth();
    const list = await getPaymentStore().all();
    return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
  });
}

const CreateSchema = z.object({
  entries: z.array(PaymentInputSchema).min(1).max(1000),
  /** Substitui os lançamentos existentes destes meses (importação). */
  replace: z
    .array(z.object({ sheet: PaymentSheetSchema, month: z.string().regex(/^\d{4}-\d{2}$/) }))
    .max(60)
    .optional(),
});

export function POST(request: Request) {
  return handle(async () => {
    await requireAuth();
    const body = CreateSchema.parse(await request.json());
    const store = getPaymentStore();
    const now = new Date().toISOString();
    const created: Payment[] = body.entries.map((input) => ({ ...input, id: newId(), createdAt: now, updatedAt: now }));

    if (body.replace?.length) {
      const keys = new Set(body.replace.map((r) => `${r.sheet}|${r.month}`));
      const old = (await store.all()).filter((p) => keys.has(`${p.sheet}|${p.month}`)).map((p) => p.id);
      await store.deleteMany(old);
    }
    await store.putMany(created);
    return NextResponse.json(created, { status: 201 });
  });
}
