import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { ApiError, handle, requireAdmin } from "@/server/auth";
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

/**
 * POST /api/admin/prompts/:id/activate — make this version the agent's active
 * prompt, retiring the previously-active one (single transaction; idempotent
 * when the version is already active). (req 19)
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;

  const row = db.prepare("SELECT * FROM prompts WHERE id = ?").get(id) as PromptRow | undefined;
  if (!row) throw new ApiError(404, "提示词版本不存在");

  if (row.status !== "active") {
    db.transaction(() => {
      db.prepare("UPDATE prompts SET status = 'retired' WHERE agent_id = ? AND status = 'active'").run(
        row.agent_id,
      );
      db.prepare("UPDATE prompts SET status = 'active' WHERE id = ?").run(id);
    })();
  }

  const fresh = db.prepare("SELECT * FROM prompts WHERE id = ?").get(id) as PromptRow;
  return NextResponse.json({ prompt: toPromptDto(fresh) });
});
