import { db } from "./db";
import type { UsageBucket, UsageReport, UsageTotals } from "@/lib/api-types";

const DAY_MS = 86_400_000;

interface AggRow {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

const AGG_COLS = `COUNT(*) AS calls,
  COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
  COALESCE(SUM(completion_tokens), 0) AS completionTokens,
  COALESCE(SUM(cost_usd), 0) AS costUsd`;

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function toTotals(row: AggRow | undefined): UsageTotals {
  return {
    calls: row?.calls ?? 0,
    promptTokens: row?.promptTokens ?? 0,
    completionTokens: row?.completionTokens ?? 0,
    costUsd: round6(row?.costUsd ?? 0),
  };
}

function emptyTotals(): UsageTotals {
  return { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
}

/** UTC date string YYYY-MM-DD for a Date. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO-8601 week key 'YYYY-Www' (UTC) for a Date. */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday decides the ISO year
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.floor((date.getTime() - week1Monday.getTime()) / (7 * DAY_MS)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Aggregate llm_calls into a UsageReport (req 5).
 *
 * - scope "task": one bucket per task (newest 50 by latest call); optional taskId narrows to one.
 * - scope "daily": one bucket per UTC date over the last N days (zero days included).
 * - scope "weekly": one bucket per ISO week covering the last N days (zero weeks included).
 *
 * Authorization is the caller's responsibility — `userId` is applied verbatim as a filter
 * (undefined = all users, admin only).
 */
export function usageReport(opts: {
  scope: "task" | "daily" | "weekly";
  userId?: string;
  taskId?: string;
  days?: number;
}): UsageReport {
  const { scope, userId, taskId } = opts;
  const days =
    opts.days && Number.isFinite(opts.days) && opts.days > 0
      ? Math.min(Math.floor(opts.days), 365)
      : scope === "weekly"
        ? 56
        : 14;

  // Shared WHERE fragment + params for every aggregation pass.
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (userId) {
    where.push("user_id = ?");
    params.push(userId);
  }
  if (scope === "task" && taskId) {
    where.push("task_id = ?");
    params.push(taskId);
  }

  let windowStart: Date | null = null;
  if (scope === "daily" || scope === "weekly") {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    if (scope === "weekly") {
      // Align to the Monday of the ISO week containing the window start.
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    }
    windowStart = start;
    where.push("ts >= ?");
    params.push(start.toISOString());
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // ---- totals (single GROUP-less pass) ----
  const totalsRow = db
    .prepare(`SELECT ${AGG_COLS} FROM llm_calls ${whereSql}`)
    .get(...params) as AggRow | undefined;
  const totals = toTotals(totalsRow);

  // ---- buckets ----
  let buckets: UsageBucket[];
  if (scope === "task") {
    const taskClauses = ["l.task_id IS NOT NULL"];
    const taskParams: (string | number)[] = [];
    if (userId) {
      taskClauses.push("l.user_id = ?");
      taskParams.push(userId);
    }
    if (taskId) {
      taskClauses.push("l.task_id = ?");
      taskParams.push(taskId);
    }
    const rows = db
      .prepare(
        `SELECT l.task_id AS key, COALESCE(t.title, l.task_id) AS label,
                COUNT(*) AS calls,
                COALESCE(SUM(l.prompt_tokens), 0) AS promptTokens,
                COALESCE(SUM(l.completion_tokens), 0) AS completionTokens,
                COALESCE(SUM(l.cost_usd), 0) AS costUsd,
                MAX(l.ts) AS lastTs
         FROM llm_calls l
         LEFT JOIN tasks t ON t.id = l.task_id
         WHERE ${taskClauses.join(" AND ")}
         GROUP BY l.task_id
         ORDER BY lastTs DESC
         LIMIT 50`,
      )
      .all(...taskParams) as (AggRow & { key: string; label: string; lastTs: string })[];
    buckets = rows.map((r) => ({ key: r.key, label: r.label, ...toTotals(r) }));
  } else {
    // One pass grouped by UTC date; folded into days or ISO weeks with zero-fill.
    const rows = db
      .prepare(
        `SELECT substr(ts, 1, 10) AS day, ${AGG_COLS}
         FROM llm_calls ${whereSql}
         GROUP BY substr(ts, 1, 10)
         ORDER BY day`,
      )
      .all(...params) as (AggRow & { day: string })[];

    const byKey = new Map<string, UsageTotals>();
    for (const r of rows) {
      const dayDate = new Date(`${r.day}T00:00:00.000Z`);
      if (Number.isNaN(dayDate.getTime())) continue;
      const key = scope === "daily" ? r.day : isoWeekKey(dayDate);
      const acc = byKey.get(key) ?? emptyTotals();
      acc.calls += r.calls;
      acc.promptTokens += r.promptTokens;
      acc.completionTokens += r.completionTokens;
      acc.costUsd += r.costUsd;
      byKey.set(key, acc);
    }

    buckets = [];
    const seen = new Set<string>();
    const start = windowStart as Date;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let t = start.getTime(); t <= today.getTime(); t += DAY_MS) {
      const d = new Date(t);
      const key = scope === "daily" ? isoDate(d) : isoWeekKey(d);
      if (seen.has(key)) continue;
      seen.add(key);
      const agg = byKey.get(key) ?? emptyTotals();
      buckets.push({
        key,
        label: scope === "daily" ? key.slice(5) : key,
        calls: agg.calls,
        promptTokens: agg.promptTokens,
        completionTokens: agg.completionTokens,
        costUsd: round6(agg.costUsd),
      });
    }
  }

  // ---- byAgent / byModel (one GROUP BY pass each, same filters) ----
  const byAgent = (
    db
      .prepare(
        `SELECT agent_id AS agentId, ${AGG_COLS}
         FROM llm_calls
         ${whereSql ? `${whereSql} AND` : "WHERE"} agent_id IS NOT NULL
         GROUP BY agent_id
         ORDER BY costUsd DESC`,
      )
      .all(...params) as (AggRow & { agentId: string })[]
  ).map((r) => ({ agentId: r.agentId, ...toTotals(r) }));

  const byModel = (
    db
      .prepare(
        `SELECT model_id AS modelId, ${AGG_COLS}
         FROM llm_calls ${whereSql}
         GROUP BY model_id
         ORDER BY costUsd DESC`,
      )
      .all(...params) as (AggRow & { modelId: string })[]
  ).map((r) => ({ modelId: r.modelId, ...toTotals(r) }));

  return { scope, totals, buckets, byAgent, byModel };
}
