import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { handle, requireUser } from "@/server/auth";
import { presignedGetUrl } from "@/server/minio";
import type { FileDto } from "@/lib/api-types";

/**
 * GET /api/files/[id] — own file → FileDto with a presigned MinIO URL
 * (SPEC §5). 404 for unknown ids and for files owned by other users.
 */

interface FileRow {
  id: string;
  user_id: string;
  task_id: string | null;
  name: string;
  mime: string;
  size: number;
  minio_key: string;
  status: string;
  extracted_text: string | null;
  created_at: string;
}

function toFileDto(row: FileRow, url?: string): FileDto {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    status: row.status as FileDto["status"],
    extractedChars: row.extracted_text ? row.extracted_text.length : undefined,
    taskId: row.task_id ?? undefined,
    createdAt: row.created_at,
    url,
  };
}

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();
    const { id } = await ctx.params;

    const row = db
      .prepare("SELECT * FROM files WHERE id = ? AND user_id = ?")
      .get(id, user.id) as FileRow | undefined;
    if (!row) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    let url: string | undefined;
    try {
      url = await presignedGetUrl(row.minio_key);
    } catch (err) {
      console.warn(`[files] presign failed for ${row.minio_key}:`, err);
    }

    return NextResponse.json(toFileDto(row, url));
  },
);
