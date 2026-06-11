import OpenAI from "openai";
import { db, uid, nowIso } from "./db";
import { ApiError } from "./auth";
import { chatComplete } from "./llm/client";
import { validateModelId } from "./llm/router";
import { ensureBucket, putObject, presignedGetUrl } from "./minio";
import { emitEvent } from "./pipeline/events";
import { getPlatform } from "@/lib/platforms";
import type { PlatformId } from "@/lib/types";
import type { ImageArtifactDto, TaskBrief } from "@/lib/api-types";

/** 1x1 transparent PNG used in TEST_MODE=mock — keeps the full flow exercised with zero cost. */
const MOCK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const PROVIDER_KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  minimax: "MINIMAX_API_KEY",
};

interface ImageModelRow {
  id: string;
  provider: string;
}

interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  brief_json: string;
}

function isMock(): boolean {
  return process.env.TEST_MODE === "mock";
}

function appSettingNumber(key: string, fallback: number): number {
  const row = db
    .prepare("SELECT value_json FROM app_settings WHERE key = ?")
    .get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    const v = JSON.parse(row.value_json) as unknown;
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Image models that are enabled, whose provider key exists, and that pass live validation. */
async function availableImageModels(): Promise<ImageModelRow[]> {
  const rows = db
    .prepare("SELECT id, provider FROM models WHERE kind = 'image' AND enabled = 1")
    .all() as ImageModelRow[];

  if (isMock()) {
    // No network in mock mode; key presence is irrelevant for the fake generator.
    return rows.length
      ? rows
      : [
          { id: "openai/gpt-image-1", provider: "openai" },
          { id: "google/gemini-2.5-flash-image", provider: "openrouter" },
        ];
  }

  const withKeys = rows.filter((m) => {
    const env = PROVIDER_KEY_ENV[m.provider];
    return Boolean(env && process.env[env]);
  });

  const candidates: ImageModelRow[] = [];
  for (const m of withKeys) {
    const ok = await Promise.resolve(validateModelId(m.id)).catch(() => false);
    if (ok) candidates.push(m);
  }
  return candidates;
}

function buildFallbackPrompt(brief: TaskBrief | null, platformName: string | null, hint?: string): string {
  const parts = [
    hint?.trim(),
    brief?.goal ? `主题: ${brief.goal}` : undefined,
    brief?.style ? `风格: ${brief.style}` : undefined,
    platformName ? `用途: ${platformName}配图/封面` : "用途: 社交媒体配图",
    "high quality social media illustration, clean composition, rich detail, no text artifacts, 1:1",
  ].filter(Boolean);
  return parts.join("; ");
}

async function generateWithOpenAI(modelId: string, prompt: string): Promise<Buffer> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Direct OpenAI: strip the vendor prefix from the canonical id.
  const model = modelId.replace(/^openai\//, "");
  const res = await client.images.generate(
    { model, prompt, size: "1024x1024" },
    { timeout: 120_000 },
  );
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI 未返回图像数据 (b64_json missing)");
  return Buffer.from(b64, "base64");
}

async function generateWithOpenRouter(modelId: string, prompt: string): Promise<Buffer> {
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });
  const res = await client.chat.completions.create(
    {
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      // OpenRouter image-output dialect: request image modality alongside text.
      modalities: ["image", "text"],
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    { timeout: 120_000 },
  );
  const message = res.choices?.[0]?.message as
    | (OpenAI.Chat.Completions.ChatCompletionMessage & {
        images?: { image_url?: { url?: string } }[];
      })
    | undefined;
  const url = message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("OpenRouter 未返回图像数据 (message.images missing)");
  const match = /^data:(image\/[a-z0-9+.-]+);base64,([\s\S]+)$/i.exec(url);
  if (!match) throw new Error("无法解析 OpenRouter 返回的图像 data URL");
  return Buffer.from(match[2], "base64");
}

