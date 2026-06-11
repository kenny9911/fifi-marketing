import { ApiClientError } from "@/lib/client-api";

/**
 * Admin-console–local response helpers. All DTOs (AgentDto, PromptVersionDto,
 * ModelDto, SkillDto, EvolutionRunDto) live in src/lib/api-types.ts —
 * only console-private helpers belong here.
 */

/**
 * Admin routes wrap collections in an envelope (`{ agents: [...] }`).
 * Accept both the envelope and a bare array so the console stays tolerant.
 */
export function pluckArray<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

/** Single-object envelope variant (`{ agent: {...} }`). */
export function pluckOne<T>(payload: unknown, key: string): T | null {
  if (!payload || typeof payload !== "object") return null;
  if (key in (payload as Record<string, unknown>)) {
    const value = (payload as Record<string, unknown>)[key];
    return value && typeof value === "object" ? (value as T) : null;
  }
  return payload as T;
}

/**
 * Human-readable error for toasts. Expired sessions bounce straight back to
 * the login page (the API layer returns 401 once the cookie dies).
 */
export function describeError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 401) {
      if (typeof window !== "undefined") {
        window.location.assign("/login?next=/admin");
      }
      return "登录已过期，正在跳转登录页…";
    }
    if (err.status === 403) return "权限不足：该操作仅限管理员";
    return err.message || `请求失败（${err.status}）`;
  }
  return err instanceof Error && err.message ? err.message : "请求失败，请稍后重试";
}

/** '2026-06-12T03:21:00.000Z' → '2026-06-12 11:21'（本地时区）. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
