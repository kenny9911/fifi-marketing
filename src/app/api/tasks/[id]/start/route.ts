import type { TaskBrief } from "@/lib/api-types";
import { ApiError, handle, requireUser } from "@/server/auth";
import { db, nowIso } from "@/server/db";
import { startPipeline } from "@/server/pipeline/orchestrator";
import { getOwnedTask, parseBrief } from "@/server/tasks";

/**
 * POST /api/tasks/:id/start — validates the brief, merges extracted file
 * texts into the materials context, flips the task to running and fires the
 * pipeline without awaiting it (202).
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const task = getOwnedTask(id, user);

  if (task.status === "running") {
    throw new ApiError(409, "任务正在运行中");
  }

  const brief: TaskBrief = parseBrief(task);
  if (!brief.goal?.trim()) {
    throw new ApiError(400, "简报不完整：请先填写目标");
  }
  if (!Array.isArray(brief.platforms) || brief.platforms.length === 0) {
    throw new ApiError(400, "简报不完整：请至少选择一个平台");
  }

  // Merge extracted file texts into the brief's materials context (req 7).
  if (brief.fileIds?.length) {
    const stmt = db.prepare<unknown[], { name: string; extracted_text: string | null }>(
      "SELECT name, extracted_text FROM files WHERE id = ? AND user_id = ?",
    );
    const parts: string[] = [];
    for (const fileId of brief.fileIds) {
      const file = stmt.get(fileId, user.id);
      if (file?.extracted_text?.trim()) {
        parts.push(`【上传素材 · ${file.name}】\n${file.extracted_text.slice(0, 8_000)}`);
      }
    }
    if (parts.length) {
      brief.materials = [brief.materials?.trim(), ...parts].filter(Boolean).join("\n\n");
      db.prepare("UPDATE tasks SET brief_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(brief),
        nowIso(),
        task.id,
      );
    }
  }

  db.prepare(
    "UPDATE tasks SET status = 'running', stage = 'search', error = NULL, updated_at = ? WHERE id = ?",
  ).run(nowIso(), task.id);
  startPipeline(task.id);

  return Response.json({ ok: true, status: "running" }, { status: 202 });
});
