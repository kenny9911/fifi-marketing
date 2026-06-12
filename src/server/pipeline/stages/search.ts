import { getPlatform } from "@/lib/platforms";
import { emitEvent } from "@/server/pipeline/events";
import { scrape, webSearch, type SearchResult } from "@/server/search";
import {
  callAgent,
  insertArtifact,
  str,
  strArr,
  obj,
  truncate,
  userPayload,
  briefForPrompt,
  type ResearchPack,
  type StageCtx,
} from "@/server/pipeline/stages/common";

/**
 * Stage 1 — 搜罗 (searcher): Tavily/Firecrawl research on the topic, audience
 * and platform trends, summarized into a structured research pack.
 * Degrades gracefully to a brief-only research pack when tools/LLM fail.
 */
export async function searchStage(ctx: StageCtx): Promise<ResearchPack> {
  const { brief } = ctx;
  const platformNames = brief.platforms.map((p) => getPlatform(p).name).join("、");
  const year = new Date().getFullYear();
  const queries = [
    `${brief.goal} ${brief.audience} 营销 内容 案例`.trim(),
    `${platformNames} 爆款内容 趋势 ${year}`,
  ];

  const results: SearchResult[] = [];
  const searchErrors: string[] = [];
  for (const query of queries) {
    emitEvent(ctx.taskId, {
      type: "tool_call",
      agentId: "searcher",
      title: `Tavily 搜索：${truncate(query, 40)}`,
      detail: { toolName: "web_search", text: query },
    });
    const r = await webSearch(query, { maxResults: 5 });
    results.push(...r.results);
    if (r.error && !searchErrors.includes(r.error)) searchErrors.push(r.error);
  }

  if (results.length === 0) {
    emitEvent(ctx.taskId, {
      type: "error",
      agentId: "searcher",
      title: searchErrors.length
        ? "搜索服务异常，使用简报信息继续"
        : "搜索无结果，使用简报信息继续",
      detail: {
        text: searchErrors.length
          ? `${searchErrors.join("；")}。情报搜集降级，仅基于简报创作。`
          : "两组查询均无返回结果，情报搜集降级，仅基于简报创作。",
      },
    });
  }

  let scraped = "";
  const top = results.find((r) => r.url.startsWith("http"));
  if (top) {
    emitEvent(ctx.taskId, {
      type: "tool_call",
      agentId: "searcher",
      title: `Firecrawl 抓取：${truncate(top.url, 50)}`,
      detail: { toolName: "scrape", text: top.url },
    });
    scraped = (await scrape(top.url)).slice(0, 4_000);
  }

  const res = await callAgent({
    ctx,
    agentId: "searcher",
    purpose: "pipeline:search",
    user: userPayload(
      "请基于简报与搜索结果完成调研，严格输出 JSON：" +
        '{"thinking":"1-3句调研思路","summary":"调研综述（200-400字）","insights":["关键洞察"],"platformTrends":{"平台id":"该平台当前内容趋势"},"sources":[{"title":"","url":""}]}',
      {
        brief: briefForPrompt(brief),
        searchResults: results.slice(0, 10).map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content.slice(0, 800),
        })),
        scrapedTopResult: scraped,
      },
    ),
  });

  let research: ResearchPack;
  if (res.parsed) {
    const trends = obj(res.parsed.platformTrends) ?? {};
    const sources = Array.isArray(res.parsed.sources)
      ? res.parsed.sources
          .map((s) => {
            const o = obj(s) ?? {};
            return { title: str(o.title), url: str(o.url) };
          })
          .filter((s) => s.title || s.url)
      : results.slice(0, 5).map((r) => ({ title: r.title, url: r.url }));
    // Some outputs carry trends as a flat list rather than per-platform map.
    const flatTrends = strArr(res.parsed.trends);
    research = {
      summary: str(res.parsed.summary) || res.content.slice(0, 1_500),
      insights: [...strArr(res.parsed.insights), ...flatTrends],
      platformTrends: Object.fromEntries(
        Object.entries(trends).map(([k, v]) => [k, str(v)]),
      ),
      sources,
    };
  } else {
    research = {
      summary:
        res.content.slice(0, 1_500) ||
        `（调研降级）围绕「${brief.goal}」面向「${brief.audience || "目标人群"}」创作，风格：${brief.style || "自然种草"}。`,
      insights: results.slice(0, 5).map((r) => truncate(r.content, 120)),
      platformTrends: {},
      sources: results.slice(0, 5).map((r) => ({ title: r.title, url: r.url })),
    };
  }

  insertArtifact(ctx, null, "research", research, { agentId: "searcher" });
  return research;
}
