import type { PlatformId } from "@/lib/types";
import { getPlatform } from "@/lib/platforms";
import { db, nowIso, uid } from "@/server/db";
import { runEvolution } from "@/server/evolve";
import { emitEvent } from "@/server/pipeline/events";
import type { Critique } from "@/server/pipeline/stages/critic";
import {
  callAgent,
  errorDraft,
  getSetting,
  insertArtifact,
  num,
  str,
  userPayload,
  briefForPrompt,
  type DraftRecord,
  type StageCtx,
} from "@/server/pipeline/stages/common";

/**
 * Auto-evolution hook (SPEC §4): after every N completed tasks. Called by the
 * orchestrator once the task status has flipped to done.
 */
export function maybeAutoEvolve(): void {
  try {
    const n = num(getSetting("auto_evolve_after_tasks", 10), 10);
    if (n <= 0) return;
    const row = db
      .prepare<unknown[], { c: number }>("SELECT COUNT(*) AS c FROM tasks WHERE status = 'done'")
      .get();
    const done = row?.c ?? 0;
    if (done > 0 && done % n === 0) {
      console.log(`[evolve] auto trigger after ${done} completed tasks`);
      void runEvolution("auto").catch((err) =>
        console.warn(`[evolve] auto run failed: ${err instanceof Error ? err.message : err}`),
      );
    }
  } catch (err) {
    console.warn(`[evolve] auto trigger check failed: ${err}`);
  }
}

/**
 * Stage 8 — 定稿交付 (finalizer): writes one versioned `final` artifact per
 * platform and posts the AI summary message. The orchestrator then emits
 * pipeline_done and sets the terminal status — `done` normally, `reviewing`
 * when force-finalized with 残留问题 after the revision cycles ran out —
 * so the event stream stays strictly ordered.
 */
export async function finalizeStage(
  ctx: StageCtx,
  drafts: Map<PlatformId, DraftRecord>,
  critiques: Map<PlatformId, Critique>,
  residual: { platform: PlatformId; directives: string }[],
): Promise<{ residualPlatforms: PlatformId[] }> {
  if (residual.length > 0) {
    emitEvent(ctx.taskId, {
      type: "review",
      agentId: "reviewer",
      title: `修改轮次用尽，强制定稿（残留问题：${residual.map((r) => getPlatform(r.platform).name).join("、")}）`,
      detail: {
        verdict: "revise",
        text: residual.map((r) => `${getPlatform(r.platform).name}：${r.directives}`).join("\n"),
      },
    });
  }

  const scoreboard = ctx.brief.platforms.map((platform) => ({
    platform,
    name: getPlatform(platform).name,
    score: critiques.get(platform)?.score ?? null,
    failed: drafts.get(platform)?.shape.error === true,
    residual: residual.some((r) => r.platform === platform),
  }));

  const res = await callAgent({
    ctx,
    agentId: "finalizer",
    purpose: "pipeline:finalize",
    user: userPayload(
      "全部内容已定稿，请写一段交付总结发给用户（亲切中文，提到各平台与评分亮点，如有残留问题请如实说明并建议在对话中发修改意见）。" +
        '严格输出 JSON：{"thinking":"1-3句交付思路","summary":"交付总结（120-250字）"}',
      {
        brief: briefForPrompt(ctx.brief),
        scoreboard,
        titles: Object.fromEntries(
          ctx.brief.platforms.map((p) => [p, str((drafts.get(p)?.shape as { title?: unknown } | undefined)?.title)]),
        ),
      },
    ),
  });

  // Publish finals (one per platform, version bump on revisions).
  for (const platform of ctx.brief.platforms) {
    const rec = drafts.get(platform);
    const content =
      rec && !rec.shape.error
        ? rec.shape
        : errorDraft(platform, "内容生成失败，本次未能交付该平台稿件。");
    insertArtifact(ctx, platform, "final", content, { agentId: "finalizer" });
  }

  const fallbackSummary = `内容已交付：${scoreboard
    .map((s) => `${s.name}${s.score !== null ? ` ${Math.round(s.score)}分` : ""}${s.failed ? "（生成失败）" : ""}`)
    .join("、")}。${
    residual.length
      ? `其中 ${residual.map((r) => getPlatform(r.platform).name).join("、")} 仍有待打磨，可在对话中发送修改意见继续优化。`
      : "如需调整，直接在对话中发送修改意见即可。"
  }`;
  const summaryText = str(res.parsed?.summary) || res.content.trim() || fallbackSummary;

  db.prepare(
    "INSERT INTO messages (id, task_id, role, text, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    uid(),
    ctx.taskId,
    "ai",
    summaryText,
    JSON.stringify({ kind: "pipeline_summary", residual: residual.map((r) => r.platform) }),
    nowIso(),
  );

  return { residualPlatforms: residual.map((r) => r.platform) };
}
