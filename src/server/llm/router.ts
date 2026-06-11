import { db, nowIso } from "../db";

/**
 * Model routing per SPEC §3:
 * - Canonical ids are OpenRouter-style `vendor/model`.
 * - Direct-provider preference when the matching key exists; everything else
 *   (and all missing-key cases) goes through OpenRouter with the full id.
 * - validateModelId() guards against ids unknown to the live provider lists —
 *   an unknown id is marked `valid=0` and never sent to a provider.
 */

export type ProviderName = "openai" | "moonshot" | "minimax" | "openrouter";

export interface ResolvedProvider {
  provider: ProviderName;
  baseURL: string;
  apiKey: string;
  /** the model id actually sent over the wire (prefix stripped for direct providers) */
  wireModelId: string;
}

/** Row shape of the `models` registry table. */
export interface ModelRow {
  id: string;
  provider: string;
  kind: "text" | "multimodal" | "image";
  input_cost_per_m: number;
  output_cost_per_m: number;
  context_len: number | null;
  enabled: number;
  last_validated_at: string | null;
  valid: number | null;
}

/** Minimal slice of an `agents` row needed to build a fallback chain. */
export interface AgentModelRow {
  model_id: string;
  fallback_model_id: string | null;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const MOONSHOT_BASE = "https://api.moonshot.ai/v1";
const MINIMAX_BASE = "https://api.minimax.io/v1";

function stripVendor(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}

/**
 * Resolve which provider serves a canonical model id. Returns null only when
 * no usable API key exists at all (not even OpenRouter).
 */
export function resolveProvider(modelId: string): ResolvedProvider | null {
  const openaiKey = process.env.OPENAI_API_KEY;
  const moonshotKey = process.env.MOONSHOT_API_KEY;
  const minimaxKey = process.env.MINIMAX_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (modelId.startsWith("openai/") && openaiKey) {
    return {
      provider: "openai",
      baseURL: OPENAI_BASE,
      apiKey: openaiKey,
      wireModelId: stripVendor(modelId),
    };
  }
  if (modelId.startsWith("moonshotai/") && moonshotKey) {
    return {
      provider: "moonshot",
      baseURL: MOONSHOT_BASE,
      apiKey: moonshotKey,
      wireModelId: stripVendor(modelId),
    };
  }
  if (modelId.startsWith("minimax/") && minimaxKey) {
    return {
      provider: "minimax",
      baseURL: MINIMAX_BASE,
      apiKey: minimaxKey,
      wireModelId: stripVendor(modelId),
    };
  }
  if (openrouterKey) {
    return {
      provider: "openrouter",
      baseURL: OPENROUTER_BASE,
      apiKey: openrouterKey,
      wireModelId: modelId,
    };
  }
  return null;
}

export function getModelRow(id: string): ModelRow | undefined {
  return db.prepare("SELECT * FROM models WHERE id = ?").get(id) as ModelRow | undefined;
}

// ---- live model-list cache (in-process, 1h TTL) ----

interface ListCacheEntry {
  ts: number;
  ids: Set<string>;
}

const LIST_TTL_MS = 60 * 60 * 1000;

function listCache(): Map<string, ListCacheEntry> {
  const g = globalThis as { __fifiModelLists?: Map<string, ListCacheEntry> };
  if (!g.__fifiModelLists) g.__fifiModelLists = new Map();
  return g.__fifiModelLists;
}

/**
 * Fetch (with 1h cache) the set of model ids a provider reports via
 * `GET {baseURL}/models`. Returns null on any infrastructure failure so the
 * caller can degrade to registry-only validation.
 */
async function fetchLiveModelIds(resolved: ResolvedProvider): Promise<Set<string> | null> {
  const cache = listCache();
  const hit = cache.get(resolved.baseURL);
  if (hit && Date.now() - hit.ts < LIST_TTL_MS) return hit.ids;

  try {
    const res = await fetch(`${resolved.baseURL}/models`, {
      headers: { Authorization: `Bearer ${resolved.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[llm/router] GET ${resolved.baseURL}/models -> HTTP ${res.status}; falling back to registry-only validation`);
      return null;
    }
    const body = (await res.json()) as { data?: { id?: string }[] };
    const ids = new Set<string>();
    for (const m of body.data ?? []) {
      if (m && typeof m.id === "string") ids.add(m.id);
    }
    cache.set(resolved.baseURL, { ts: Date.now(), ids });
    return ids;
  } catch (err) {
    console.warn(
      `[llm/router] failed to fetch live model list from ${resolved.baseURL}: ${err instanceof Error ? err.message : String(err)}; falling back to registry-only validation`,
    );
    return null;
  }
}

function persistValidation(id: string, ok: boolean): void {
  try {
    db.prepare("UPDATE models SET valid = ?, last_validated_at = ? WHERE id = ?").run(
      ok ? 1 : 0,
      nowIso(),
      id,
    );
  } catch (err) {
    console.warn(`[llm/router] failed to persist validation for ${id}:`, err);
  }
}

/**
 * Validate a canonical model id:
 * 1. must exist in the `models` registry and be enabled;
 * 2. must appear in the live provider model list (OpenRouter / OpenAI /
 *    Moonshot — MiniMax has no reliable list endpoint, so the registry is
 *    trusted there).
 * Live-list infrastructure failures never block: we degrade to registry-only
 * with a console.warn. Definitive results are persisted to
 * `models.valid` / `models.last_validated_at`.
 */
export async function validateModelId(id: string): Promise<boolean> {
  const row = getModelRow(id);
  if (!row) return false; // unknown to the registry → never sent to a provider
  if (!row.enabled) return false;

  const resolved = resolveProvider(id);
  if (!resolved) return false; // no usable key anywhere → unusable

  // Mock test mode: trust the registry, never touch the network.
  if (process.env.TEST_MODE === "mock") {
    persistValidation(id, true);
    return true;
  }

  // MiniMax: skip the live check, trust the registry.
  if (resolved.provider === "minimax") {
    persistValidation(id, true);
    return true;
  }

  const liveIds = await fetchLiveModelIds(resolved);
  if (liveIds === null) {
    // Infrastructure failure → degrade to the registry verdict; do not
    // overwrite a prior verdict, and honor it: a model previously rejected by
    // the live list (valid=0) is still never sent to a provider (SPEC §3.3).
    // NULL (never validated) stays permissive.
    return row.valid !== 0;
  }

  const ok = liveIds.has(resolved.wireModelId);
  persistValidation(id, ok);
  if (!ok) {
    console.warn(`[llm/router] model ${id} rejected by ${resolved.provider} live list (marked valid=0)`);
  }
  return ok;
}

/** Cheapest enabled (and not explicitly invalid) text model in the registry. */
function cheapestTextModelId(): string | null {
  const row = db
    .prepare(
      `SELECT id FROM models
       WHERE enabled = 1
         AND kind IN ('text', 'multimodal')
         AND (valid IS NULL OR valid = 1)
       ORDER BY (input_cost_per_m + output_cost_per_m) ASC, id ASC
       LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Fallback chain per SPEC §3.4:
 * agent.fallback_model_id → LLM_MODEL_DEFAULT env → cheapest enabled+valid
 * text model from the registry. De-duplicated, order preserved.
 */
export function fallbackChain(agentRow: AgentModelRow | null): string[] {
  const chain: string[] = [];
  const push = (id: string | null | undefined) => {
    if (id && !chain.includes(id)) chain.push(id);
  };
  push(agentRow?.fallback_model_id);
  push(process.env.LLM_MODEL_DEFAULT);
  push(cheapestTextModelId());
  return chain;
}
