import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { db, nowIso, uid } from "../db";
import { mockComplete } from "./mock";
import { fallbackChain, getModelRow, resolveProvider, validateModelId } from "./router";
import type { AgentModelRow, ResolvedProvider } from "./router";
import { costUsd } from "./usage-price";

/**
 * The single LLM entry point (SPEC §3). Every model call in the app — pipeline
 * stages, brief assistant, extraction, evolution — goes through chatComplete.
 * Every attempt (success AND failure) is logged to `llm_calls`.
 */

export type MultiModalPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string | MultiModalPart[];
}

export interface ChatCompleteOpts {
  /** resolves model + active prompt version from the agent registry */
  agentId?: string;
  /** explicit override (canonical id, e.g. 'openai/gpt-5.4') */
  model?: string;
  system?: string;
  messages: ChatMessageInput[];
  /** request JSON object output */
  json?: boolean;
  taskId?: string;
  userId?: string;
  /** e.g. 'pipeline:craft:xhs' */
  purpose: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Budget for the WHOLE call (all fallback candidates combined), default
   * 120_000. A multi-candidate chain never runs longer than this in total.
   */
  timeoutMs?: number;
  /**
   * External cancellation: aborts the in-flight provider request and stops
   * the candidate chain (no further fallbacks are attempted).
   */
  signal?: AbortSignal;
}

export interface ChatCompleteResult {
  content: string;
  parsed?: unknown;
  usage: { promptTokens: number; completionTokens: number; costUsd: number };
  model: string;
  provider: string;
  latencyMs: number;
}

interface AgentRow extends AgentModelRow {
  id: string;
  enabled: number;
}

