import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { handle, requireAdmin } from "@/server/auth";
import { validateModelId, type ModelRow } from "@/server/llm/router";
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

/**
 * POST /api/admin/models/validate — run validation over the whole registry
 * (live provider lists; registry-only under TEST_MODE=mock) and return
 * per-model valid flags.
 */
export const POST = handle(async () => {
  await requireAdmin();

  const rows = db.prepare("SELECT * FROM models ORDER BY id").all() as ModelRow[];
  const results: (ModelDto & { checkedValid: boolean })[] = [];
  for (const row of rows) {
    const ok = await validateModelId(row.id);
    // Re-read: validateModelId persists valid/last_validated_at on definitive results.
    const fresh = (db.prepare("SELECT * FROM models WHERE id = ?").get(row.id) ?? row) as ModelRow;
    results.push({ ...toModelDto(fresh), checkedValid: ok });
  }
  return NextResponse.json({ models: results });
});
