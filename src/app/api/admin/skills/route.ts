import { NextResponse } from "next/server";
import { z } from "zod";
import { db, nowIso } from "@/server/db";
import { ApiError, handle, readJson, requireAdmin } from "@/server/auth";
import type { SkillDto } from "@/lib/api-types";
import type { PlatformId } from "@/lib/types";

/** Row shape of the `skills` table (see src/server/schema.sql). */
interface SkillRow {
  id: string;
  platform: string | null;
  name: string;
  content: string;
  version: number;
  status: string;
  updated_at: string;
}

function toSkillDto(row: SkillRow): SkillDto {
  return {
    id: row.id,
    platform: (row.platform as PlatformId | null) ?? null,
    name: row.name,
    content: row.content,
    version: row.version,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

/** GET /api/admin/skills — full skill library, general (platform-less) skills first (req 19). */
export const GET = handle(async () => {
  await requireAdmin();
  const rows = db
    .prepare("SELECT * FROM skills ORDER BY platform IS NOT NULL, platform, id")
    .all() as SkillRow[];
  return NextResponse.json({ skills: rows.map(toSkillDto) });
});

const updateSchema = z.object({
  id: z.string().min(1, "缺少 skill id"),
  content: z.string().min(1, "技能内容不能为空"),
});

/** PUT /api/admin/skills — {id, content} → version+1, updated_at=now (req 19). */
export const PUT = handle(async (req) => {
  await requireAdmin();
  const body = updateSchema.parse(await readJson(req));

  const exists = db.prepare("SELECT id FROM skills WHERE id = ?").get(body.id);
  if (!exists) throw new ApiError(404, "skill 不存在");

  db.prepare("UPDATE skills SET content = ?, version = version + 1, updated_at = ? WHERE id = ?").run(
    body.content,
    nowIso(),
    body.id,
  );

  const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(body.id) as SkillRow;
  return NextResponse.json({ skill: toSkillDto(row) });
});