interface ActivePrompt {
  version: number;
  template: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

// ---- provider client cache (one openai client per baseURL) ----

function clientCache(): Map<string, OpenAI> {
  const g = globalThis as { __fifiLlmClients?: Map<string, OpenAI> };
  if (!g.__fifiLlmClients) g.__fifiLlmClients = new Map();
  return g.__fifiLlmClients;
}

function clientFor(resolved: ResolvedProvider): OpenAI {
  const cache = clientCache();
  const key = `${resolved.baseURL}|${resolved.apiKey}`;
  let client = cache.get(key);
  if (!client) {
    client = new OpenAI({
      apiKey: resolved.apiKey,
      baseURL: resolved.baseURL,
      maxRetries: 0, // the fallback chain owns retry behavior
      defaultHeaders:
        resolved.provider === "openrouter"
          ? { "HTTP-Referer": "https://fifi.local", "X-Title": "FiFi Marketing" }
          : undefined,
    });
    cache.set(key, client);
  }
  return client;
}

// ---- helpers ----

function contentText(content: string | MultiModalPart[]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function countChars(messages: ChatMessageInput[]): number {
  return messages.reduce((sum, m) => sum + contentText(m.content).length, 0);
}

/** Replace {{var}} placeholders with values; unknown placeholders are left intact. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole,
  );
}

/**
 * Robust JSON extraction: direct parse → fenced block → first balanced {...}.
 * Returns undefined when no JSON object can be recovered.
 */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through to balanced scan
  }
  const start = t.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

interface CallLog {
  userId?: string;
  taskId?: string;
  agentId?: string;
  promptVersion: number | null;
  modelId: string;
  provider: string;
  purpose: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  status: "ok" | "error" | "fallback";
  error?: string;
  requestChars: number;
  responseChars: number;
}

function logCall(log: CallLog): void {
  try {
    db.prepare(
      `INSERT INTO llm_calls (
         id, ts, user_id, task_id, agent_id, prompt_version, model_id, provider,
         purpose, prompt_tokens, completion_tokens, cost_usd, latency_ms,
         status, error, request_chars, response_chars
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uid(),
      nowIso(),
      log.userId ?? null,
      log.taskId ?? null,
      log.agentId ?? null,
      log.promptVersion,
      log.modelId,
      log.provider,
      log.purpose,
      log.promptTokens,
      log.completionTokens,
      log.costUsd,
      log.latencyMs,
      log.status,
      log.error ?? null,
      log.requestChars,
      log.responseChars,
    );
  } catch (err) {
    // Logging must never break a call.
    console.error("[llm/client] failed to insert llm_calls row:", err);
  }
}

function getAgent(agentId: string): AgentRow | undefined {
  return db
    .prepare("SELECT id, model_id, fallback_model_id, enabled FROM agents WHERE id = ?")
    .get(agentId) as AgentRow | undefined;
}

function getActivePrompt(agentId: string): ActivePrompt | undefined {
  return db
    .prepare(
      "SELECT version, template FROM prompts WHERE agent_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1",
    )
    .get(agentId) as ActivePrompt | undefined;
}

function errMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

function dedupe(ids: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// ---- main entry point ----

export async function chatComplete(opts: ChatCompleteOpts): Promise<ChatCompleteResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Agent resolution: model + active prompt version from the registry.
  let agent: AgentRow | undefined;
  let activePrompt: ActivePrompt | undefined;
  if (opts.agentId) {
    agent = getAgent(opts.agentId);
    if (agent) activePrompt = getActivePrompt(agent.id);
    else console.warn(`[llm/client] unknown agentId "${opts.agentId}" — falling back to model resolution`);
  }
  const promptVersion = activePrompt ? activePrompt.version : null;

  // System prompt: explicit opts.system wins; otherwise the agent's active
  // template (vars travel in opts.messages, so the template renders with an
  // empty var map and unknown placeholders are preserved).
  let systemText = opts.system ?? (activePrompt ? renderTemplate(activePrompt.template, {}) : undefined);
  if (opts.json && !/json/i.test([systemText ?? "", ...opts.messages.map((m) => contentText(m.content))].join("\n"))) {
    // json_object mode requires the word JSON somewhere in the prompt.
    systemText = `${systemText ?? ""}${systemText ? "\n\n" : ""}请仅输出一个合法的 JSON 对象。`;
  }

  const finalMessages: ChatMessageInput[] = systemText
    ? [{ role: "system", content: systemText }, ...opts.messages]
    : [...opts.messages];
  const requestChars = countChars(finalMessages);

  // ---- TEST_MODE=mock short-circuit (still logs an llm_calls row) ----
  if (process.env.TEST_MODE === "mock") {
    const startedAt = Date.now();
    const mock = mockComplete({ ...opts, messages: finalMessages });
    const latencyMs = Date.now() - startedAt;
    const modelId = opts.model ?? agent?.model_id ?? process.env.LLM_MODEL_DEFAULT ?? "mock/fixture";
    const promptTokens = Math.ceil(requestChars / 4);
    const completionTokens = Math.ceil(mock.content.length / 4);
    logCall({
      userId: opts.userId,
      taskId: opts.taskId,
      agentId: opts.agentId,
      promptVersion,
      modelId,
      provider: "mock",
      purpose: opts.purpose,
      promptTokens,
      completionTokens,
      costUsd: 0,
      latencyMs,
      status: "ok",
      requestChars,
      responseChars: mock.content.length,
    });
    return {
      content: mock.content,
      parsed: mock.parsed,
      usage: { promptTokens, completionTokens, costUsd: 0 },
      model: modelId,
      provider: "mock",
      latencyMs,
    };
  }

  // ---- candidate chain: primary → fallback chain (SPEC §3.4) ----
  const primary = opts.model ?? agent?.model_id ?? process.env.LLM_MODEL_DEFAULT;
  const candidates = dedupe([primary, ...fallbackChain(agent ?? null)]);
  if (candidates.length === 0) {
    throw new Error(`chatComplete(${opts.purpose}): no model available (registry empty and no LLM_MODEL_DEFAULT)`);
  }

  // timeoutMs is call-scoped: one deadline shared across the whole candidate
  // chain, so N slow candidates can never run ~N × timeoutMs.
  const deadline = Date.now() + timeoutMs;

  let lastError = "no candidate model succeeded";
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (opts.signal?.aborted) {
      lastError = `${candidate}: skipped — aborted by caller`;
      break;
    }
    if (deadline - Date.now() <= 0) {
      lastError = `${candidate}: skipped — call timeout budget (${timeoutMs}ms) exhausted`;
      break;
    }
    const successStatus: "ok" | "fallback" = i === 0 ? "ok" : "fallback";
    const startedAt = Date.now();
    const resolved = resolveProvider(candidate);

    const failAttempt = (error: string) => {
      lastError = `${candidate}: ${error}`;
      logCall({
        userId: opts.userId,
        taskId: opts.taskId,
        agentId: opts.agentId,
        promptVersion,
        modelId: candidate,
        provider: resolved?.provider ?? "none",
        purpose: opts.purpose,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        status: "error",
        error,
        requestChars,
        responseChars: 0,
      });
    };

    if (!resolved) {
      failAttempt("no API key available for any provider");
      continue;
    }

    let valid = false;
    try {
      valid = await validateModelId(candidate);
    } catch (err) {
      console.warn(`[llm/client] validation crashed for ${candidate}:`, err);
      valid = false;
    }
    if (!valid) {
      failAttempt("model id failed validation (unknown/disabled) — not sent to provider");
      continue;
    }

    const controller = new AbortController();
    const onExternalAbort = () =>
      controller.abort(
        opts.signal?.reason instanceof Error ? opts.signal.reason : new Error("aborted by caller"),
      );
    opts.signal?.addEventListener("abort", onExternalAbort, { once: true });
    // Recompute the remaining budget right before the request (validation
    // above may have consumed part of it).
    const remainingMs = Math.max(1, deadline - Date.now());
    const timer = setTimeout(
      () => controller.abort(new Error(`timeout after ${remainingMs}ms (call budget ${timeoutMs}ms)`)),
      remainingMs,
    );
    try {
      const client = clientFor(resolved);
      const wantsJsonMode = Boolean(opts.json) && resolved.provider !== "minimax";
      const response = await client.chat.completions.create(
        {
          model: resolved.wireModelId,
          messages: finalMessages as ChatCompletionMessageParam[],
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(opts.maxTokens !== undefined
            ? resolved.provider === "openai"
              ? { max_completion_tokens: opts.maxTokens }
              : { max_tokens: opts.maxTokens }
            : {}),
          ...(wantsJsonMode ? { response_format: { type: "json_object" as const } } : {}),
        },
        { signal: controller.signal },
      );
      const latencyMs = Date.now() - startedAt;

      const content = response.choices?.[0]?.message?.content ?? "";
      const responseChars = content.length;
      const promptTokens = response.usage?.prompt_tokens ?? Math.ceil(requestChars / 4);
      const completionTokens = response.usage?.completion_tokens ?? Math.ceil(responseChars / 4);
      const cost = costUsd(getModelRow(candidate), promptTokens, completionTokens);
      const parsed = opts.json ? extractJson(content) : undefined;

      logCall({
        userId: opts.userId,
        taskId: opts.taskId,
        agentId: opts.agentId,
        promptVersion,
        modelId: candidate,
        provider: resolved.provider,
        purpose: opts.purpose,
        promptTokens,
        completionTokens,
        costUsd: cost,
        latencyMs,
        status: successStatus,
        requestChars,
        responseChars,
      });

      return {
        content,
        ...(parsed !== undefined ? { parsed } : {}),
        usage: { promptTokens, completionTokens, costUsd: cost },
        model: candidate,
        provider: resolved.provider,
        latencyMs,
      };
    } catch (err) {
      failAttempt(errMessage(err));
      // Caller cancelled — stop the chain instead of trying further candidates.
      if (opts.signal?.aborted) break;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  throw new Error(`chatComplete(${opts.purpose}) failed after ${candidates.length} model(s): ${lastError}`);
}
