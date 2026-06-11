import { NextResponse } from "next/server";
import { z } from "zod";
import { db, nowIso, uid } from "@/server/db";
import { ApiError, handle, readJson, requireAdmin } from "@/server/auth";
import type { PromptVersionDto } from "@/lib/api-types";

/** Row shape of the `prompts` table (see src/server/schema.sql). */
interface PromptRow {
  id: string;
  agent_id: string;
  version: number;
  template: string;
  notes: string;
  status: "active" | "proposed" | "retired";
  score_avg: number | null;
  score_n: number;
  created_at: string;
}

function toPromptDto(row: PromptRow): PromptVersionDto {
  return {
    id: row.id,
    agentId: row.agent_id,
    version: row.version,
    template: row.template,
    notes: row.notes,
    status: row.status,
    scoreAvg: row.score_avg,
    scoreN: row.score_n,
    createdAt: row.created_at,
  };
}

function assertAgentExists(agentId: string): void {
  const row = db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId);
  if (!row) throw new ApiError(404, "agent 不存在");
}

/** GET /api/admin/agents/:id/prompts — all prompt versions for the agent, newest first (req 19). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  assertAgentExists(id);
  const rows = db
    .prepare("SELECT * FROM prompts WHERE agent_id = ? ORDER BY version DESC")
    .all(id) as PromptRow[];
  return NextResponse.json({ prompts: rows.map(toPromptDto) });
});

const createSchema = z.object({
  template: z.string().trim().min(1, "提示词模板不能为空"),
  notes: z.string().optional(),
  activate: z.boolean().optional(),
});

/**
 * POST /api/admin/agents/:id/prompts — {template, notes?, activate?} → new
 * version = max+1. Lands as 'proposed', or as 'active' (retiring the current
 * active version) when activate=true. (req 19)
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  assertAgentExists(id);
  const body = createSchema.parse(await readJson(req));

  const promptId = uid();
  db.transaction(() => {
    const maxV = (
      db
        .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM prompts WHERE agent_id = ?")
        .get(id) as { v: number }
    ).v;
    if (body.activate) {
      db.prepare("UPDATE prompts SET status = 'retired' WHERE agent_id = ? AND status = 'active'").run(id);
    }
    db.prepare(
      `INSERT INTO prompts (id, agent_id, version, template, notes, status, score_avg, score_n, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
    ).run(
      promptId,
      id,
      maxV + 1,
      body.template,
      body.notes ?? "",
      body.activate ? "active" : "proposed",
      nowIso(),
    );
  })();

  const row = db.prepare("SELECT * FROM prompts WHERE id = ?").get(promptId) as PromptRow;
  return NextResponse.json({ prompt: toPromptDto(row) }, { status: 201 });
});
