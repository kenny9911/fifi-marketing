import { handle, requireUser } from "@/server/auth";
import { setTaskStatus } from "@/server/pipeline/events";
import { getOwnedTask } from "@/server/tasks";

/**
 * POST /api/tasks/:id/cancel — flips the task to cancelled; the orchestrator
 * notices between stages, emits the cancellation event and stops.
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const task = getOwnedTask(id, user);

  if (task.status !== "cancelled") {
    setTaskStatus(task.id, "cancelled", null);
  }
  return Response.json({ ok: true, status: "cancelled" });
});
