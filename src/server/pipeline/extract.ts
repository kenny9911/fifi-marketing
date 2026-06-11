import { db } from "@/server/db";
import { chatComplete } from "@/server/llm/client";
import { getObjectBuffer } from "@/server/minio";

/**
 * Multimodal file extraction (SPEC §4).
 *
 * - text-like mimes — read the stored buffer as utf8 directly (no LLM).
 * - images — sent as `image_url` data-URL parts to the extractor agent.
 * - PDFs — sent as OpenRouter `file` content parts (filename + base64
 *   data-URL in `file.file_data`), which the OpenRouter chat-completions
 *   dialect accepts for PDF input.
 * - anything else (docx/xlsx/pptx, …) — status 'failed' with a clear error
 *   in the server log (the files table carries no error column).
 *
 * Every LLM call goes through chatComplete (agentId "extractor", purpose
 * "extract"), so TEST_MODE=mock returns deterministic fixture text and real
 * runs are logged to llm_calls. The whole routine is wrapped in try/catch:
 * extraction failure marks the file 'failed' but never throws to callers
 * (uploads fire it fire-and-forget).
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

const MAX_EXTRACTED_CHARS = 100_000;
const PDF_MIME = "application/pdf";

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** Mimes whose bytes are directly readable as text — no LLM needed. */
export function isDirectTextMime(mime: string): boolean {
  const normalized = normalizeMime(mime);
  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/xml"
  );
}

function normalizeMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

type ChatCompleteOpts = Parameters<typeof chatComplete>[0];
type ChatMessages = ChatCompleteOpts["messages"];

function buildInstruction(row: FileRow, mime: string): string {
  return [
    `文件名：${row.name}（类型：${mime}）。请完整、忠实地解析这份文件：`,
    "1. 第一段以「摘要：」开头，用一个自然段的中文概括文件的主旨与要点。",
    "2. 空一行后，逐字转录文件中的全部文字内容，保持原始顺序与层级（可用 Markdown 还原标题、列表、表格）。",
    "3. 若是图片且几乎没有文字，请客观描述画面中的关键信息（主体、场景、风格、配色、可见的品牌或产品细节）。",
    "4. 不要编造文件中不存在的内容，不要附加任何说明或评论。",
  ].join("\n");
}

async function extractViaLlm(
  row: FileRow,
  mime: string,
  buf: Buffer,
): Promise<string> {
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const instruction = buildInstruction(row, mime);

  const parts =
    mime === PDF_MIME
      ? [
          { type: "text", text: instruction },
          {
            // OpenRouter PDF input: `file` content part with a base64 data-URL.
            type: "file",
            file: {
              filename: row.name || "document.pdf",
              file_data: dataUrl,
            },
          },
        ]
      : [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: dataUrl } },
        ];

  const res = await chatComplete({
    agentId: "extractor",
    purpose: "extract",
    taskId: row.task_id ?? undefined,
    userId: row.user_id,
    temperature: 0,
    timeoutMs: 180_000,
    messages: [{ role: "user", content: parts }] as unknown as ChatMessages,
  });
  return res.content;
}

export async function extractFile(fileId: string): Promise<void> {
  const row = db
    .prepare("SELECT * FROM files WHERE id = ?")
    .get(fileId) as FileRow | undefined;
  if (!row) {
    console.error(`[extract] file not found: ${fileId}`);
    return;
  }

  const setStatus = db.prepare("UPDATE files SET status = ? WHERE id = ?");
  const setResult = db.prepare(
    "UPDATE files SET status = ?, extracted_text = ? WHERE id = ?",
  );

  try {
    setStatus.run("extracting", fileId);
    const mime = normalizeMime(row.mime);

    let text: string;
    if (isDirectTextMime(mime)) {
      const buf = await getObjectBuffer(row.minio_key);
      text = buf.toString("utf8").replace(/^\uFEFF/, "");
    } else if (IMAGE_MIMES.has(mime) || mime === PDF_MIME) {
      const buf = await getObjectBuffer(row.minio_key);
      text = await extractViaLlm(row, mime, buf);
    } else {
      setResult.run("failed", null, fileId);
      console.error(
        `[extract] unsupported mime "${mime}" for file ${fileId} (${row.name}) — ` +
          "内容解析目前仅支持纯文本、图片(png/jpeg/webp/gif)与 PDF；该文件已保存但无法提取文字",
      );
      return;
    }

    if (text.length > MAX_EXTRACTED_CHARS) {
      text = text.slice(0, MAX_EXTRACTED_CHARS);
    }
    setResult.run("extracted", text, fileId);
  } catch (err) {
    console.error(
      `[extract] extraction failed for file ${fileId} (${row.name}):`,
      err,
    );
    try {
      setResult.run("failed", null, fileId);
    } catch (dbErr) {
      console.error(
        `[extract] could not mark file ${fileId} as failed:`,
        dbErr,
      );
    }
  }
}
