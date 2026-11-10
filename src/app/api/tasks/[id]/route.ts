import { NextResponse } from "next/server";
import { handle, jsonError } from "@/lib/server/http";
import { getTaskStore } from "@/lib/server/task-store";
import { patchTask } from "@/lib/task-domain";
import { TaskInputSchema } from "@/lib/task-schema";

type Context = { params: Promise<{ id: string }> };

export function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const patch = TaskInputSchema.partial().parse(await request.json());
    const store = getTaskStore();
    const current = await store.get(id);
    if (!current) return jsonError("Tarefa não encontrada.", 404);
    const next = patchTask(current, patch);
    await store.put(next);
    return NextResponse.json(next);
  });
}

export function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await getTaskStore().delete(id);
    return new NextResponse(null, { status: 204 });
  });
}
