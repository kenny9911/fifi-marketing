import { z } from "zod";
import type { ChatMessageDto } from "@/lib/api-types";
import { ApiError, handle, requireUser } from "@/server/auth";
import { db, nowIso, uid } from "@/server/db";
import { startRevision } from "@/server/pipeline/orchestrator";
import { getOwnedTask } from "@/server/tasks";

const bodySchema = z.object({
  text: z.string().trim().min(1, "消息不能为空"),
});

/**
 * POST /api/tasks/:id/message — stores the user message; on done/reviewing
 * tasks the text becomes a revision directive that fires a targeted
 * reedit → critic → review → finalize cycle across all platforms.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const task = getOwnedTask(id, user);

  const body = (await req.json().catch(() => {
    throw new ApiError(400, "无效的 JSON 请求体");
  })) as unknown;
  const { text } = bodySchema.parse(body);

  const now = nowIso();
  const messageId = uid();
  db.prepare(
    "INSERT INTO messages (id, task_id, role, text, meta_json, created_at) VALUES (?, ?, 'user', ?, '{}', ?)",
  ).run(messageId, task.id, text, now);
  db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(now, task.id);

  // Atomic claim: `task.status` was read before the `await req.json()` above,
  // so it can be stale by now. The guarded UPDATE flips done/reviewing →
  // running exactly once, so concurrent POSTs (e.g. a double-send) can't fire
  // two revision pipelines on the same task.
  let revision = false;
  if (task.status === "done" || task.status === "reviewing") {
    const claimed = db
      .prepare(
        "UPDATE tasks SET status = 'running', stage = 'reedit', error = NULL, updated_at = ? WHERE id = ? AND status IN ('done', 'reviewing')",
      )
      .run(nowIso(), task.id);
    if (claimed.changes === 1) {
      revision = true;
      startRevision(task.id, text);
    }
  }

  const message: ChatMessageDto = {
    id: messageId,
    role: "user",
    text,
    meta: {},
    createdAt: now,
  };
  return Response.json({ ok: true, revision, message });
});
