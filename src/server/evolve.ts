import { db, uid, nowIso } from "./db";
import { chatComplete } from "./llm/client";
import type { EvolutionRunDto } from "@/lib/api-types";

interface CallAggRow {
  agent_id: string | null;
  model_id: string;
  calls: number;
  errors: number;
  fallbacks: number;
  avg_latency_ms: number;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
}

interface ReviewAggRow {
  platform: string;
  n: number;
  avg_score: number;
  min_score: number;
  max_score: number;
  passes: number;
}

interface PromptRow {
  agent_id: string;
  version: number;
  score_avg: number | null;
  score_n: number;
}

interface StageEventRow {
  task_id: string;
  ts: string;
  type: string;
  title: string;
  detail_json: string;
}

interface LowDraftRow {
  task_id: string;
  platform: string;
  draft_version: number;
  score: number;
  rubric_json: string;
  content_json: string | null;
}

interface Proposal {
  agentId: string;
  fromVersion: number;
  toVersion: number;
  rationale: string;
}

function appSettingBool(key: string, fallback: boolean): boolean {
  const row = db
    .prepare("SELECT value_json FROM app_settings WHERE key = ?")
    .get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    const v = JSON.parse(row.value_json) as unknown;
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1) return true;
    if (v === "false" || v === 0) return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Incremental recompute of prompts.score_avg / score_n from window reviews.
 * Reviews are attributed to the crafter prompt version recorded in llm_calls
 * for the same task ('crafter:<platform>' → prompt_version).
 */
function updatePromptScores(cutoffIso: string): void {
  const groups = db
    .prepare(
      `WITH pv AS (
         SELECT task_id, agent_id, MAX(prompt_version) AS prompt_version
         FROM llm_calls
         WHERE prompt_version IS NOT NULL AND agent_id LIKE 'crafter:%'
         GROUP BY task_id, agent_id
       )
       SELECT pv.agent_id AS agentId, pv.prompt_version AS version,
              COUNT(*) AS n, COALESCE(SUM(r.score), 0) AS total
       FROM reviews r
       JOIN pv ON pv.task_id = r.task_id AND pv.agent_id = 'crafter:' || r.platform
       WHERE r.created_at >= ?
       GROUP BY pv.agent_id, pv.prompt_version`,
    )
    .all(cutoffIso) as { agentId: string; version: number; n: number; total: number }[];

  const getPrompt = db.prepare(
    "SELECT score_avg, score_n FROM prompts WHERE agent_id = ? AND version = ?",
  );
  const setScore = db.prepare(
    "UPDATE prompts SET score_avg = ?, score_n = ? WHERE agent_id = ? AND version = ?",
  );
  const apply = db.transaction((rows: typeof groups) => {
    for (const g of rows) {
      const cur = getPrompt.get(g.agentId, g.version) as
        | { score_avg: number | null; score_n: number }
        | undefined;
      if (!cur) continue;
      const n0 = cur.score_n ?? 0;
      const a0 = cur.score_avg ?? 0;
      const n1 = n0 + g.n;
      if (n1 <= 0) continue;
      const a1 = (a0 * n0 + g.total) / n1;
      setScore.run(round4(a1), n1, g.agentId, g.version);
    }
  });
  apply(groups);
}

/** Pair stage_start/stage_done events per task and return the slowest stages (avg ms). */
function slowestStages(cutoffIso: string): { stage: string; n: number; avgMs: number; maxMs: number }[] {
  const events = db
    .prepare(
      `SELECT task_id, ts, type, title, detail_json
       FROM task_events
       WHERE type IN ('stage_start', 'stage_done') AND ts >= ?
       ORDER BY task_id, seq`,
    )
    .all(cutoffIso) as StageEventRow[];

  const stageOf = (e: StageEventRow): string => {
    try {
      const detail = JSON.parse(e.detail_json) as { stage?: unknown };
      if (typeof detail.stage === "string" && detail.stage) return detail.stage;
    } catch {
      // fall through to title
    }
    return e.title;
  };

  const open = new Map<string, number>(); // `${taskId}::${stage}` → start epoch ms
  const agg = new Map<string, { n: number; total: number; max: number }>();
  for (const e of events) {
    const stage = stageOf(e);
    const key = `${e.task_id}::${stage}`;
    const t = Date.parse(e.ts);
    if (Number.isNaN(t)) continue;
    if (e.type === "stage_start") {
      open.set(key, t);
    } else {
      const started = open.get(key);
      if (started === undefined) continue;
      open.delete(key);
      const dur = Math.max(0, t - started);
      const a = agg.get(stage) ?? { n: 0, total: 0, max: 0 };
      a.n += 1;
      a.total += dur;
      a.max = Math.max(a.max, dur);
      agg.set(stage, a);
    }
  }

  return [...agg.entries()]
    .map(([stage, a]) => ({ stage, n: a.n, avgMs: Math.round(a.total / a.n), maxMs: a.max }))
    .sort((x, y) => y.avgMs - x.avgMs)
    .slice(0, 5);
}

