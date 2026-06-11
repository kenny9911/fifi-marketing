import { handle, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { buildTaskDetail, getOwnedTask } from "@/server/tasks";

/** GET /api/tasks/:id — full TaskDetail (messages + events + finals, req 6). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const task = getOwnedTask(id, user);
  return Response.json(await buildTaskDetail(task));
});

// Created lazily inside the handler: module scope runs during `next build`
// page-data collection, and touching the db there opens the SQLite file.
function deleteTask(taskId: string): void {
  db.transaction(() => {
    db.prepare("UPDATE files SET task_id = NULL WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM reviews WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM artifacts WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM task_events WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM messages WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  })();
}

/** DELETE /api/tasks/:id — remove the task and its derived rows (llm_calls kept for usage history). */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const task = getOwnedTask(id, user);
  deleteTask(task.id);
  return Response.json({ ok: true });
});
