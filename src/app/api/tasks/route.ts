import { z } from "zod";
import { ApiError, handle, requireUser } from "@/server/auth";
import { db, nowIso, uid } from "@/server/db";
import {
  buildTaskDetail,
  buildTaskSummary,
  getOwnedTask,
  type TaskRow,
} from "@/server/tasks";

const PLATFORM_IDS = ["xhs", "dy", "mp", "wb", "zh", "bjh", "csdn"] as const;

const briefSchema = z.object({
  goal: z.string().trim().min(1, "目标不能为空"),
  audience: z.string().default(""),
  platforms: z.array(z.enum(PLATFORM_IDS)).default([]),
  style: z.string().default(""),
  materials: z.string().default(""),
  notes: z.string().optional(),
  fileIds: z.array(z.string()).optional(),
});

interface SummaryRow extends TaskRow {
  cost_usd: number;
  tokens: number;
}

/** GET /api/tasks — the user's own tasks with per-task cost/tokens. */
export const GET = handle(async () => {
  const user = await requireUser();
  const rows = db
    .prepare<unknown[], SummaryRow>(
      `SELECT t.*,
              COALESCE((SELECT SUM(c.cost_usd) FROM llm_calls c WHERE c.task_id = t.id), 0) AS cost_usd,
              COALESCE((SELECT SUM(c.prompt_tokens + c.completion_tokens) FROM llm_calls c WHERE c.task_id = t.id), 0) AS tokens
         FROM tasks t
        WHERE t.user_id = ?
        ORDER BY t.updated_at DESC`,
    )
    .all(user.id);
  return Response.json(
    rows.map((row) =>
      buildTaskSummary(row, {
        calls: 0,
        promptTokens: row.tokens,
        completionTokens: 0,
        costUsd: row.cost_usd,
      }),
    ),
  );
});

/** POST /api/tasks — create a task in `briefing` from a (partial) brief. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => {
    throw new ApiError(400, "无效的 JSON 请求体");
  })) as { brief?: unknown };
  const brief = briefSchema.parse(body?.brief ?? {});

  const id = uid();
  const now = nowIso();
  const title = [...brief.goal].slice(0, 24).join("");

  db.prepare(
    "INSERT INTO tasks (id, user_id, title, brief_json, status, stage, error, created_at, updated_at) VALUES (?, ?, ?, ?, 'briefing', NULL, NULL, ?, ?)",
  ).run(id, user.id, title, JSON.stringify(brief), now, now);
  db.prepare(
    "INSERT INTO messages (id, task_id, role, text, meta_json, created_at) VALUES (?, ?, 'system', ?, '{}', ?)",
  ).run(uid(), id, "任务已创建。完善简报（目标 + 至少一个平台）后即可开始生成。", now);

  return Response.json(await buildTaskDetail(getOwnedTask(id, user)));
});