function insertRun(run: {
  id: string;
  ts: string;
  trigger: "manual" | "auto";
  windowDays: number;
  reportMd: string;
  proposals: Proposal[];
  status: string;
}): void {
  db.prepare(
    `INSERT INTO evolution_runs (id, ts, trigger, window_days, report_md, proposals_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.id,
    run.ts,
    run.trigger,
    run.windowDays,
    run.reportMd,
    JSON.stringify(run.proposals),
    run.status,
  );
}

/**
 * Self-evolution run (req 10): aggregate window signals → reflector agent →
 * improvement report + prompt proposals (status 'proposed', auto-activated only
 * when app_settings.auto_activate_proposals is true).
 */
export async function runEvolution(
  trigger: "manual" | "auto",
  windowDays?: number,
): Promise<EvolutionRunDto> {
  const window = windowDays && Number.isFinite(windowDays) && windowDays > 0
    ? Math.min(Math.floor(windowDays), 90)
    : 7;
  const cutoffIso = new Date(Date.now() - window * 86_400_000).toISOString();
  const runId = uid();
  const ts = nowIso();

  // Keep prompt quality stats fresh regardless of whether the LLM pass runs.
  updatePromptScores(cutoffIso);

  // ---- Guard: not enough signal → stub report, no LLM call ----
  const completed = (
    db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND updated_at >= ?")
      .get(cutoffIso) as { n: number }
  ).n;
  if (completed < 3) {
    const reportMd = [
      "# 自进化复盘（已跳过）",
      "",
      `窗口期 ${window} 天内仅有 ${completed} 个已完成任务（少于 3 个），样本量不足以得出可靠结论，本次跳过 LLM 复盘分析。`,
      "",
      "建议：积累更多已完成任务后再触发进化。",
    ].join("\n");
    insertRun({ id: runId, ts, trigger, windowDays: window, reportMd, proposals: [], status: "skipped" });
    return { id: runId, ts, trigger, reportMd, proposals: [] };
  }

  // ---- Gather window stats ----
  const callAgg = db
    .prepare(
      `SELECT agent_id, model_id, COUNT(*) AS calls,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
              SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) AS fallbacks,
              CAST(ROUND(AVG(latency_ms)) AS INTEGER) AS avg_latency_ms,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens
       FROM llm_calls
       WHERE ts >= ?
       GROUP BY agent_id, model_id
       ORDER BY calls DESC`,
    )
    .all(cutoffIso) as CallAggRow[];

  const reviewAgg = db
    .prepare(
      `SELECT platform, COUNT(*) AS n,
              AVG(score) AS avg_score, MIN(score) AS min_score, MAX(score) AS max_score,
              SUM(CASE WHEN verdict = 'pass' THEN 1 ELSE 0 END) AS passes
       FROM reviews
       WHERE created_at >= ?
       GROUP BY platform
       ORDER BY avg_score ASC`,
    )
    .all(cutoffIso) as ReviewAggRow[];

  const activePrompts = db
    .prepare(
      `SELECT agent_id, version, score_avg, score_n
       FROM prompts WHERE status = 'active' ORDER BY agent_id`,
    )
    .all() as PromptRow[];

  const stages = slowestStages(cutoffIso);

  const lowDrafts = db
    .prepare(
      `SELECT r.task_id, r.platform, r.draft_version, r.score, r.rubric_json,
              (SELECT a.content_json FROM artifacts a
                WHERE a.task_id = r.task_id AND a.platform = r.platform
                  AND a.type = 'draft' AND a.version = r.draft_version
                LIMIT 1) AS content_json
       FROM reviews r
       WHERE r.created_at >= ?
       ORDER BY r.score ASC
       LIMIT 3`,
    )
    .all(cutoffIso) as LowDraftRow[];

  // ---- Build the digest for the reflector ----
  const lines: string[] = [];
  lines.push(`以下是过去 ${window} 天（窗口起点 ${cutoffIso}）平台运行数据，请进行自进化复盘分析。`);
  lines.push("", `已完成任务数: ${completed}`);

  lines.push("", "## LLM 调用统计（按 agent+model，含错误率/降级率）");
  if (callAgg.length === 0) lines.push("(无调用记录)");
  for (const c of callAgg) {
    const errRate = c.calls ? round4(c.errors / c.calls) : 0;
    const fbRate = c.calls ? round4(c.fallbacks / c.calls) : 0;
    lines.push(
      `- ${c.agent_id ?? "(无agent)"} @ ${c.model_id}: calls=${c.calls}, errorRate=${errRate}, fallbackRate=${fbRate}, avgLatencyMs=${c.avg_latency_ms ?? 0}, costUsd=${round4(c.cost_usd)}, tokens=${c.prompt_tokens}+${c.completion_tokens}`,
    );
  }

  lines.push("", "## 评审得分分布（按平台）");
  if (reviewAgg.length === 0) lines.push("(无评审记录)");
  for (const r of reviewAgg) {
    lines.push(
      `- ${r.platform}: n=${r.n}, avg=${round4(r.avg_score)}, min=${r.min_score}, max=${r.max_score}, passRate=${round4(r.passes / r.n)}`,
    );
  }

  lines.push("", "## 当前激活提示词版本及质量分");
  for (const p of activePrompts) {
    lines.push(
      `- ${p.agent_id} v${p.version}: score_avg=${p.score_avg ?? "暂无"}, score_n=${p.score_n}`,
    );
  }

  lines.push("", "## 最慢阶段（按平均耗时）");
  if (stages.length === 0) lines.push("(无阶段耗时数据)");
  for (const s of stages) {
    lines.push(`- ${s.stage}: n=${s.n}, avgMs=${s.avgMs}, maxMs=${s.maxMs}`);
  }

  lines.push("", "## 得分最低的 3 篇草稿摘录");
  if (lowDrafts.length === 0) lines.push("(无草稿评审记录)");
  for (const d of lowDrafts) {
    const excerpt = (d.content_json ?? "(草稿内容缺失)").slice(0, 400);
    lines.push(
      `- 平台 ${d.platform} / 任务 ${d.task_id} / v${d.draft_version} / 得分 ${d.score}`,
      `  评语: ${d.rubric_json.slice(0, 300)}`,
      `  摘录: ${excerpt}`,
    );
  }

  lines.push(
    "",
    "请输出严格 JSON：",
    '{"thinking": "1-3句中文分析摘要", "report_md": "完整的中文改进计划 Markdown（含问题诊断、数据证据、行动建议）", "proposals": [{"agentId": "需要改进的 agent id", "newTemplate": "完整的新版系统提示词模板（含 {{var}} 占位符）", "rationale": "改动理由"}]}',
    "proposals 只针对确有数据支撑、需要改进的 agent，可以为空数组。",
  );

  // ---- Reflector pass ----
  let reportMd: string;
  let rawProposals: { agentId?: unknown; newTemplate?: unknown; rationale?: unknown }[] = [];
  try {
    const res = await chatComplete({
      agentId: "reflector",
      json: true,
      purpose: "evolve",
      messages: [{ role: "user", content: lines.join("\n") }],
    });
    let parsed = res.parsed as
      | { thinking?: unknown; report_md?: unknown; proposals?: unknown }
      | undefined;
    if (!parsed || typeof parsed !== "object") {
      try {
        parsed = JSON.parse(res.content) as typeof parsed;
      } catch {
        parsed = undefined;
      }
    }
    reportMd =
      typeof parsed?.report_md === "string" && parsed.report_md.trim()
        ? parsed.report_md
        : res.content;
    if (Array.isArray(parsed?.proposals)) {
      rawProposals = parsed.proposals as typeof rawProposals;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedMd = `# 自进化复盘失败\n\n复盘分析调用失败：${message}\n\n窗口期 ${window} 天，已完成任务 ${completed} 个。请稍后重试。`;
    insertRun({
      id: runId,
      ts,
      trigger,
      windowDays: window,
      reportMd: failedMd,
      proposals: [],
      status: "failed",
    });
    return { id: runId, ts, trigger, reportMd: failedMd, proposals: [] };
  }

  // ---- Persist run + prompt proposals ----
  const autoActivate = appSettingBool("auto_activate_proposals", false);
  const agentExists = db.prepare("SELECT id FROM agents WHERE id = ?");
  const maxVersion = db.prepare(
    "SELECT COALESCE(MAX(version), 0) AS v FROM prompts WHERE agent_id = ?",
  );
  const activeVersion = db.prepare(
    "SELECT version FROM prompts WHERE agent_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1",
  );
  const retireActive = db.prepare(
    "UPDATE prompts SET status = 'retired' WHERE agent_id = ? AND status = 'active'",
  );
  const insertPrompt = db.prepare(
    `INSERT INTO prompts (id, agent_id, version, template, notes, status, score_avg, score_n, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
  );

  const proposals: Proposal[] = [];
  const persist = db.transaction(() => {
    for (const raw of rawProposals) {
      const agentId = typeof raw.agentId === "string" ? raw.agentId : "";
      const newTemplate = typeof raw.newTemplate === "string" ? raw.newTemplate.trim() : "";
      const rationale =
        typeof raw.rationale === "string" && raw.rationale.trim()
          ? raw.rationale.trim()
          : "evolution proposal";
      if (!agentId || !newTemplate) continue;
      if (!agentExists.get(agentId)) continue;

      const maxV = (maxVersion.get(agentId) as { v: number }).v;
      const active = activeVersion.get(agentId) as { version: number } | undefined;
      const fromVersion = active?.version ?? maxV;
      const toVersion = maxV + 1;

      if (autoActivate) retireActive.run(agentId);
      insertPrompt.run(
        uid(),
        agentId,
        toVersion,
        newTemplate,
        rationale,
        autoActivate ? "active" : "proposed",
        nowIso(),
      );
      proposals.push({ agentId, fromVersion, toVersion, rationale });
    }
    insertRun({
      id: runId,
      ts,
      trigger,
      windowDays: window,
      reportMd,
      proposals,
      status: "completed",
    });
  });
  persist();

  return { id: runId, ts, trigger, reportMd, proposals };
}
