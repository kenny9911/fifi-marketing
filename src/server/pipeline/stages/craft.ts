import type { PlatformId } from "@/lib/types";
import { getPlatform } from "@/lib/platforms";
import { emitEvent } from "@/server/pipeline/events";
import type { PromptPack } from "@/server/pipeline/stages/promptCraft";
import {
  callAgent,
  errorDraft,
  insertArtifact,
  normalizeDraft,
  shapeSpec,
  skillsForPlatform,
  userPayload,
  briefForPrompt,
  type DraftRecord,
  type ResearchPack,
  type StageCtx,
} from "@/server/pipeline/stages/common";

/**
 * Stage 3 — 专家撰稿 (crafters), parallel per platform with per-platform
 * try/catch: one platform failing never kills the task (SPEC §2).
 */
export async function craftStage(
  ctx: StageCtx,
  research: ResearchPack,
  packs: PromptPack[],
): Promise<Map<PlatformId, DraftRecord>> {
  const drafts = new Map<PlatformId, DraftRecord>();

  await Promise.all(
    ctx.brief.platforms.map(async (platform) => {
      const agentId = `crafter:${platform}`;
      try {
        const p = getPlatform(platform);
        const pack = packs.find((x) => x.kind === "text" && x.platform === platform);
        const res = await callAgent({
          ctx,
          agentId,
          purpose: `pipeline:craft:${platform}`,
          platform,
          user: userPayload(
            `请以「${p.expert.name}」的身份为 ${p.name} 创作${p.job}。严格输出 JSON：${shapeSpec(platform)}`,
            {
              brief: briefForPrompt(ctx.brief),
              writingPrompt: pack?.prompt ?? "",
              researchSummary: research.summary,
              insights: research.insights,
              platformTrend: research.platformTrends[platform] ?? "",
              platformSkills: skillsForPlatform(platform).slice(0, 6_000),
            },
          ),
        });

        let shape;
        if (res.parsed) {
          shape = normalizeDraft(platform, res.parsed, ctx.brief.goal);
        } else if (res.content.trim()) {
          shape = normalizeDraft(
            platform,
            { title: ctx.brief.goal, sections: [res.content.trim()] },
            ctx.brief.goal,
          );
        } else {
          shape = errorDraft(platform, "撰稿模型两次调用均失败。");
        }
        const ref = insertArtifact(ctx, platform, "draft", shape, { agentId });
        drafts.set(platform, { shape, version: ref.version });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        emitEvent(ctx.taskId, {
          type: "error",
          agentId,
          title: `${getPlatform(platform).name} 撰稿失败，已降级`,
          detail: { text: reason, platform },
        });
        const shape = errorDraft(platform, reason);
        const ref = insertArtifact(ctx, platform, "draft", shape, { agentId });
        drafts.set(platform, { shape, version: ref.version });
      }
    }),
  );

  return drafts;
}
