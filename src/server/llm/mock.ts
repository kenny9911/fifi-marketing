import type { PlatformId } from "../../lib/types";
import type { ChatCompleteOpts, MultiModalPart } from "./client";

/**
 * Deterministic LLM fixtures for TEST_MODE=mock (SPEC §7).
 *
 * Keyed by purpose prefix; every fixture is a JSON object with a `thinking`
 * field (1–2 sentences) plus the shape the corresponding pipeline stage
 * expects. Crafter/reedit fixtures echo the brief goal found in the last user
 * message (field `goalEcho` + woven into title/body) so use-case tests can
 * assert end-to-end propagation. A purpose containing "lowquality" makes the
 * critic score 55 / verdict "revise" to exercise the revision loop.
 *
 * This module is pure: no db, no network, no randomness.
 */

const ALL_PLATFORMS: PlatformId[] = ["xhs", "dy", "mp", "wb", "zh", "bjh", "csdn"];

function textOf(content: string | MultiModalPart[]): string {
  if (typeof content === "string") return content;
  return content
    .map((p) => (p.type === "text" ? p.text : "[image]"))
    .join("\n");
}

function lastUserText(opts: ChatCompleteOpts): string {
  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const m = opts.messages[i];
    if (m.role === "user") return textOf(m.content);
  }
  return "";
}

function allText(opts: ChatCompleteOpts): string {
  return [opts.system ?? "", ...opts.messages.map((m) => textOf(m.content))].join("\n");
}