function insertLlmCall(opts: {
  userId: string;
  taskId: string;
  modelId: string;
  provider: string;
  costUsd: number;
  latencyMs: number;
  status: "ok" | "error";
  error?: string;
  requestChars: number;
  responseChars: number;
}): void {
  try {
    db.prepare(
      `INSERT INTO llm_calls
         (id, ts, user_id, task_id, agent_id, prompt_version, model_id, provider, purpose,
          prompt_tokens, completion_tokens, cost_usd, latency_ms, status, error,
          request_chars, response_chars)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uid(),
      nowIso(),
      opts.userId,
      opts.taskId,
      "image_director",
      null,
      opts.modelId,
      opts.provider,
      "image:generate",
      opts.costUsd,
      opts.latencyMs,
      opts.status,
      opts.error ?? null,
      opts.requestChars,
      opts.responseChars,
    );
  } catch (err) {
    // Cost logging must never break image generation (mirrors llm/client logCall).
    console.error("[images] failed to insert llm_calls row:", err);
  }
}

/**
 * Generate one image for a task (req 8).
 *
 * 1. image_director agent picks the model + refines the prompt ("image:route").
 * 2. The chosen model is invoked (OpenAI Images API or OpenRouter image-output chat).
 * 3. PNG → MinIO, artifacts row (type='image'), flat-cost llm_calls row, artifact event.
 */
export async function generateImage(opts: {
  taskId: string;
  userId: string;
  platform: PlatformId | null;
  hint?: string;
}): Promise<ImageArtifactDto> {
  const { taskId, userId, platform, hint } = opts;

  const task = db
    .prepare("SELECT id, user_id, title, brief_json FROM tasks WHERE id = ?")
    .get(taskId) as TaskRow | undefined;
  if (!task) throw new ApiError(404, "任务不存在");

  let brief: TaskBrief | null = null;
  try {
    brief = JSON.parse(task.brief_json) as TaskBrief;
  } catch {
    brief = null;
  }
  const platformName = platform ? getPlatform(platform).name : null;

  const candidates = await availableImageModels();
  if (!candidates.length) {
    throw new ApiError(503, "当前没有可用的图像模型（缺少已启用且校验通过的图像模型或对应 API Key）");
  }

  // ---- 1. Route: image_director picks model + refines prompt ----
  let chosen = candidates[0];
  let prompt = buildFallbackPrompt(brief, platformName, hint);
  let thinking = "";

  const modelList = candidates.map((m) => `- ${m.id}（provider: ${m.provider}）`).join("\n");
  const directorMessage = [
    "请为以下任务挑选最合适的图像生成模型，并撰写一条专业的图像生成提示词。",
    "",
    "【任务简报】",
    `- 目标: ${brief?.goal ?? task.title}`,
    `- 受众: ${brief?.audience ?? "未指定"}`,
    `- 风格: ${brief?.style ?? "未指定"}`,
    `- 平台: ${platformName ? `${platformName} (${platform})` : "通用配图"}`,
    `- 额外要求: ${hint?.trim() || "无"}`,
    "",
    "【可用图像模型】（modelId 必须从此列表中选择）",
    modelList,
    "",
    "严格输出 JSON 对象：",
    '{"thinking": "1-3句中文决策理由", "modelId": "可用列表中的模型 id", "refinedPrompt": "专业图像生成提示词（含主体/构图/光线/色彩/风格，适配 1024x1024）"}',
  ].join("\n");

  try {
    const routed = await chatComplete({
      agentId: "image_director",
      json: true,
      taskId,
      userId,
      purpose: "image:route",
      messages: [{ role: "user", content: directorMessage }],
    });
    let parsed = routed.parsed as
      | { modelId?: unknown; refinedPrompt?: unknown; thinking?: unknown }
      | undefined;
    if (!parsed || typeof parsed !== "object") {
      try {
        parsed = JSON.parse(routed.content) as typeof parsed;
      } catch {
        parsed = undefined;
      }
    }
    const wanted = typeof parsed?.modelId === "string" ? parsed.modelId : "";
    const matched = candidates.find((m) => m.id === wanted);
    if (matched) chosen = matched;
    if (typeof parsed?.refinedPrompt === "string" && parsed.refinedPrompt.trim()) {
      prompt = parsed.refinedPrompt.trim();
    }
    if (typeof parsed?.thinking === "string") thinking = parsed.thinking.trim();
  } catch (err) {
    // Degrade gracefully: fall back to the first candidate + constructed prompt.
    emitEvent(taskId, {
      type: "error",
      agentId: "image_director",
      title: "图像模型路由失败，使用默认模型继续",
      detail: { text: err instanceof Error ? err.message : String(err) },
    });
  }

  if (thinking) {
    emitEvent(taskId, {
      type: "thinking",
      agentId: "image_director",
      title: thinking.length > 80 ? `${thinking.slice(0, 80)}…` : thinking,
      detail: { text: thinking, ...(platform ? { platform } : {}) },
    });
  }

  // ---- 2. Generate ----
  const mock = isMock();
  emitEvent(taskId, {
    type: "tool_call",
    agentId: "image_director",
    title: `调用图像模型 ${chosen.id}`,
    detail: { toolName: "image_generate", model: chosen.id, ...(platform ? { platform } : {}) },
  });

  const startedAt = Date.now();
  let png: Buffer;
  try {
    if (mock) {
      png = MOCK_PNG;
    } else if (chosen.provider === "openai") {
      png = await generateWithOpenAI(chosen.id, prompt);
    } else {
      png = await generateWithOpenRouter(chosen.id, prompt);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    insertLlmCall({
      userId,
      taskId,
      modelId: chosen.id,
      provider: chosen.provider,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      status: "error",
      error: message,
      requestChars: prompt.length,
      responseChars: 0,
    });
    emitEvent(taskId, {
      type: "error",
      agentId: "image_director",
      title: "图像生成失败",
      detail: { text: message, model: chosen.id, ...(platform ? { platform } : {}) },
    });
    throw new ApiError(502, `图像生成失败: ${message}`);
  }
  const latencyMs = Date.now() - startedAt;

  // The provider call is billed at this point — record the flat-cost llm_calls
  // row immediately, before any persistence step that could still fail
  // (SPEC §3: every call, success AND failure, inserts an llm_calls row).
  const costUsd = mock
    ? 0
    : chosen.provider === "openai"
      ? appSettingNumber("image_cost_openai", 0.04)
      : appSettingNumber("image_cost_gemini", 0.03);

  insertLlmCall({
    userId,
    taskId,
    modelId: chosen.id,
    provider: chosen.provider,
    costUsd,
    latencyMs,
    status: "ok",
    requestChars: prompt.length,
    responseChars: png.length,
  });

  // ---- 3. Persist: MinIO object + artifacts row ----
  const artifactId = uid();
  const minioKey = `images/${taskId}/${artifactId}.png`;
  try {
    await ensureBucket();
    await putObject(minioKey, png, "image/png");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitEvent(taskId, {
      type: "error",
      agentId: "image_director",
      title: "图像已生成但存储失败",
      detail: { text: message, model: chosen.id, ...(platform ? { platform } : {}) },
    });
    throw new ApiError(502, `图像存储失败: ${message}`);
  }

  const createdAt = nowIso();
  const version =
    (
      db
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS v FROM artifacts WHERE task_id = ? AND type = 'image' AND platform IS ?",
        )
        .get(taskId, platform) as { v: number }
    ).v + 1;

  db.prepare(
    `INSERT INTO artifacts (id, task_id, platform, type, version, content_json, created_at)
     VALUES (?, ?, ?, 'image', ?, ?, ?)`,
  ).run(
    artifactId,
    taskId,
    platform,
    version,
    JSON.stringify({ prompt, model: chosen.id, minioKey, platform }),
    createdAt,
  );

  emitEvent(taskId, {
    type: "artifact",
    agentId: "image_director",
    title: `配图已生成（${chosen.id}）`,
    detail: { artifactId, minioKey, model: chosen.id, ...(platform ? { platform } : {}) },
  });

  const url = await presignedGetUrl(minioKey);
  return { id: artifactId, platform, url, prompt, model: chosen.id, createdAt };
}
