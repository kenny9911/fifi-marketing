import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { handle, readJson, requireAdmin } from "@/server/auth";
import { runEvolution } from "@/server/evolve";
import type { EvolutionRunDto } from "@/lib/api-types";

const evolveSchema = z.object({
  windowDays: z.number().int().min(1).max(90).optional(),
});

/** POST /api/admin/evolve — {windowDays?} → manual self-evolution run (req 10). */
export const POST = handle(async (req) => {
  await requireAdmin();
  const raw = await readJson(req).catch(() => ({}));
  const body = evolveSchema.parse(raw ?? {});
  const run = await runEvolution("manual", body.windowDays);
  return NextResponse.json({ run });
});

interface RunRow {
  id: string;
  ts: string;
  trigger: "manual" | "auto";
  window_days: number;
  report_md: string;
  proposals_json: string;
  status: string;
}

/** GET /api/admin/evolve — run history, newest first (req 10). */
export const GET = handle(async () => {
  await requireAdmin();
  const rows = db
    .prepare("SELECT * FROM evolution_runs ORDER BY ts DESC LIMIT 50")
    .all() as RunRow[];
  const runs: (EvolutionRunDto & { windowDays: number; status: string })[] = rows.map((r) => {
    let proposals: EvolutionRunDto["proposals"] = [];
    try {
      const parsed = JSON.parse(r.proposals_json) as unknown;
      if (Array.isArray(parsed)) proposals = parsed as EvolutionRunDto["proposals"];
    } catch {
      proposals = [];
    }
    return {
      id: r.id,
      ts: r.ts,
      trigger: r.trigger,
      reportMd: r.report_md,
      proposals,
      windowDays: r.window_days,
      status: r.status,
    };
  });
  return NextResponse.json({ runs });
});
