import type { PipelineStage, TaskEventType, TaskStatus } from "@/lib/api-types";
import { db, nowIso } from "@/server/db";

/**
 * Append a row to the task_events stream (powers the SSE thinking timeline)
 * and mirror it to the server log as a single line.
 */
export function emitEvent(
  taskId: string,
  evt: { type: TaskEventType; agentId?: string; title: string; detail?: object },
): void {
  const ts = nowIso();
  db.prepare(
    "INSERT INTO task_events (task_id, ts, type, agent_id, title, detail_json) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(taskId, ts, evt.type, evt.agentId ?? null, evt.title, JSON.stringify(evt.detail ?? {}));
  const agent = evt.agentId ? `(${evt.agentId})` : "";
  console.log(`[task ${taskId}] ${evt.type}${agent}: ${evt.title.replace(/\s+/g, " ")}`);
}

/**
 * Update the task row's status/stage/error. `stage`/`error` are only written
 * when explicitly provided (pass `null` to clear the stage).
 */
export function setTaskStatus(
  taskId: string,
  status: TaskStatus,
  stage?: PipelineStage | null,
  error?: string,
): void {
  const sets = ["status = ?", "updated_at = ?"];
  const args: unknown[] = [status, nowIso()];
  if (stage !== undefined) {
    sets.push("stage = ?");
    args.push(stage);
  }
  if (error !== undefined) {
    sets.push("error = ?");
    args.push(error);
  }
  args.push(taskId);
  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...args);
}
