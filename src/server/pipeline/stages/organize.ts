import type { PlatformId } from "@/lib/types";
import {
  callAgent,
  insertArtifact,
  normalizeDraft,
  obj,
  shapeSpec,
  userPayload,
  briefForPrompt,
  type DraftRecord,
  type StageCtx,
} from "@/server/pipeline/stages/common";

/**
 * Stage 4 — 结构整理 (organizer): one consistency pass over all drafts that
 * normalizes them into the platform result shapes. On degradation the craft
 * drafts are kept as-is (no version bump for untouched platforms).
 */
export async function organizeStage(
  ctx: StageCtx,
  drafts: Map<PlatformId, DraftRecord>,
): Promise<Map<PlatformId, DraftRecord>> {
  const out = new Map(drafts);
  const editable = ctx.brief.platforms.filter((p) => !drafts.get(p)?.shape.error);
  if (editable.length === 0) return out;

  const res = await callAgent({
    ctx,
    agentId: "organizer",
    purpose: "pipeline:organize",
    user: userPayload(
      "请对各平台草稿做结构整理与一致性检查（口径统一、字段补全、删除跑题内容），不要改变各平台的差异化表达。" +
        '严格输出 JSON：{"thinking":"1-3句整理思路","results":{"平台id":平台结果对象}}。各平台结果对象格式如下：\n' +
        editable.map((p) => `${p}: ${shapeSpec(p)}`).join("\n"),
      {
        brief: briefForPrompt(ctx.brief),
        drafts: Object.fromEntries(editable.map((p) => [p, drafts.get(p)!.shape])),
      },
    ),
  });

  const results = obj(res.parsed?.results);
  if (!results) return out;

  for (const platform of editable) {
    const raw = obj(results[platform]);
    if (!raw) continue;
    const shape = normalizeDraft(platform, raw, ctx.brief.goal);
    const ref = insertArtifact(ctx, platform, "draft", shape, { agentId: "organizer" });
    out.set(platform, { shape, version: ref.version });
  }
  return out;
}
