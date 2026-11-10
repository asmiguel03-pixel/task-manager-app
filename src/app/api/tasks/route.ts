import { connection, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { getTaskStore } from "@/lib/server/task-store";
import { buildTask } from "@/lib/task-domain";
import { TaskInputSchema } from "@/lib/task-schema";

export function GET() {
  return handle(async () => {
    await connection();
    await requireAuth();
    const tasks = await getTaskStore().all();
    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json(tasks, { headers: { "Cache-Control": "no-store" } });
  });
}

export function POST(request: Request) {
  return handle(async () => {
    await requireAuth();
    const task = buildTask(TaskInputSchema.parse(await request.json()));
    await getTaskStore().put(task);
    return NextResponse.json(task, { status: 201 });
  });
}
