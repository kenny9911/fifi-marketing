import { z } from "zod";
import { ApiError, handle, requireUser } from "@/server/auth";
import { generateImage } from "@/server/images";
import { db } from "@/server/db";

const bodySchema = z.object({
  taskId: z.string().min(1),
  platform: z.enum(["xhs", "dy", "mp", "wb", "zh", "bjh", "csdn"]).nullable().optional(),
  hint: z.string().max(2000).optional(),
});

/** POST /api/images/generate — {taskId, platform, hint?} → ImageArtifactDto (req 8). */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();

  const raw = await req.json().catch(() => {
    throw new ApiError(400, "请求体不是合法 JSON");
  });
  const body = bodySchema.parse(raw);

  const task = db
    .prepare("SELECT id, user_id FROM tasks WHERE id = ?")
    .get(body.taskId) as { id: string; user_id: string } | undefined;
  if (!task) throw new ApiError(404, "任务不存在");
  if (task.user_id !== user.id && user.role !== "admin") {
    throw new ApiError(403, "无权操作该任务");
  }

  const image = await generateImage({
    taskId: body.taskId,
    userId: user.id,
    platform: body.platform ?? null,
    hint: body.hint,
  });
  return Response.json(image);
});
