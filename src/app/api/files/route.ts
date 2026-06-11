import { NextResponse } from "next/server";
import { db, nowIso, uid } from "@/server/db";
import { handle, requireUser } from "@/server/auth";
import { ensureBucket, putObject } from "@/server/minio";
import { extractFile, isDirectTextMime } from "@/server/pipeline/extract";
import type { FileDto } from "@/lib/api-types";

/**
 * POST /api/files — multipart upload (file, taskId?) → FileDto (SPEC §5, req 7).
 * GET  /api/files — list own files, optional ?taskId= filter.
 *
 * Stored at MinIO key `uploads/<userId>/<fileId>-<safeName>`. Mimes that are
 * not directly-readable text (pdf, images, docx/xlsx/pptx) get a
 * fire-and-forget extractFile() pass — the returned FileDto reflects status
 * 'extracting'. Directly-readable text is extracted inline (fast utf8 read,
 * no LLM) so its content is immediately available to the pipeline.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const ALLOWED_EXACT_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/json",
  DOCX_MIME,
  XLSX_MIME,
  PPTX_MIME,
]);

/** Fallback when the browser sends no/generic mime: infer from extension. */
const EXT_MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".docx": DOCX_MIME,
  ".xlsx": XLSX_MIME,
  ".pptx": PPTX_MIME,
};

function resolveMime(rawType: string, fileName: string): string {
  let mime = rawType.split(";")[0].trim().toLowerCase();
  if (!mime || mime === "application/octet-stream") {
    const dot = fileName.lastIndexOf(".");
    const ext = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
    mime = EXT_MIME[ext] ?? mime;
  }
  return mime;
}

function isAllowedMime(mime: string): boolean {
  return mime.startsWith("text/") || ALLOWED_EXACT_MIMES.has(mime);
}

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return cleaned || "file";
}

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

function toFileDto(row: FileRow): FileDto {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    status: row.status as FileDto["status"],
    extractedChars: row.extracted_text ? row.extracted_text.length : undefined,
    taskId: row.task_id ?? undefined,
    createdAt: row.created_at,
  };
}

export const POST = handle(async (req: Request) => {
  const user = await requireUser();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "无法解析上传表单，请使用 multipart/form-data" },
      { status: 400 },
    );
  }

  const filePart = form.get("file");
  if (!(filePart instanceof File)) {
    return NextResponse.json(
      { error: "缺少 file 字段（multipart 文件）" },
      { status: 400 },
    );
  }

  const taskIdRaw = form.get("taskId");
  const taskId =
    typeof taskIdRaw === "string" && taskIdRaw.trim() ? taskIdRaw.trim() : null;
  if (taskId) {
    const task = db
      .prepare("SELECT id FROM tasks WHERE id = ? AND user_id = ?")
      .get(taskId, user.id);
    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
  }

  const name = (filePart.name || "").trim() || "未命名文件";
  const mime = resolveMime(filePart.type || "", name);
  if (!isAllowedMime(mime)) {
    return NextResponse.json(
      {
        error: `不支持的文件类型：${mime || "未知"}。支持图片(png/jpeg/webp/gif)、PDF、文本/Markdown 及 Office 文档(docx/xlsx/pptx)`,
      },
      { status: 415 },
    );
  }
  if (filePart.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "文件大小超过 25MB 限制" },
      { status: 413 },
    );
  }
  if (filePart.size === 0) {
    return NextResponse.json({ error: "文件内容为空" }, { status: 400 });
  }

  const buf = Buffer.from(await filePart.arrayBuffer());
  const fileId = uid();
  const minioKey = `uploads/${user.id}/${fileId}-${safeFileName(name)}`;

  await ensureBucket();
  await putObject(minioKey, buf, mime);

  // Anything not directly-readable text needs the multimodal extractor.
  const needsLlmExtraction = !isDirectTextMime(mime);
  db.prepare(
    `INSERT INTO files (id, user_id, task_id, name, mime, size, minio_key, status, extracted_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    fileId,
    user.id,
    taskId,
    name,
    mime,
    buf.length,
    minioKey,
    needsLlmExtraction ? "extracting" : "uploaded",
    nowIso(),
  );

  if (needsLlmExtraction) {
    // Fire-and-forget; extractFile flips status to extracted/failed itself.
    extractFile(fileId).catch((err) => {
      console.error(`[files] background extraction crashed for ${fileId}:`, err);
    });
  } else {
    // Plain text: extract inline (utf8 read, no LLM) so content is ready now.
    await extractFile(fileId);
  }

  const row = db
    .prepare("SELECT * FROM files WHERE id = ?")
    .get(fileId) as FileRow;
  return NextResponse.json(toFileDto(row), { status: 201 });
});

export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const taskId = new URL(req.url).searchParams.get("taskId");

  const rows = (
    taskId
      ? db
          .prepare(
            "SELECT * FROM files WHERE user_id = ? AND task_id = ? ORDER BY created_at DESC",
          )
          .all(user.id, taskId)
      : db
          .prepare(
            "SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC",
          )
          .all(user.id)
  ) as FileRow[];

  return NextResponse.json(rows.map(toFileDto));
});
