import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { ApiError, handle, readJson, requireAdmin } from "@/server/auth";
import type { AgentDto } from "@/lib/api-types";

interface AgentListRow {
  id: string;
  name: string;
  role_title: string;
  description: string;
  model_id: string;
  fallback_model_id: string | null;
  tools_json: string;
  enabled: number;
  active_prompt_version: number | null;
  prompt_count: number;
}

const AGENT_LIST_SQL = `
  SELECT a.*,
         (SELECT version FROM prompts
           WHERE agent_id = a.id AND status = 'active'
           ORDER BY version DESC LIMIT 1) AS active_prompt_version,
         (SELECT COUNT(*) FROM prompts WHERE agent_id = a.id) AS prompt_count
  FROM agents a
  ORDER BY a.id`;

function toAgentDto(row: AgentListRow): AgentDto {
  let tools: string[] = [];
  try {
    const parsed = JSON.parse(row.tools_json) as unknown;
    if (Array.isArray(parsed)) tools = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    tools = [];
  }
  return {
    id: row.id,
    name: row.name,
    roleTitle: row.role_title,
    description: row.description,
    modelId: row.model_id,
    fallbackModelId: row.fallback_model_id ?? undefined,
    tools,
    enabled: row.enabled === 1,
    activePromptVersion: row.active_prompt_version ?? 0,
    promptCount: row.prompt_count,
  };
}

/** GET /api/admin/agents — full agent roster with active prompt versions (req 19). */
export const GET = handle(async () => {
  await requireAdmin();
  const rows = db.prepare(AGENT_LIST_SQL).all() as AgentListRow[];
  return NextResponse.json({ agents: rows.map(toAgentDto) });
});

const updateSchema = z.object({
  id: z.string().min(1, "缺少 agent id"),
  modelId: z.string().min(1).optional(),
  fallbackModelId: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
});

function assertKnownModel(modelId: string): void {
  const row = db.prepare("SELECT id FROM models WHERE id = ?").get(modelId);
  if (!row) throw new ApiError(400, `模型 ${modelId} 不在注册表中`);
}

/** PUT /api/admin/agents — {id, modelId?, fallbackModelId?, enabled?} (req 19). */
export const PUT = handle(async (req) => {
  await requireAdmin();
  const body = updateSchema.parse(await readJson(req));

  const exists = db.prepare("SELECT id FROM agents WHERE id = ?").get(body.id);
  if (!exists) throw new ApiError(404, "agent 不存在");

  if (body.modelId !== undefined) assertKnownModel(body.modelId);
  if (body.fallbackModelId != null) assertKnownModel(body.fallbackModelId);

  const sets: string[] = [];
  const args: unknown[] = [];
  if (body.modelId !== undefined) {
    sets.push("model_id = ?");
    args.push(body.modelId);
  }
  if (body.fallbackModelId !== undefined) {
    sets.push("fallback_model_id = ?");
    args.push(body.fallbackModelId);
  }
  if (body.enabled !== undefined) {
    sets.push("enabled = ?");
    args.push(body.enabled ? 1 : 0);
  }
  if (sets.length === 0) throw new ApiError(400, "没有可更新的字段");

  db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).run(...args, body.id);

  const row = db
    .prepare(AGENT_LIST_SQL.replace("ORDER BY a.id", "WHERE a.id = ?"))
    .get(body.id) as AgentListRow;
  return NextResponse.json({ agent: toAgentDto(row) });
});
