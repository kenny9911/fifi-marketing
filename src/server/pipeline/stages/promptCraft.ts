import type { PlatformId } from "@/lib/types";
import { getPlatform } from "@/lib/platforms";
import {
  callAgent,
  insertArtifact,
  obj,
  shapeSpec,
  skillsForPlatform,
  str,
  userPayload,
  briefForPrompt,
  type ResearchPack,
  type StageCtx,
} from "@/server/pipeline/stages/common";

export interface PromptPack {
  artifactId: string;
  platform: PlatformId | null;
  kind: "text" | "image" | "video";
  prompt: string;
  rationale: string;
  targetModel?: string;
}

/**
 * Reads {prompt, rationale, targetModel} from the agent output — either at
 * the top level or inside a `packs` array (matching kind, preferring an
 * exact platform match).
 */
function pickPack(
  parsed: Record<string, unknown> | null,
  kind: PromptPack["kind"],
  platform: PlatformId | null,
): { prompt: string; rationale: string; targetModel: string } | null {
  if (!parsed) return null;
  let source: Record<string, unknown> | null = null;
  if (Array.isArray(parsed.packs)) {
    const entries = parsed.packs
      .map((x) => obj(x))
      .filter((x): x is Record<string, unknown> => x !== null && str(x.kind) === kind);
    source = entries.find((x) => str(x.platform) === (platform ?? "")) ?? entries[0] ?? null;
  }
  if (!source && str(parsed.prompt)) source = parsed;
  if (!source) return null;
  return {
    prompt: str(source.prompt),
    rationale: str(source.rationale),
    targetModel: str(source.targetModel),
  };
}

function storePack(
  ctx: StageCtx,
  agentId: string,
  pack: Omit<PromptPack, "artifactId">,
): PromptPack {
  const { id } = insertArtifact(
    ctx,
    pack.platform,
    "prompt_pack",
    {
      platform: pack.platform,
      kind: pack.kind,
      prompt: pack.prompt,
      rationale: pack.rationale,
      targetModel: pack.targetModel,
    },
    { agentId },
  );
  return { ...pack, artifactId: id };
}

async function textPack(
  ctx: StageCtx,
  research: ResearchPack,
  platform: PlatformId,
): Promise<PromptPack> {
  const p = getPlatform(platform);
  const res = await callAgent({
    ctx,
    agentId: "promptsmith:text",
    purpose: `pipeline:prompt_craft:text:${platform}`,
    platform,
    user: userPayload(
      `请为「${p.name}」平台的${p.job}撰写一条可直接交给写作模型的优化提示词。` +
        '严格输出 JSON：{"thinking":"1-3句设计思路","prompt":"完整提示词","rationale":"为什么这样设计","targetModel":"建议模型"}',
      {
        brief: briefForPrompt(ctx.brief),
        researchSummary: research.summary,
        insights: research.insights,
        platformTrend: research.platformTrends[platform] ?? "",
        platformSkills: skillsForPlatform(platform).slice(0, 4_000),
        expectedOutputShape: shapeSpec(platform),
      },
    ),
  });
  const picked = pickPack(res.parsed, "text", platform);
  const prompt =
    picked?.prompt ||
    `请以「${p.expert.name}」（${p.expert.title}）的身份，面向「${ctx.brief.audience || "目标人群"}」，` +
      `围绕「${ctx.brief.goal}」创作一篇 ${p.name} ${p.job}，风格：${ctx.brief.style || "自然真实"}。` +
      `输出 JSON：${shapeSpec(platform)}`;
  return storePack(ctx, "promptsmith:text", {
    platform,
    kind: "text",
    prompt,
    rationale: picked?.rationale || "（降级）基于简报自动拼装的兜底提示词。",
    targetModel: picked?.targetModel || undefined,
  });
}

async function imagePack(ctx: StageCtx, research: ResearchPack): Promise<PromptPack> {
  const res = await callAgent({
    ctx,
    agentId: "promptsmith:image",
    purpose: "pipeline:prompt_craft:image",
    user: userPayload(
      "请为这次营销内容设计一条专业的图像生成提示词（封面/配图通用，含构图、光线、色彩、风格关键词）。" +
        '严格输出 JSON：{"thinking":"1-3句设计思路","prompt":"完整图像提示词","rationale":"设计理由","targetModel":"建议模型，如 gpt-image-1"}',
      {
        brief: briefForPrompt(ctx.brief),
        researchSummary: research.summary,
      },
    ),
  });
  const picked = pickPack(res.parsed, "image", null);
  return storePack(ctx, "promptsmith:image", {
    platform: null,
    kind: "image",
    prompt:
      picked?.prompt ||
      `高质感商业摄影风格配图：${ctx.brief.goal}，目标人群 ${ctx.brief.audience || "年轻消费者"}，明亮自然光，浅景深，干净背景，真实使用场景。`,
    rationale: picked?.rationale || "（降级）基于简报自动拼装的兜底图像提示词。",
    targetModel: picked?.targetModel || "gpt-image-1",
  });
}

async function videoPack(ctx: StageCtx, research: ResearchPack): Promise<PromptPack> {
  const res = await callAgent({
    ctx,
    agentId: "promptsmith:video",
    purpose: "pipeline:prompt_craft:video",
    platform: "dy",
    user: userPayload(
      "请为抖音 15 秒短视频设计分镜与视频生成提示词（含镜头运动、节奏、字幕与 BGM 建议）。" +
        '严格输出 JSON：{"thinking":"1-3句设计思路","prompt":"完整视频提示词/分镜","rationale":"设计理由","targetModel":"建议模型，如 veo"}',
      {
        brief: briefForPrompt(ctx.brief),
        researchSummary: research.summary,
        platformTrend: research.platformTrends.dy ?? "",
      },
    ),
  });
  const picked = pickPack(res.parsed, "video", "dy");
  return storePack(ctx, "promptsmith:video", {
    platform: "dy",
    kind: "video",
    prompt:
      picked?.prompt ||
      `15 秒竖屏短视频：${ctx.brief.goal}。0-3s 反常识钩子怼脸拍，3-10s 快节奏卖点演示（字幕弹出），10-15s 口播转化 + 产品定格。`,
    rationale: picked?.rationale || "（降级）基于简报自动拼装的兜底视频提示词。",
    targetModel: picked?.targetModel || "veo",
  });
}

/**
 * Stage 2 — 提示词工程: one text pack per platform + one image pack +
 * a video pack when 抖音 is selected. Each pack degrades independently.
 */
export async function promptCraftStage(
  ctx: StageCtx,
  research: ResearchPack,
): Promise<PromptPack[]> {
  const jobs: Promise<PromptPack>[] = ctx.brief.platforms.map((platform) =>
    textPack(ctx, research, platform),
  );
  jobs.push(imagePack(ctx, research));
  if (ctx.brief.platforms.includes("dy")) {
    jobs.push(videoPack(ctx, research));
  }
  return Promise.all(jobs);
}
