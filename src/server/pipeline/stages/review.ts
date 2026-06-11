import type { PlatformId } from "@/lib/types";
import { getPlatform } from "@/lib/platforms";
import { emitEvent } from "@/server/pipeline/events";
import type { Critique } from "@/server/pipeline/stages/critic";
import {
  callAgent,
  getSetting,
  num,
  obj,
  str,
  strArr,
  userPayload,
  briefForPrompt,
  type StageCtx,
} from "@/server/pipeline/stages/common";

export interface ReviewDecision {
  failing: { platform: PlatformId; directives: string }[];
  summary: string;
}

/**
 * Stage 6 — 总编复核 (reviewer): pass/revise per platform plus concrete
 * revision directives for the re-editor. Falls back to the critic verdicts
 * when the reviewer output is unusable.
 */
export async function reviewStage(
  ctx: StageCtx,
  critiques: Map<PlatformId, Critique>,
  cycle: number,
): Promise<ReviewDecision> {
  const passScore = num(getSetting("review_pass_score", 75), 75);

  const res = await callAgent({
    ctx,
    agentId: "reviewer",
    purpose: "pipeline:review",
    user: userPayload(
      `请作为总编复核各平台评审结果（及格线 ${passScore} 分，当前第 ${cycle + 1} 轮）。对需要回炉的平台给出具体、可执行的修改指令。` +
        '严格输出 JSON：{"thinking":"1-3句复核思路","summary":"整体结论","decisions":[{"platform":"平台id","verdict":"pass|revise","directives":"修改指令（revise 时必填）"}]}',
      {
        brief: briefForPrompt(ctx.brief),
        critiques: Object.fromEntries(
          [...critiques.entries()].map(([p, c]) => [
            p,
            { score: c.score, verdict: c.verdict, comments: c.comments, rubric: c.rubric },
          ]),
        ),
      },
    ),
  });

  const decisionsRaw: unknown = res.parsed?.decisions;
  const rawDecisions = Array.isArray(decisionsRaw) ? decisionsRaw : [];
  // Some reviewer outputs carry a single global verdict + directive list
  // instead of per-platform decisions — honor it as a fallback.
  const globalDirectives =
    str(res.parsed?.directives) || strArr(res.parsed?.directives).join("；");
  const failing: ReviewDecision["failing"] = [];

  for (const [platform, critique] of critiques) {
    const d = rawDecisions.map((x) => obj(x)).find((x) => x && str(x.platform) === platform);
    const reviewerVerdict = d ? str(d.verdict) : "";
    const verdict =
      reviewerVerdict === "pass" || reviewerVerdict === "revise"
        ? (reviewerVerdict as "pass" | "revise")
        : critique.verdict;
    if (verdict === "revise") {
      failing.push({
        platform,
        directives:
          (d ? str(d.directives) : "") ||
          critique.comments ||
          globalDirectives ||
          "按评审意见整体打磨：强化开头钩子、贴合平台语感、明确行动号召。",
      });
    }
  }

  const summary =
    str(res.parsed?.summary) ||
    (failing.length
      ? `${failing.map((f) => getPlatform(f.platform).name).join("、")} 未达标，需回炉重写。`
      : "全部平台达标，可以定稿。");

  emitEvent(ctx.taskId, {
    type: "review",
    agentId: "reviewer",
    title: failing.length
      ? `总编复核：${failing.length} 个平台需回炉`
      : "总编复核：全部通过",
    detail: { text: summary, verdict: failing.length ? "revise" : "pass" },
  });

  return { failing, summary };
}
