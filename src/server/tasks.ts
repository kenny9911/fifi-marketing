import type {
  ChatMessageDto,
  ImageArtifactDto,
  PipelineStage,
  PromptPackDto,
  TaskBrief,
  TaskDetail,
  TaskEventDto,
  TaskEventType,
  TaskStatus,
  TaskSummary,
  UsageTotals,
} from "@/lib/api-types";
import type { PlatformId } from "@/lib/types";
import type { FinalResult } from "@/lib/results";
import { ApiError, type UserRow } from "@/server/auth";
import { db } from "@/server/db";
import { presignedGetUrl } from "@/server/minio";

export interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  brief_json: string;
  status: TaskStatus;
  stage: PipelineStage | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Loads a task and enforces ownership — other users' tasks look like 404s. */
export function getOwnedTask(taskId: string, user: UserRow): TaskRow {
  const row = db
    .prepare<unknown[], TaskRow>("SELECT * FROM tasks WHERE id = ?")
    .get(taskId);
  if (!row || row.user_id !== user.id) {
    throw new ApiError(404, "任务不存在");
  }
  return row;
}

export function parseBrief(row: TaskRow): TaskBrief {
  try {
    const brief = JSON.parse(row.brief_json) as TaskBrief;
    return { ...brief, platforms: Array.isArray(brief.platforms) ? brief.platforms : [] };
  } catch {
    return { goal: "", audience: "", platforms: [], style: "", materials: "" };
  }
}

export function taskUsageTotals(taskId: string): UsageTotals {
  const row = db
    .prepare<unknown[], { calls: number; pt: number; ct: number; cost: number }>(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(prompt_tokens), 0) AS pt,
              COALESCE(SUM(completion_tokens), 0) AS ct,
              COALESCE(SUM(cost_usd), 0) AS cost
         FROM llm_calls WHERE task_id = ?`,
    )
    .get(taskId);
  return {
    calls: row?.calls ?? 0,
    promptTokens: row?.pt ?? 0,
    completionTokens: row?.ct ?? 0,
    costUsd: row?.cost ?? 0,
  };
}

export interface EventRow {
  seq: number;
  ts: string;
  type: TaskEventType;
  agent_id: string | null;
  title: string;
  detail_json: string;
  agent_name: string | null;
}

export function eventRowToDto(row: EventRow): TaskEventDto {
  let detail: TaskEventDto["detail"];
  try {
    detail = JSON.parse(row.detail_json) as TaskEventDto["detail"];
  } catch {
    detail = {};
  }
  return {
    seq: row.seq,
    ts: row.ts,
    type: row.type,
    agentId: row.agent_id ?? undefined,
    agentName: row.agent_name ?? undefined,
    title: row.title,
    detail,
  };
}

export function listEventDtos(taskId: string, afterSeq = 0): TaskEventDto[] {
  const rows = db
    .prepare<unknown[], EventRow>(
      `SELECT e.seq, e.ts, e.type, e.agent_id, e.title, e.detail_json, a.name AS agent_name
         FROM task_events e LEFT JOIN agents a ON a.id = e.agent_id
        WHERE e.task_id = ? AND e.seq > ?
        ORDER BY e.seq`,
    )
    .all(taskId, afterSeq);
  return rows.map(eventRowToDto);
}

interface MessageRow {
  id: string;
  role: "user" | "ai" | "system";
  text: string;
  meta_json: string;
  created_at: string;
}

export function listMessageDtos(taskId: string): ChatMessageDto[] {
  const rows = db
    .prepare<unknown[], MessageRow>(
      "SELECT id, role, text, meta_json, created_at FROM messages WHERE task_id = ? ORDER BY created_at, rowid",
    )
    .all(taskId);
  return rows.map((m) => {
    let meta: Record<string, unknown> | undefined;
    try {
      meta = JSON.parse(m.meta_json) as Record<string, unknown>;
    } catch {
      meta = undefined;
    }
    return { id: m.id, role: m.role, text: m.text, meta, createdAt: m.created_at };
  });
}

interface ArtifactRow {
  id: string;
  platform: string | null;
  type: string;
  version: number;
  content_json: string;
  created_at: string;
}

function parseContent(row: ArtifactRow): Record<string, unknown> {
  try {
    const v = JSON.parse(row.content_json) as unknown;
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function latestFinals(taskId: string): Partial<Record<PlatformId, FinalResult>> {
  const rows = db
    .prepare<unknown[], ArtifactRow>(
      `SELECT a.* FROM artifacts a
        WHERE a.task_id = ? AND a.type = 'final' AND a.platform IS NOT NULL
          AND a.version = (
            SELECT MAX(b.version) FROM artifacts b
             WHERE b.task_id = a.task_id AND b.type = 'final' AND b.platform = a.platform
          )`,
    )
    .all(taskId);
  const finals: Partial<Record<PlatformId, FinalResult>> = {};
  for (const row of rows) {
    const content: unknown = parseContent(row);
    finals[row.platform as PlatformId] = content as FinalResult;
  }
  return finals;
}

async function imageDtos(taskId: string): Promise<ImageArtifactDto[]> {
  const rows = db
    .prepare<unknown[], ArtifactRow>(
      "SELECT * FROM artifacts WHERE task_id = ? AND type = 'image' ORDER BY created_at",
    )
    .all(taskId);
  const images: ImageArtifactDto[] = [];
  for (const row of rows) {
    const content = parseContent(row);
    const key = [content.key, content.minioKey, content.objectKey].find(
      (k): k is string => typeof k === "string" && k.length > 0,
    );
    let url = "";
    if (key) {
      try {
        url = await presignedGetUrl(key);
      } catch (err) {
        console.warn(`[tasks] presign failed for ${key}: ${err}`);
      }
    }
    images.push({
      id: row.id,
      platform: (row.platform as PlatformId | null) ?? null,
      url,
      prompt: typeof content.prompt === "string" ? content.prompt : "",
      model: typeof content.model === "string" ? content.model : "",
      createdAt: row.created_at,
    });
  }
  return images;
}

function promptPackDtos(taskId: string): PromptPackDto[] {
  const rows = db
    .prepare<unknown[], ArtifactRow>(
      "SELECT * FROM artifacts WHERE task_id = ? AND type = 'prompt_pack' ORDER BY created_at, version",
    )
    .all(taskId);
  return rows.map((row) => {
    const content = parseContent(row);
    const kind = content.kind === "image" || content.kind === "video" ? content.kind : "text";
    return {
      id: row.id,
      platform: (row.platform as PlatformId | null) ?? null,
      kind,
      prompt: typeof content.prompt === "string" ? content.prompt : "",
      rationale: typeof content.rationale === "string" ? content.rationale : "",
      targetModel: typeof content.targetModel === "string" ? content.targetModel : undefined,
      createdAt: row.created_at,
    };
  });
}

export function buildTaskSummary(row: TaskRow, usage?: UsageTotals): TaskSummary {
  const totals = usage ?? taskUsageTotals(row.id);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    stage: row.stage ?? null,
    platforms: parseBrief(row).platforms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    costUsd: totals.costUsd,
    tokens: totals.promptTokens + totals.completionTokens,
  };
}

/** Full restore payload for the studio (messages + events + finals, req 6). */
export async function buildTaskDetail(row: TaskRow): Promise<TaskDetail> {
  return {
    ...buildTaskSummary(row),
    brief: parseBrief(row),
    messages: listMessageDtos(row.id),
    events: listEventDtos(row.id),
    finals: latestFinals(row.id),
    images: await imageDtos(row.id),
    promptPacks: promptPackDtos(row.id),
    error: row.error ?? undefined,
  };
}
