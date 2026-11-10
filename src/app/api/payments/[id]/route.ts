import { NextResponse } from "next/server";
import { PaymentInputSchema, PaymentSchema } from "@/lib/payment-schema";
import { requireAuth } from "@/lib/server/auth";
import { handle, jsonError } from "@/lib/server/http";
import { getPaymentStore } from "@/lib/server/payment-store";

type Context = { params: Promise<{ id: string }> };

/** Campos opcionais podem ser apagados enviando `null`. */
const PatchSchema = PaymentInputSchema.partial().extend({
  competence: PaymentInputSchema.shape.competence.nullable(),
  issueDate: PaymentInputSchema.shape.issueDate.nullable(),
  dueDate: PaymentInputSchema.shape.dueDate.nullable(),
  paidDate: PaymentInputSchema.shape.paidDate.nullable(),
  amount: PaymentInputSchema.shape.amount.nullable(),
  titleNumber: PaymentInputSchema.shape.titleNumber.nullable(),
  notes: PaymentInputSchema.shape.notes.nullable(),
});

export function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    await requireAuth();
    const { id } = await params;
    const patch = PatchSchema.parse(await request.json());
    const store = getPaymentStore();
    const current = await store.get(id);
    if (!current) return jsonError("Lançamento não encontrado.", 404);

    const merged: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete merged[k];
      else if (v !== undefined) merged[k] = v;
    }
    const next = PaymentSchema.parse({ ...merged, id, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    await store.putMany([next]);
    return NextResponse.json(next);
  });
}

export function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    await requireAuth();
    const { id } = await params;
    await getPaymentStore().deleteMany([id]);
    return new NextResponse(null, { status: 204 });
  });
}
