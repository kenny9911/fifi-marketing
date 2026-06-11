import type { PlatformId } from "@/lib/types";
import { getPlatform } from "@/lib/platforms";
import { db, nowIso, uid } from "@/server/db";
import { emitEvent } from "@/server/pipeline/events";
import {
  callAgent,
  getSetting,
  insertArtifact,
  num,
  obj,
  str,
  strArr,
  userPayload,
  briefForPrompt,
  type DraftRecord,
  type StageCtx,
} from "@/server/pipeline/stages/common";

export interface Critique {
  score: number;
  verdict: "pass" | "revise";
  rubric: Record<string, unknown>;
  comments: string;
}

function insertReview(
  ctx: StageCtx,
  platform: PlatformId,
  draftVersion: number,
  critique: Critique,
): void {
  db.prepare(
    "INSERT INTO reviews (id, task_id, platform, draft_version, score, rubric_json, verdict, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    uid(),
    ctx.taskId,
    platform,
    draftVersion,
    critique.score,
    JSON.stringify(critique.rubric),
    critique.verdict,
    nowIso(),
  );
}

/** Rolling critic score on the crafter's active prompt version (feeds evolution). */
function updatePromptScore(agentId: string, score: number): void {
  try {
    const row = db
      .prepare<unknown[], { id: string; score_avg: number | null; score_n: number }>(
        "SELECT id, score_avg, score_n FROM prompts WHERE agent_id = ? AND status = 'active' LIMIT 1",
      )
      .get(agentId);
    if (!row) return;
    const n = row.score_n + 1;
    const avg = ((row.score_avg ?? 0) * row.score_n + score) / n;
    db.prepare("UPDATE prompts SET score_avg = ?, score_n = ? WHERE id = ?").run(avg, n, row.id);
  } catch (err) {
    console.warn(`[pipeline] prompt score update failed for ${agentId}: ${err}`);
  }
}

/**
 * Stage 5 — 毒舌评审 (critic): scores each platform draft 0–100 against the
 * rubric (hook / platform fit / audience / CTA / compliance). Each score is
 * persisted to `reviews` and surfaced as a `review` event.
 */
export async function criticStage(
  ctx: StageCtx,
  drafts: Map<PlatformId, DraftRecord>,
  platforms: PlatformId[],
): Promise<Map<PlatformId, Critique>> {
  const passScore = num(getSetting("review_pass_score", 75), 75);
  const critiques = new Map<PlatformId, Critique>();

  await Promise.all(
    platforms.map(async (platform) => {
      const rec = drafts.get(platform);
      const name = getPlatform(platform).name;
      if (!rec) return;

      let critique: Critique;
      if (rec.shape.error) {
        critique = {
          score: 0,
          verdict: "revise",
          rubric: { error: "草稿生成失败，无法评审" },
          comments: "草稿生成失败，需要按简报重新撰写。",
        };
      } else {
        try {
          const res = await callAgent({
            ctx,
            agentId: "critic",
            purpose: `pipeline:critic:${platform}`,
            platform,
            user: userPayload(
              `请按评分细则毒舌评审这篇 ${name} 内容（0-100 分，及格线 ${passScore}）。` +
                '严格输出 JSON：{"thinking":"1-3句评审思路","score":82,"rubric":{"hook":{"score":80,"comment":""},"platformFit":{"score":85,"comment":""},"audience":{"score":80,"comment":""},"cta":{"score":78,"comment":""},"compliance":{"score":95,"comment":""}},"comments":"总评与修改要点"}',
              {
                brief: briefForPrompt(ctx.brief),
                platform: `${platform}（${name}）`,
                draft: rec.shape,
              },
            ),
          });
          const rawScore = num(res.parsed?.score, NaN);
          if (Number.isFinite(rawScore)) {
            const score = Math.max(0, Math.min(100, rawScore));
            const comments =
              str(res.parsed?.comments) || strArr(res.parsed?.comments).join("；");
            critique = {
              score,
              verdict: score >= passScore ? "pass" : "revise",
              rubric: obj(res.parsed?.rubric) ?? {},
              comments,
            };
          } else {
            // 评审降级：放行以避免无意义的回炉循环
            critique = {
              score: passScore,
              verdict: "pass",
              rubric: { degraded: true },
              comments: "评审模型不可用，默认放行。",
            };
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          emitEvent(ctx.taskId, {
            type: "error",
            agentId: "critic",
            title: `${name} 评审失败，默认放行`,
            detail: { text: reason, platform },
          });
          critique = {
            score: passScore,
            verdict: "pass",
            rubric: { degraded: true, error: reason },
            comments: "评审异常，默认放行。",
          };
        }
      }

      insertReview(ctx, platform, rec.version, critique);
      insertArtifact(
        ctx,
        platform,
        "critique",
        { ...critique, draftVersion: rec.version },
        { agentId: "critic", silent: true },
      );
      if (!rec.shape.error) {
        updatePromptScore(`crafter:${platform}`, critique.score);
      }
      emitEvent(ctx.taskId, {
        type: "review",
        agentId: "critic",
        title: `${name} 评分 ${Math.round(critique.score)} · ${critique.verdict === "pass" ? "通过" : "需修改"}`,
        detail: {
          platform,
          score: critique.score,
          verdict: critique.verdict,
          text: critique.comments,
        },
      });
      critiques.set(platform, critique);
    }),
  );

  return critiques;
}
