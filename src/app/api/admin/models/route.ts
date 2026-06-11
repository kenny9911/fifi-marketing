import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { handle, readJson, requireAdmin } from "@/server/auth";
import type { ModelRow } from "@/server/llm/router";
import type { ModelDto } from "@/lib/api-types";

function toModelDto(row: ModelRow): ModelDto {
  return {
    id: row.id,
    provider: row.provider as ModelDto["provider"],
    kind: row.kind,
    inputCostPerM: row.input_cost_per_m,
    outputCostPerM: row.output_cost_per_m,
    enabled: row.enabled === 1,
    valid: row.valid === null ? null : row.valid === 1,
    lastValidatedAt: row.last_validated_at,
  };
}

/** GET /api/admin/models — full model registry (req 19). */
export const GET = handle(async () => {
  await requireAdmin();
  const rows = db.prepare("SELECT * FROM models ORDER BY id").all() as ModelRow[];
  return NextResponse.json({ models: rows.map(toModelDto) });
});

const upsertSchema = z.object({
  id: z.string().trim().min(1, "缺少模型 id"),
  provider: z.enum(["openai", "moonshot", "minimax", "openrouter"]),
  kind: z.enum(["text", "multimodal", "image"]),
  inputCostPerM: z.number().min(0),
  outputCostPerM: z.number().min(0),
  enabled: z.boolean(),
});

/**
 * POST /api/admin/models — upsert a registry row. A provider change resets the
 * valid/last_validated_at flags (re-check via /api/admin/models/validate);
 * otherwise validation state is preserved. (req 19)
 */
export const POST = handle(async (req) => {
  await requireAdmin();
  const body = upsertSchema.parse(await readJson(req));

  db.prepare(
    `INSERT INTO models (id, provider, kind, input_cost_per_m, output_cost_per_m, enabled)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       kind = excluded.kind,
       input_cost_per_m = excluded.input_cost_per_m,
       output_cost_per_m = excluded.output_cost_per_m,
       enabled = excluded.enabled,
       valid = CASE WHEN models.provider = excluded.provider THEN models.valid ELSE NULL END,
       last_validated_at = CASE WHEN models.provider = excluded.provider THEN models.last_validated_at ELSE NULL END`,
  ).run(body.id, body.provider, body.kind, body.inputCostPerM, body.outputCostPerM, body.enabled ? 1 : 0);

  const row = db.prepare("SELECT * FROM models WHERE id = ?").get(body.id) as ModelRow;
  return NextResponse.json({ model: toModelDto(row) });
});
