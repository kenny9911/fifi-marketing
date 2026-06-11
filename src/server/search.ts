/**
 * Web research tools: Tavily search + Firecrawl scrape.
 *
 * Both degrade gracefully — missing keys, network errors or non-2xx responses
 * return empty results with a console.warn so the pipeline can continue with
 * whatever it has (SPEC §8). TEST_MODE=mock short-circuits to canned fixtures.
 */

const TOOL_TIMEOUT_MS = 15_000;

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

const MOCK_SEARCH_RESULTS: SearchResult[] = [
  {
    title: "2026 内容营销趋势报告：短内容与信任经济",
    url: "https://example.com/trends-2026",
    content:
      "短平快内容继续主导各平台分发，用户更信任真实测评与场景化种草；评论区互动率与完读率成为权重的关键信号，品牌内容需要先给情绪价值再给卖点。",
  },
  {
    title: "小红书爆款笔记拆解：封面三要素",
    url: "https://example.com/xhs-cover",
    content:
      "高点击封面 = 大字标题 + 强对比配色 + 真实使用场景；标题要么制造悬念，要么给出明确利益点，正文用列表化结构降低阅读成本。",
  },
  {
    title: "抖音 15 秒脚本方法论：HOOK FIRST",
    url: "https://example.com/dy-script",
    content:
      "前 3 秒必须抛出反常识钩子留住用户，中段快节奏演示核心卖点（字幕逐条弹出），结尾给出明确行动指令并引导小黄车/评论区。",
  },
  {
    title: "公众号深度长文的转化路径设计",
    url: "https://example.com/mp-conversion",
    content:
      "现象解读式标题 + 结构化小节最易获得在看与转发；转化卡片放在第 3 节之后效果最佳，文末引导星标提升后续触达。",
  },
];

const MOCK_SCRAPE_MARKDOWN = `# 案例拆解：一篇爆款种草笔记的结构

1. 封面：大字利益点 + 真实场景图，点击率提升约 40%
2. 开头：一句口语化的"姐妹安利"建立信任
3. 正文：①②③ 列表化卖点，每条一行，含价格锚点
4. 结尾：明确行动指令 + 评论区互动引导

> 关键洞察：列表化 + 价格锚点 + 互动引导是当前平台分发最稳的组合。`;

function isMock(): boolean {
  return process.env.TEST_MODE === "mock";
}

/** Tavily web search. Missing key / failure → `{ results: [] }` + warn. */
export async function webSearch(
  query: string,
  opts?: { maxResults?: number },
): Promise<{ results: SearchResult[] }> {
  const maxResults = opts?.maxResults ?? 5;
  if (isMock()) {
    return { results: MOCK_SEARCH_RESULTS.slice(0, maxResults) };
  }
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn("[search] TAVILY_API_KEY missing — returning empty results");
    return { results: [] };
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[search] Tavily HTTP ${res.status} for query "${query}"`);
      return { results: [] };
    }
    const data = (await res.json()) as {
      answer?: unknown;
      results?: { title?: unknown; url?: unknown; content?: unknown }[];
    };
    const results: SearchResult[] = Array.isArray(data.results)
      ? data.results.map((r) => ({
          title: String(r?.title ?? ""),
          url: String(r?.url ?? ""),
          content: String(r?.content ?? ""),
        }))
      : [];
    if (typeof data.answer === "string" && data.answer.trim()) {
      results.unshift({ title: "Tavily 综合摘要", url: "", content: data.answer.trim() });
    }
    return { results };
  } catch (err) {
    console.warn(`[search] Tavily request failed: ${err instanceof Error ? err.message : err}`);
    return { results: [] };
  }
}

/** Firecrawl scrape → markdown. Missing key / failure → "" + warn. */
export async function scrape(url: string): Promise<string> {
  if (isMock()) {
    return MOCK_SCRAPE_MARKDOWN;
  }
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.warn("[search] FIRECRAWL_API_KEY missing — skipping scrape");
    return "";
  }
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[search] Firecrawl HTTP ${res.status} for ${url}`);
      return "";
    }
    const data = (await res.json()) as {
      data?: { markdown?: unknown };
      markdown?: unknown;
    };
    const md = data?.data?.markdown ?? data?.markdown ?? "";
    return typeof md === "string" ? md : "";
  } catch (err) {
    console.warn(`[search] Firecrawl request failed: ${err instanceof Error ? err.message : err}`);
    return "";
  }
}
