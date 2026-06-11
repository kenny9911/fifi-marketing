import type { TaskBrief } from "@/lib/api-types";
import type { PlatformId } from "@/lib/types";
import type { DyResult, GenericResult, MpResult, XhsResult } from "@/lib/results";
import { getPlatform } from "@/lib/platforms";
import { db, nowIso, uid } from "@/server/db";
import { chatComplete } from "@/server/llm/client";
import { emitEvent } from "@/server/pipeline/events";

// ===== Shared stage context =====

export interface StageCtx {
  taskId: string;
  userId: string;
  brief: TaskBrief;
}

// ===== Settings =====

export function getSetting<T>(key: string, fallback: T): T {
  const row = db
    .prepare<unknown[], { value_json: string }>("SELECT value_json FROM app_settings WHERE key = ?")
    .get(key);
  if (!row) return fallback;
  try {
    const v = JSON.parse(row.value_json) as T;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// ===== Coercion helpers (LLM output is never trusted blindly) =====

export function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

export function strArr(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x.trim() : typeof x === "object" && x !== null ? str((x as Record<string, unknown>).text) || JSON.stringify(x) : str(x)))
      .filter(Boolean);
  }
  if (typeof v === "string" && v.trim()) {
    return v
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// ===== Guarded agent call (SPEC §2 deadlock guard) =====

export interface AgentCallResult {
  /** parsed JSON object, or null when the call degraded / output unparseable */
  parsed: Record<string, unknown> | null;
  content: string;
  degraded: boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Cancel the underlying work (e.g. abort the in-flight chatComplete
      // chain) so it does not keep making billed provider calls unobserved.
      onTimeout?.();
      reject(new Error(`stage timeout after ${ms}ms (${label})`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function extractJson(content: string, parsed?: unknown): Record<string, unknown> | null {
  const fromParsed = obj(parsed);
  if (fromParsed) return fromParsed;
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const v = JSON.parse(text) as unknown;
    const o = obj(v);
    if (o) return o;
  } catch {
    // fall through to brace extraction
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const o = obj(JSON.parse(text.slice(start, end + 1)) as unknown);
      if (o) return o;
    } catch {
      // unparseable — caller degrades
    }
  }
  return null;
}

function fallbackModelFor(agentId: string): string | undefined {
  const row = db
    .prepare<unknown[], { fallback_model_id: string | null }>(
      "SELECT fallback_model_id FROM agents WHERE id = ?",
    )
    .get(agentId);
  return row?.fallback_model_id ?? process.env.LLM_MODEL_DEFAULT ?? undefined;
}

/**
 * Calls an agent through chatComplete with the orchestrator deadlock guard:
 * hard Promise.race timeout (app_settings.stage_timeout_ms, default 120s),
 * one retry with the agent's fallback model, then degrade (error event +
 * `degraded: true` so the stage continues with best-available content).
 * Emits a `thinking` event from the model's JSON `thinking` field.
 */
export async function callAgent(opts: {
  ctx: StageCtx;
  agentId: string;
  purpose: string;
  user: string;
  platform?: PlatformId;
  temperature?: number;
  maxTokens?: number;
  emitThinking?: boolean;
}): Promise<AgentCallResult> {
  const { ctx, agentId, purpose, platform } = opts;
  const timeoutMs = num(getSetting("stage_timeout_ms", 120_000), 120_000);
  const base = {
    agentId,
    json: true,
    taskId: ctx.taskId,
    userId: ctx.userId,
    purpose,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    timeoutMs,
    messages: [{ role: "user" as const, content: opts.user }],
  };

  let result: { content: string; parsed?: unknown } | null = null;
  try {
    const abort = new AbortController();
    result = await withTimeout(
      chatComplete({ ...base, signal: abort.signal }),
      timeoutMs + 5_000,
      purpose,
      () => abort.abort(new Error(`stage timeout after ${timeoutMs + 5_000}ms (${purpose})`)),
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const fallback = fallbackModelFor(agentId);
    emitEvent(ctx.taskId, {
      type: "error",
      agentId,
      title: `${purpose} 调用失败，重试备用模型`,
      detail: { text: reason, platform },
    });
    try {
      const retryAbort = new AbortController();
      result = await withTimeout(
        chatComplete({ ...base, model: fallback, signal: retryAbort.signal }),
        timeoutMs + 5_000,
        `${purpose}:fallback`,
        () => retryAbort.abort(new Error(`stage timeout after ${timeoutMs + 5_000}ms (${purpose}:fallback)`)),
      );
    } catch (err2) {
      const reason2 = err2 instanceof Error ? err2.message : String(err2);
      emitEvent(ctx.taskId, {
        type: "error",
        agentId,
        title: `${purpose} 备用模型仍失败，降级继续`,
        detail: { text: reason2, platform },
      });
      return { parsed: null, content: "", degraded: true };
    }
  }

  const parsed = extractJson(result.content, result.parsed);
  const thinking = str(parsed?.thinking);
  if (thinking && opts.emitThinking !== false) {
    emitEvent(ctx.taskId, {
      type: "thinking",
      agentId,
      title: truncate(thinking, 80),
      detail: { text: thinking, platform },
    });
  }
  return { parsed, content: result.content, degraded: false };
}

// ===== Artifacts =====

export interface ArtifactRef {
  id: string;
  version: number;
}

const ARTIFACT_LABEL: Record<string, string> = {
  research: "调研报告",
  outline: "大纲",
  draft: "草稿",
  critique: "评审意见",
  final: "定稿",
  prompt_pack: "提示词包",
  image: "配图",
};

export function insertArtifact(
  ctx: StageCtx,
  platform: PlatformId | null,
  type: string,
  content: unknown,
  opts?: { agentId?: string; silent?: boolean },
): ArtifactRef {
  const row = db
    .prepare<unknown[], { v: number }>(
      "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM artifacts WHERE task_id = ? AND type = ? AND platform IS ?",
    )
    .get(ctx.taskId, type, platform);
  const version = row?.v ?? 1;
  const id = uid();
  db.prepare(
    "INSERT INTO artifacts (id, task_id, platform, type, version, content_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, ctx.taskId, platform, type, version, JSON.stringify(content), nowIso());
  if (!opts?.silent) {
    const where = platform ? ` · ${getPlatform(platform).name}` : "";
    emitEvent(ctx.taskId, {
      type: "artifact",
      agentId: opts?.agentId,
      title: `${ARTIFACT_LABEL[type] ?? type} v${version}${where}`,
      detail: { artifactId: id, platform: platform ?? undefined, artifactType: type, version },
    });
  }
  return { id, version };
}

export interface ArtifactRow {
  id: string;
  task_id: string;
  platform: string | null;
  type: string;
  version: number;
  content_json: string;
  created_at: string;
}

export function latestArtifact(
  taskId: string,
  type: string,
  platform: PlatformId | null,
): ArtifactRow | undefined {
  return db
    .prepare<unknown[], ArtifactRow>(
      "SELECT * FROM artifacts WHERE task_id = ? AND type = ? AND platform IS ? ORDER BY version DESC LIMIT 1",
    )
    .get(taskId, type, platform);
}

// ===== Skills =====

export function skillsForPlatform(platform: PlatformId): string {
  const rows = db
    .prepare<unknown[], { name: string; content: string }>(
      "SELECT name, content FROM skills WHERE status = 'active' AND (platform = ? OR platform IS NULL) ORDER BY platform IS NULL, id",
    )
    .all(platform);
  return rows.map((r) => `### ${r.name}\n${r.content}`).join("\n\n");
}

// ===== Result shapes (must satisfy src/lib/results.ts, incl. GenericResult) =====

export type DraftShape = (XhsResult | DyResult | MpResult | GenericResult) & {
  thinking?: string;
  error?: boolean;
};

export interface DraftRecord {
  shape: DraftShape;
  version: number;
}

const DY_CHIPS = [
  { bg: "#25F4EE", color: "#161823" },
  { bg: "#FFC53D", color: "#161823" },
  { bg: "#FE2C55", color: "#FFFFFF" },
];

const DY_DEFAULT_TIMES = ["0–3s", "3–10s", "10–15s"];
const DY_DEFAULT_LABELS = ["钩子", "演示", "转化"];

/** Coerce arbitrary LLM JSON into the platform's render-contract shape. */
export function normalizeDraft(
  platform: PlatformId,
  raw: Record<string, unknown>,
  fallbackTitle: string,
): DraftShape {
  const thinking = str(raw.thinking);
  const tuningNotes = strArr(raw.tuningNotes ?? raw.notes);
  const title = str(raw.title) || fallbackTitle;

  if (platform === "xhs") {
    const bodyLines = strArr(raw.bodyLines ?? raw.body ?? raw.sections ?? raw.paragraphs ?? raw.content);
    return {
      kind: "xhs",
      coverHeadline: str(raw.coverHeadline) || truncate(title, 6),
      coverSub: str(raw.coverSub) || "",
      title,
      bodyLines,
      hashtags: strArr(raw.hashtags ?? raw.tags),
      tuningNotes,
      thinking,
    };
  }

  if (platform === "dy") {
    const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
    let shots = rawShots
      .map((s, i) => {
        const o = obj(s) ?? {};
        const chip = DY_CHIPS[Math.min(i, DY_CHIPS.length - 1)];
        return {
          time: str(o.time) || DY_DEFAULT_TIMES[Math.min(i, 2)],
          chipBg: str(o.chipBg) || chip.bg,
          chipColor: str(o.chipColor) || chip.color,
          label: str(o.label) || DY_DEFAULT_LABELS[Math.min(i, 2)],
          text: str(o.text ?? o.description ?? o.content),
        };
      })
      .filter((s) => s.text);
    if (shots.length === 0) {
      shots = strArr(raw.sections ?? raw.bodyLines ?? raw.content).slice(0, 3).map((text, i) => ({
        time: DY_DEFAULT_TIMES[Math.min(i, 2)],
        chipBg: DY_CHIPS[Math.min(i, 2)].bg,
        chipColor: DY_CHIPS[Math.min(i, 2)].color,
        label: DY_DEFAULT_LABELS[Math.min(i, 2)],
        text,
      }));
    }
    return {
      kind: "dy",
      title,
      subtitle: str(raw.subtitle) || `抖音 · ${getPlatform("dy").expert.name} 出品 · HOOK FIRST`,
      shots,
      tuningNotes,
      thinking,
    };
  }

  if (platform === "mp") {
    return {
      kind: "mp",
      badge: str(raw.badge) || `公众号 · ${getPlatform("mp").expert.name} 出品`,
      meta: str(raw.meta) || "",
      title,
      intro: str(raw.intro ?? raw.lead) || "",
      outline: strArr(raw.outline ?? raw.sections ?? raw.bodyLines),
      tuningNotes,
      thinking,
    };
  }

  const hashtags = strArr(raw.hashtags ?? raw.tags);
  const generic: GenericResult & { thinking: string } = {
    kind: "generic",
    title,
    sections: strArr(raw.sections ?? raw.bodyLines ?? raw.paragraphs ?? raw.body ?? raw.content),
    tuningNotes,
    thinking,
  };
  if (hashtags.length) generic.hashtags = hashtags;
  return generic;
}

/** Error-flavored final/draft for a platform whose generation failed (SPEC §2). */
export function errorDraft(platform: PlatformId, message: string): DraftShape {
  const p = getPlatform(platform);
  return {
    kind: "generic",
    title: `${p.name} 内容生成失败`,
    sections: [message, "其他平台不受影响，可在对话中发送修改意见触发重写。"],
    tuningNotes: [],
    thinking: "",
    error: true,
  };
}

/** Compact JSON skeleton the agent is asked to return per platform. */
export function shapeSpec(platform: PlatformId): string {
  switch (platform) {
    case "xhs":
      return '{"thinking":"1-3句创作思路","coverHeadline":"封面大字（≤6字）","coverSub":"封面副标题","title":"笔记标题（≤20字）","bodyLines":["正文逐行，含 emoji 与列表化卖点"],"hashtags":["#话题标签"],"tuningNotes":["调优说明"]}';
    case "dy":
      return '{"thinking":"1-3句创作思路","title":"脚本标题","subtitle":"副标题","shots":[{"time":"0–3s","label":"钩子","text":"画面 + 台词"},{"time":"3–10s","label":"演示","text":"…"},{"time":"10–15s","label":"转化","text":"…"}],"tuningNotes":["调优说明"]}';
    case "mp":
      return '{"thinking":"1-3句创作思路","badge":"栏目标识","meta":"预计阅读时长 · 字数","title":"文章标题","intro":"导语","outline":["小节标题 1","小节标题 2"],"tuningNotes":["调优说明"]}';
    default:
      return '{"thinking":"1-3句创作思路","title":"标题","sections":["正文段落"],"hashtags":["#话题（可选）"],"tuningNotes":["调优说明"]}';
  }
}

// ===== User-message assembly =====

export function userPayload(instruction: string, data: Record<string, unknown>): string {
  return `${instruction}\n\n【输入数据】\n${JSON.stringify(data, null, 2)}`;
}

export function briefForPrompt(brief: TaskBrief): Record<string, unknown> {
  return {
    goal: brief.goal,
    audience: brief.audience,
    platforms: brief.platforms.map((p) => `${p}（${getPlatform(p).name}）`),
    style: brief.style,
    materials: (brief.materials ?? "").slice(0, 6_000),
    notes: brief.notes ?? "",
  };
}

// ===== Research pack passed between stages =====

export interface ResearchPack {
  summary: string;
  insights: string[];
  platformTrends: Record<string, string>;
  sources: { title: string; url: string }[];
}

/** Latest draft per platform (falls back to latest final) — used by revisions. */
export function loadLatestDrafts(
  taskId: string,
  platforms: PlatformId[],
): Map<PlatformId, DraftRecord> {
  const map = new Map<PlatformId, DraftRecord>();
  for (const platform of platforms) {
    const row = latestArtifact(taskId, "draft", platform) ?? latestArtifact(taskId, "final", platform);
    if (row) {
      try {
        map.set(platform, {
          shape: JSON.parse(row.content_json) as DraftShape,
          version: row.version,
        });
        continue;
      } catch {
        // fall through to placeholder
      }
    }
    map.set(platform, { shape: errorDraft(platform, "暂无可用草稿"), version: 0 });
  }
  return map;
}