/** Extract the brief goal from the last user message (JSON `goal` field, a 目标: line, or the raw text). */
function goalOf(opts: ChatCompleteOpts): string {
  const sources = [lastUserText(opts), allText(opts)];
  for (const text of sources) {
    const json = text.match(/"goal"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (json) {
      try {
        return JSON.parse(`"${json[1]}"`) as string;
      } catch {
        return json[1];
      }
    }
    const line = text.match(/(?:目标|goal)\s*[:：]\s*([^\n"}，。]+)/i);
    if (line) return line[1].trim();
  }
  const fallback = lastUserText(opts).trim();
  return fallback ? fallback.slice(0, 120) : "本次营销目标";
}

function snip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function platformOf(purpose: string): PlatformId | null {
  const m = purpose.match(/(?:^|:)(xhs|dy|mp|wb|zh|bjh|csdn)(?::|$)/);
  return (m?.[1] as PlatformId | undefined) ?? null;
}

function platformsInMessages(opts: ChatCompleteOpts): PlatformId[] {
  const text = allText(opts);
  const found = ALL_PLATFORMS.filter((p) => text.includes(`"${p}"`));
  return found.length > 0 ? found : ALL_PLATFORMS;
}

type Fixture = Record<string, unknown>;

// ---- per-stage fixtures ----

function searchFixture(opts: ChatCompleteOpts): Fixture {
  const goal = goalOf(opts);
  return {
    thinking: "先扫平台热榜与受众讨论区，再把可直接落地的选题点提炼成三条洞察。",
    summary: `围绕「${goal}」的全网情报速览：近两周相关话题讨论热度上升，受众最关心真实体验、价格对比与使用场景；同类内容中清单式实测与场景化故事的互动率最高。`,
    insights: [
      "受众决策最看重「真实体验感」，第一人称实测内容互动率显著更高",
      "价格锚点是评论区高频话题，给出具体换算（每次/每天成本）更易转化",
      "工作与通勤场景的代入感内容完播率最好，适合做开头钩子",
    ],
    trends: [
      "清单式「3 个理由」结构持续霸榜",
      "评论区追问「哪里买」占比上升，挂链转化窗口好",
      "短视频前 3 秒反差钩子仍是流量密码",
    ],
    keywords: ["真实测评", "性价比", "打工人", "使用场景", "避雷"],
    sources: [
      {
        title: "平台热榜观察：本周内容趋势",
        url: "https://example.com/mock-trend-report",
        snippet: "清单式实测与场景化故事互动率领先……",
      },
      {
        title: "受众讨论区抽样分析",
        url: "https://example.com/mock-audience-notes",
        snippet: "价格与真实体验是购买决策前两位的关注点……",
      },
    ],
  };
}

function promptCraftFixture(opts: ChatCompleteOpts): Fixture {
  const goal = goalOf(opts);
  return {
    thinking: "把简报与情报压成三类生成提示词：写作侧重平台结构，图像侧重场景质感，视频侧重镜头节奏。",
    packs: [
      {
        kind: "text",
        platform: null,
        prompt: `你是资深中文新媒体撰稿人。围绕目标「${goal}」，结合受众痛点写一篇平台原生内容：开头两行制造反差钩子，正文用编号清单铺 3 个卖点（每条含具体场景与数据），结尾给明确行动指令，并附 5 个相关话题标签。语气真实克制，禁止夸大疗效式表述。`,
        rationale: "清单式结构 + 前两行钩子是当前各平台互动率最高的通用骨架，数据化卖点提升可信度。",
        targetModel: "kimi-k2.6",
      },
      {
        kind: "image",
        platform: null,
        prompt: `明亮通透的生活方式产品场景图：清晨办公桌一角，自然窗光，主体产品居中前景，浅景深，奶油色调，留白构图便于叠加标题文字，真实摄影质感，无文字无水印。主题：${snip(goalOf(opts), 40)}`,
        rationale: "留白 + 浅景深的真实摄影风在信息流里点击率高，且方便二次加封面字。",
        targetModel: "gpt-image-1",
      },
      {
        kind: "video",
        platform: "dy",
        prompt: `15 秒竖屏短视频分镜：0–3s 怼脸反差开场（一句话推翻常识）；3–10s 三连快剪演示核心卖点，字幕逐条弹出；10–15s 口播转化 + 产品定格。BGM 轻快卡点，节奏每 2 秒一个画面切换。主题：${snip(goal, 40)}`,
        rationale: "HOOK-FIRST 结构保完播，三段式分镜可直接交给拍摄执行。",
        targetModel: "veo",
      },
    ],
  };
}

interface CraftContext {
  goal: string;
  platform: PlatformId;
}

function craftResult(ctx: CraftContext): Fixture {
  const { goal, platform } = ctx;
  const g = snip(goal, 24);
  switch (platform) {
    case "xhs":
      return {
        kind: "xhs",
        coverHeadline: "亲测不踩雷",
        coverSub: "看完这篇再下单",
        title: `亲测安利｜${g} 真的值回票价`,
        bodyLines: [
          `这次的主题是「${goal}」，认真体验一周后来交作业了…`,
          "① 上手零门槛，第一次用也不会翻车",
          "② 算下来每天成本不到一杯豆浆，性价比在线",
          "③ 通勤、办公、宅家三个场景全都接得住",
          "评论区蹲一个同款搭子，链接我放这了～",
        ],
        hashtags: ["#真实测评", "#打工人日常", "#好物分享", "#性价比之选", "#亲测有效"],
        tuningNotes: ["标题含「亲测」信任词", "正文清单化 · 3 个场景卖点", "建议工作日午休时段发布"],
        goalEcho: goal,
      };
    case "dy":
      return {
        kind: "dy",
        title: `15s 短视频脚本 · 「${g}」`,
        subtitle: "抖音 · 阿飞 出品 · HOOK FIRST",
        shots: [
          {
            time: "0–3s",
            chipBg: "#25F4EE",
            chipColor: "#161823",
            label: "钩子",
            text: `怼脸开场反差一句话，直接点题「${goal}」，配字幕放大关键词。`,
          },
          {
            time: "3–10s",
            chipBg: "#FFC53D",
            chipColor: "#161823",
            label: "演示",
            text: "三连快剪实拍核心卖点，字幕逐条弹出：好上手 · 成本低 · 场景全。",
          },
          {
            time: "10–15s",
            chipBg: "#FE2C55",
            chipColor: "#FFFFFF",
            label: "转化",
            text: "口播行动指令 + 产品定格，贴价格贴纸，引导点小黄车。",
          },
        ],
        tuningNotes: ["前 3 秒反差钩子保完播", "BGM 轻快卡点 · 每 2 秒切画面", "建议 18:00–20:00 发布"],
        goalEcho: goal,
      };
    case "mp":
      return {
        kind: "mp",
        badge: "公众号 · 文叔 出品",
        meta: "预计阅读 5 分钟 · 约 2600 字",
        title: `深度拆解：${g}背后的消费逻辑`,
        intro: `导语：围绕「${goal}」，我们从效率、成本与场景三个维度，聊聊它为什么值得被认真讨论。`,
        outline: [
          "现象：为什么这件事最近被反复讨论",
          "拆账：一笔算得清的成本与收益",
          "场景：三个真实用户故事的横切面",
          "建议：怎么选不踩雷，三个硬指标",
        ],
        tuningNotes: ["标题走「现象解读」路线", "第 3 节后插入转化卡片", "文末引导「在看 + 星标」"],
        goalEcho: goal,
      };
    case "wb":
      return {
        kind: "wb",
        title: `#${snip(goal, 14)}# 这事儿真有这么神？`,
        bodyLines: [
          `最近全网都在聊「${goal}」，认真体验后说点大实话👇`,
          "好用是真好用：上手快、成本低、场景全；",
          "但也别神化，适合自己的才是最好的。",
          "你怎么看？评论区聊聊，转发抽 3 位送同款体验装🎁",
        ],
        hashtags: ["#真实体验", "#好物推荐", "#今日话题"],
        tuningNotes: ["借势话题词置顶", "抽奖钩子带转发裂变", "建议晚间流量高峰发布"],
        goalEcho: goal,
      };
    case "zh":
      return {
        kind: "zh",
        title: `如何评价「${g}」？真实体验一周后的理性分析`,
        bodyLines: [
          `先说结论：围绕「${goal}」这件事，值得做，但要讲方法。`,
          "一、需求侧：它解决的是真实存在的高频痛点，不是伪需求；",
          "二、成本侧：拆开账本算，边际成本明显低于传统替代方案；",
          "三、风险侧：注意三个常见误区，避免被营销话术带偏；",
          "综上，理性建议是小成本试错，验证适配后再加码。",
        ],
        hashtags: ["消费决策", "理性测评", "生活方式"],
        tuningNotes: ["先结论后论证的高赞结构", "用数据与分点增强专业感", "结尾开放提问拉互动"],
        goalEcho: goal,
      };
    case "bjh":
      return {
        kind: "bjh",
        title: `${g}走热：消费者最关心这三件事`,
        bodyLines: [
          `近期，「${goal}」相关话题热度持续上升，引发广泛关注。`,
          "梳理公开讨论可以发现，消费者最关心真实体验、综合成本与适用场景三个问题。",
          "业内人士提醒：选购时应关注产品资质与口碑，理性消费、按需选择。",
          "整体来看，该品类正从尝鲜走向日常，市场仍有增长空间。",
        ],
        hashtags: ["消费观察", "行业资讯", "理性消费"],
        tuningNotes: ["标题资讯化 · 带数字钩子", "正文倒金字塔结构利于搜索收录", "避免绝对化用语"],
        goalEcho: goal,
      };
    case "csdn":
      return {
        kind: "csdn",
        title: `实战复盘：把「${g}」做成可复用方案的完整思路`,
        bodyLines: [
          `本文围绕「${goal}」，给出一套可落地、可复用的实践方案。`,
          "1. 背景与目标拆解：先把模糊诉求翻译成可量化指标；",
          "2. 方案设计：分三步走，每一步附检查清单与示例；",
          "3. 踩坑记录：列出实测中遇到的 3 个坑及规避方式；",
          "4. 总结：附完整清单模板，拿走即用。",
        ],
        hashtags: ["实战教程", "方法论", "经验分享"],
        tuningNotes: ["教程式标题带「实战」关键词", "分步骤结构 + 清单模板提升收藏率", "代码/模板块放正文中段"],
        goalEcho: goal,
      };
  }
}

const CRAFT_THINKING: Record<PlatformId, string> = {
  xhs: "结合情报洞察与小红书爆款结构，用「亲测」信任词开头，清单式正文铺场景卖点。",
  dy: "按 HOOK-FIRST 三段式分镜来写：前 3 秒反差钩子，中段快剪演示，结尾口播转化。",
  mp: "公众号读者要深度，所以走现象解读路线，先立题再拆账，最后落到可执行建议。",
  wb: "微博吃话题与互动，标题挂话题词，正文短平快，结尾用抽奖钩子做转发裂变。",
  zh: "知乎高赞答案先结论后论证，分点给数据与风险提示，保持克制的专业口吻。",
  bjh: "百家号偏资讯，用倒金字塔结构与中性表述，标题留搜索关键词。",
  csdn: "技术读者要可复用，按教程结构分步骤写，附清单与踩坑记录提升收藏。",
};

function craftFixture(opts: ChatCompleteOpts): Fixture {
  const platform = platformOf(opts.purpose) ?? "xhs";
  const goal = goalOf(opts);
  return {
    thinking: CRAFT_THINKING[platform],
    ...craftResult({ goal, platform }),
  };
}

function organizeFixture(opts: ChatCompleteOpts): Fixture {
  const goal = goalOf(opts);
  const single = platformOf(opts.purpose);
  const platforms = single ? [single] : platformsInMessages(opts);
  const results: Record<string, Fixture> = {};
  for (const p of platforms) {
    results[p] = craftResult({ goal, platform: p });
  }
  return {
    thinking: "逐平台核对字段完整性与口径一致性，统一标签格式后输出标准结果结构。",
    results,
  };
}

function criticFixture(opts: ChatCompleteOpts): Fixture {
  const low = opts.purpose.includes("lowquality");
  if (low) {
    return {
      thinking: "这稿开头平淡、卖点空泛，按五维 rubric 打分后必须打回重写。",
      score: 55,
      rubric: {
        hook: { score: 45, comment: "开头没有钩子，前两行留不住人。" },
        platformFit: { score: 58, comment: "结构偏通稿，缺平台原生感。" },
        audience: { score: 55, comment: "痛点描述空泛，没有具体场景。" },
        cta: { score: 52, comment: "行动指令模糊，转化路径断裂。" },
        compliance: { score: 80, comment: "无违禁表述，合规无碍。" },
      },
      verdict: "revise",
      comments: [
        "前两行重写：用反差或悬念制造钩子",
        "每个卖点补一个具体场景或数据",
        "结尾给出唯一明确的行动指令",
      ],
    };
  }
  return {
    thinking: "按钩子、平台契合、受众、转化、合规五个维度过了一遍，整体在线，给出可继续打磨的小建议。",
    score: 82,
    rubric: {
      hook: { score: 85, comment: "开头有反差感，能在信息流里停住手指。" },
      platformFit: { score: 84, comment: "结构与平台主流爆款一致，原生感好。" },
      audience: { score: 80, comment: "人群痛点命中，场景还可以更具体一点。" },
      cta: { score: 78, comment: "行动指令清晰，可再加一层互动引导。" },
      compliance: { score: 88, comment: "无违禁词，营销表述安全。" },
    },
    verdict: "pass",
    comments: ["第二个卖点可补一个具体数字增强可信度", "结尾互动问题可以更尖锐一点"],
  };
}

function reviewFixture(opts: ChatCompleteOpts): Fixture {
  const text = allText(opts);
  const scores = [...text.matchAll(/"score"\s*:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const needsRevision =
    opts.purpose.includes("lowquality") ||
    /lowquality/.test(text) ||
    /"verdict"\s*:\s*"revise"/.test(text) ||
    (scores.length > 0 && Math.min(...scores) < 75);
  if (needsRevision) {
    return {
      thinking: "评审分数未达线，钩子与转化两个维度问题明确，下修稿指令打回重写。",
      verdict: "revise",
      directives: [
        "重写开头两行：用反差或悬念制造 3 秒钩子",
        "为每个卖点补充具体数据或真实场景细节",
        "结尾收敛为单一明确的行动指令",
      ],
      summary: "整体结构可用，但钩子与转化未达发布线，按指令回炉一轮。",
    };
  }
  return {
    thinking: "各平台评分均过线，口径一致、无合规风险，可以放行定稿。",
    verdict: "pass",
    directives: [],
    summary: "全部平台稿件达到发布标准，准予定稿交付。",
  };
}

function reeditFixture(opts: ChatCompleteOpts): Fixture {
  const platform = platformOf(opts.purpose) ?? "xhs";
  const goal = goalOf(opts);
  const result = craftResult({ goal, platform });
  return {
    thinking: "按总编指令重写：开头换成反差钩子，卖点补数据与场景，结尾收敛成单一行动指令。",
    ...result,
    revised: true,
    tuningNotes: [
      "已按总编指令回炉：强化开头钩子",
      "卖点补充具体数据与场景细节",
      ...((result.tuningNotes as string[] | undefined)?.slice(0, 1) ?? []),
    ],
  };
}

function finalizeFixture(opts: ChatCompleteOpts): Fixture {
  const goal = goalOf(opts);
  return {
    thinking: "最后通读一遍口径与格式，确认各平台稿件可直接发布，给用户一段交付摘要。",
    summary: `围绕「${goal}」的全平台内容已定稿：各平台稿件均通过毒舌评审与总编复核，标题、正文、标签与调优建议已就位。`,
    message: "各平台稿件已通过评审并定稿 ✅ 可在右侧结果面板查看、复制，或一键生成配图。",
    highlights: ["全部平台评分过线", "标签与口径已统一", "附每平台发布时间建议"],
  };
}

function briefAssistantFixture(opts: ChatCompleteOpts): Fixture {
  const goal = goalOf(opts);
  return {
    thinking: "用户给了目标，先确认理解，再引导补齐受众、平台与风格三块信息。",
    reply: `收到！「${snip(goal, 40)}」这个方向很清晰。接下来帮我确认两件事：这次内容主要想触达哪类人群？想优先发哪些平台？`,
    suggestions: ["补充目标受众", "选择投放平台", "确定内容风格", "上传产品素材"],
    briefPatch: {},
  };
}

function extractFixture(): Fixture {
  return {
    thinking: "解析上传文件，提取正文与卖点要点，过滤页眉页脚噪音。",
    text: [
      "【模拟解析】产品卖点文档",
      "一、核心卖点：3 秒冲泡即饮，冷热水皆可，全溶不结块。",
      "二、成本优势：单杯成本不到 4 元，显著低于线下门店。",
      "三、目标人群：25–35 岁都市白领与早八通勤人群。",
      "四、使用场景：办公室、通勤途中、居家加班。",
      "五、注意事项：宣传中避免功效类绝对化用语。",
    ].join("\n"),
  };
}

function imageFixture(opts: ChatCompleteOpts): Fixture {
  return {
    thinking: "封面图要为信息流点击服务，选真实摄影质感模型，留白构图方便叠字。",
    model: "openai/gpt-image-1",
    prompt: `明亮通透的产品场景图：清晨办公桌一角，自然窗光，主体居中前景，浅景深，奶油色调，留白构图，真实摄影质感，无文字无水印。主题：${snip(goalOf(opts), 40)}`,
    size: "1024x1024",
  };
}

function evolveFixture(): Fixture {
  return {
    thinking: "汇总窗口期内评分与调用日志，小红书钩子维度均分偏低，提一版强化钩子规则的提示词。",
    report_md: [
      "# 自进化复盘报告",
      "",
      "## 数据窗口",
      "- 近 7 天完成任务与全部 LLM 调用、评审记录",
      "",
      "## 发现",
      "1. 小红书稿件 hook 维度均分 74，低于整体均值 82；",
      "2. 回炉率最高的指令集中在「开头钩子」与「行动指令」两类；",
      "3. 模型成本结构健康，无异常重试。",
      "",
      "## 行动项",
      "- 对 crafter:xhs 提案新版提示词：强化前两行钩子硬规则；",
      "- 建议继续观察转化维度评分两周。",
    ].join("\n"),
    proposals: [
      {
        agentId: "crafter:xhs",
        rationale: "近期小红书稿件 hook 维度均分偏低，回炉指令集中在开头钩子；在系统提示中加入前两行硬规则可直接提升该维度。",
        newTemplate:
          "你是桃桃，小红书种草主理人。写作硬规则：前两行必须制造反差或悬念钩子；正文用编号清单铺 3 个卖点，每条含具体场景或数据；结尾给单一明确行动指令并附 5 个话题标签。语气真实克制，禁止绝对化用语。输出 JSON，包含 thinking、title、coverHeadline、coverSub、bodyLines、hashtags、tuningNotes 字段。",
      },
    ],
  };
}

function genericFixture(opts: ChatCompleteOpts): Fixture {
  return {
    thinking: "未匹配到专用流程，按通用助理口径给出简短确认。",
    text: `好的，已围绕「${snip(goalOf(opts), 40)}」完成本步骤。`,
  };
}

const FIXTURES: [prefix: string, build: (opts: ChatCompleteOpts) => Fixture][] = [
  ["pipeline:search", searchFixture],
  ["pipeline:prompt_craft", promptCraftFixture],
  ["pipeline:craft", craftFixture],
  ["pipeline:organize", organizeFixture],
  ["pipeline:critic", criticFixture],
  ["pipeline:review", reviewFixture],
  ["pipeline:reedit", reeditFixture],
  ["pipeline:finalize", finalizeFixture],
  ["brief_assistant", briefAssistantFixture],
  ["extract", () => extractFixture()],
  ["image", imageFixture],
  ["evolve", () => evolveFixture()],
];

export function mockComplete(opts: ChatCompleteOpts): { content: string; parsed?: unknown } {
  const entry = FIXTURES.find(([prefix]) => opts.purpose.startsWith(prefix));
  const fixture = entry ? entry[1](opts) : genericFixture(opts);
  return { content: JSON.stringify(fixture, null, 2), parsed: fixture };
}
