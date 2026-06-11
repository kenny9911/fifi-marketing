import type { PlatformId } from "@/lib/types";
import { getPlatform } from "@/lib/platforms";
import { emitEvent } from "@/server/pipeline/events";
import {
  callAgent,
  insertArtifact,
  normalizeDraft,
  shapeSpec,
  skillsForPlatform,
  userPayload,
  briefForPrompt,
  type DraftRecord,
  type StageCtx,
} from "@/server/pipeline/stages/common";

/**
 * Stage 7 — 回炉重写 (re-editor): applies the reviewer's directives to the
 * failing platforms only. On failure the previous draft is kept.
 */
export async function reeditStage(
  ctx: StageCtx,
  drafts: Map<PlatformId, DraftRecord>,
  failing: { platform: PlatformId; directives: string }[],
): Promise<Map<PlatformId, DraftRecord>> {
  await Promise.all(
    failing.map(async ({ platform, directives }) => {
      const name = getPlatform(platform).name;
      try {
        const current = drafts.get(platform);
        const res = await callAgent({
          ctx,
          agentId: "reeditor",
          purpose: `pipeline:reedit:${platform}`,
          platform,
          user: userPayload(
            `请按修改指令重写这篇 ${name} 内容（草稿生成失败时按简报从零撰写）。严格输出 JSON：${shapeSpec(platform)}`,
            {
              brief: briefForPrompt(ctx.brief),
              currentDraft: current?.shape ?? null,
              directives,
              platformSkills: skillsForPlatform(platform).slice(0, 6_000),
            },
          ),
        });
        if (!res.parsed) return; // degrade: keep previous draft (error already emitted)
        const shape = normalizeDraft(platform, res.parsed, ctx.brief.goal);
        const ref = insertArtifact(ctx, platform, "draft", shape, { agentId: "reeditor" });
        drafts.set(platform, { shape, version: ref.version });
      } catch (err) {
        emitEvent(ctx.taskId, {
          type: "error",
          agentId: "reeditor",
          title: `${name} 回炉失败，保留上一版草稿`,
          detail: { text: err instanceof Error ? err.message : String(err), platform },
        });
      }
    }),
  );
  return drafts;
}
