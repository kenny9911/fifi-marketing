import type { PlatformId } from "./types";
import type { FinalResult } from "./results";

/**
 * Shared API contract between the Next.js frontend and the agentic backend.
 * Both are built against these shapes — change them only with care.
 */

// ===== Pipeline =====

export type PipelineStage =
  | "search"
  | "prompt_craft"
  | "craft"
  | "organize"
  | "critic"
  | "review"
  | "reedit"
  | "finalize";

export const PIPELINE_STAGES: { id: PipelineStage; label: string; en: string }[] = [
  { id: "search", label: "情报搜集", en: "SEARCH" },
  { id: "prompt_craft", label: "提示词工程", en: "PROMPT CRAFT" },
  { id: "craft", label: "专家撰稿", en: "CRAFT" },
  { id: "organize", label: "结构整理", en: "ORGANIZE" },
  { id: "critic", label: "毒舌评审", en: "CRITIC" },
  { id: "review", label: "总编复核", en: "REVIEW" },
  { id: "reedit", label: "回炉重写", en: "RE-EDIT" },
  { id: "finalize", label: "定稿交付", en: "FINALIZE" },
];

export type TaskStatus =
  | "briefing"
  | "running"
  | "reviewing"
  | "done"
  | "failed"
  | "cancelled";

export interface TaskBrief {
  goal: string;
  audience: string;
  platforms: PlatformId[];
  style: string;
  materials: string;
  /** free-form extra instructions accumulated from chat */
  notes?: string;
  /** ids of uploaded files attached as source material */
  fileIds?: string[];
}

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  stage: PipelineStage | null;
  platforms: PlatformId[];
  createdAt: string;
  updatedAt: string;
  costUsd: number;
  tokens: number;
}

export interface TaskDetail extends TaskSummary {
  brief: TaskBrief;
  messages: ChatMessageDto[];
  events: TaskEventDto[];
  finals: Partial<Record<PlatformId, FinalResult>>;
  images: ImageArtifactDto[];
  promptPacks: PromptPackDto[];
  error?: string;
}

export interface ChatMessageDto {
  id: string;
  role: "user" | "ai" | "system";
  text: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export type TaskEventType =
  | "stage_start"
  | "thinking"
  | "tool_call"
  | "artifact"
  | "stage_done"
  | "review"
  | "error"
  | "pipeline_done";

export interface TaskEventDto {
  seq: number;
  ts: string;
  type: TaskEventType;
  agentId?: string;
  agentName?: string;
  title: string;
  detail?: {
    text?: string;
    platform?: PlatformId;
    score?: number;
    verdict?: "pass" | "revise";
    toolName?: string;
    artifactId?: string;
    [k: string]: unknown;
  };
}

// ===== Prompt packs (text/image/video prompt generators) =====

export interface PromptPackDto {
  id: string;
  platform: PlatformId | null;
  kind: "text" | "image" | "video";
  /** the researched, refined prompt ready to paste into a generator */
  prompt: string;
  /** why the prompt is shaped this way (shown as know-how) */
  rationale: string;
  /** model the pack was tuned for, e.g. 'gpt-image-1' / 'veo' */
  targetModel?: string;
  createdAt: string;
}

export interface ImageArtifactDto {
  id: string;
  platform: PlatformId | null;
  url: string; // presigned MinIO URL
  prompt: string;
  model: string;
  createdAt: string;
}

// ===== Usage / cost =====

export interface UsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface UsageBucket extends UsageTotals {
  /** task id, ISO date (daily) or ISO week 'YYYY-Www' (weekly) */
  key: string;
  label: string;
}

export interface UsageReport {
  scope: "task" | "daily" | "weekly";
  totals: UsageTotals;
  buckets: UsageBucket[];
  byAgent: (UsageTotals & { agentId: string })[];
  byModel: (UsageTotals & { modelId: string })[];
}

// ===== Auth / users =====

export interface UserDto {
  id: string;
  username: string;
  displayName: string;
  role: "user" | "admin";
  avatarUrl?: string;
  settings: UserSettings;
  createdAt: string;
}

export interface UserSettings {
  defaultPlatforms?: PlatformId[];
  hintsEnabled?: boolean;
  locale?: "zh" | "en";
  /** cost display currency; the ledger is always USD */
  currency?: "USD" | "CNY";
}

/** GET /api/fx — display exchange rate (live mid-market or fixed fallback). */
export interface FxRateDto {
  base: "USD";
  quote: "CNY";
  rate: number;
  source: "live" | "fallback";
  fetchedAt: string;
}

export interface RegisterResponse {
  user: UserDto;
  /** shown ONCE at registration; used for on-screen password reset */
  recoveryCode: string;
}

// ===== Admin =====

export interface AgentDto {
  id: string;
  name: string;
  roleTitle: string;
  description: string;
  modelId: string;
  fallbackModelId?: string;
  tools: string[];
  enabled: boolean;
  activePromptVersion: number;
  promptCount: number;
}

export interface PromptVersionDto {
  id: string;
  agentId: string;
  version: number;
  template: string;
  notes: string;
  status: "active" | "proposed" | "retired";
  scoreAvg: number | null;
  scoreN: number;
  createdAt: string;
}

export interface ModelDto {
  id: string;
  provider: "openai" | "moonshot" | "minimax" | "openrouter";
  kind: "text" | "multimodal" | "image";
  inputCostPerM: number;
  outputCostPerM: number;
  enabled: boolean;
  valid: boolean | null;
  lastValidatedAt: string | null;
}

export interface SkillDto {
  id: string;
  platform: PlatformId | null;
  name: string;
  content: string;
  version: number;
  status: string;
  updatedAt: string;
}

export interface EvolutionRunDto {
  id: string;
  ts: string;
  trigger: "manual" | "auto";
  reportMd: string;
  proposals: { agentId: string; fromVersion: number; toVersion: number; rationale: string }[];
}

// ===== Files =====

export interface FileDto {
  id: string;
  name: string;
  mime: string;
  size: number;
  status: "uploaded" | "extracting" | "extracted" | "failed";
  extractedChars?: number;
  taskId?: string;
  createdAt: string;
  url?: string;
}

// ===== SSE wire format =====
// GET /api/tasks/:id/stream emits `data: <json>` lines where json is:
//   { kind: "event", event: TaskEventDto }
//   { kind: "status", status: TaskStatus, stage: PipelineStage | null }
//   { kind: "message", message: ChatMessageDto }
//   { kind: "usage", usage: UsageTotals }   (task-scoped running total)
//   { kind: "done" }
export type StreamPayload =
  | { kind: "event"; event: TaskEventDto }
  | { kind: "status"; status: TaskStatus; stage: PipelineStage | null }
  | { kind: "message"; message: ChatMessageDto }
  | { kind: "usage"; usage: UsageTotals }
  | { kind: "done" };
