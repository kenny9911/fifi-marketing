import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { hashSecret } from "./crypto";
import { PLATFORMS } from "@/lib/platforms";

/**
 * Idempotent seeds (SPEC §4): models (from the .env price table), agents (§1),
 * prompt v1 per agent, platform skills, admin user, app_settings defaults.
 *
 * IMPORTANT: this module must NOT import ./db — db.ts imports this file and
 * passes its connection into runSeeds(conn) (circular-import guard).
 */

type DB = Database.Database;

function nowIso(): string {
  return new Date().toISOString();
}

// ===== Models (price table from .env comment block; §3.2 provider routing) =====

interface ModelSeed {
  id: string;
  provider: "openai" | "moonshot" | "minimax" | "openrouter";
  kind: "text" | "multimodal" | "image";
  inputCostPerM: number;
  outputCostPerM: number;
}

const MODEL_SEEDS: ModelSeed[] = [
  { id: "google/gemini-3.1-pro-preview", provider: "openrouter", kind: "multimodal", inputCostPerM: 2, outputCostPerM: 12 },
  { id: "google/gemini-3-flash-preview", provider: "openrouter", kind: "multimodal", inputCostPerM: 0.5, outputCostPerM: 3 },
  { id: "openai/gpt-5.4-mini", provider: "openai", kind: "text", inputCostPerM: 0.75, outputCostPerM: 4.5 },
  { id: "anthropic/claude-sonnet-4.6", provider: "openrouter", kind: "text", inputCostPerM: 3, outputCostPerM: 15 },
  { id: "anthropic/claude-opus-4.8", provider: "openrouter", kind: "text", inputCostPerM: 5, outputCostPerM: 25 },
  { id: "openai/gpt-5.4", provider: "openai", kind: "text", inputCostPerM: 2.5, outputCostPerM: 15 },
  { id: "minimax/minimax-m3", provider: "minimax", kind: "text", inputCostPerM: 0.3, outputCostPerM: 1.2 },
  { id: "moonshotai/kimi-k2.6", provider: "moonshot", kind: "text", inputCostPerM: 0.68, outputCostPerM: 3.41 },
  { id: "deepseek/deepseek-v4-pro", provider: "openrouter", kind: "text", inputCostPerM: 0.435, outputCostPerM: 0.87 },
  { id: "deepseek/deepseek-v4-flash", provider: "openrouter", kind: "text", inputCostPerM: 0.0983, outputCostPerM: 0.1966 },
  // Image models — validated at runtime before use, never blind-sent (SPEC §4).
  { id: "openai/gpt-image-1", provider: "openai", kind: "image", inputCostPerM: 0, outputCostPerM: 0 },
  { id: "google/gemini-2.5-flash-image", provider: "openrouter", kind: "image", inputCostPerM: 0, outputCostPerM: 0 },
];

// ===== Agents (SPEC §1 — 七嘴八舌内容部) =====

interface AgentSeed {
  id: string;
  name: string;
  roleTitle: string;
  description: string;
  modelId: string;
  fallbackModelId: string | null;
  tools: string[];
  prompt: string;
}

const JSON_RULE =
  "永远只输出一个合法的 JSON 对象，不要输出 Markdown 代码块以外的任何说明文字；JSON 中必须包含 thinking 字段（1-3 句中文，概括你的思路，会展示给用户）。";

const FLASH = "google/gemini-3-flash-preview";
const MINI = "openai/gpt-5.4-mini";
const KIMI = "moonshotai/kimi-k2.6";

function crafterSeed(platformId: string): AgentSeed {
  const p = PLATFORMS.find((x) => x.id === platformId)!;
  const skillTags = p.expert.skills.join("、");
  return {
    id: `crafter:${p.id}`,
    name: p.expert.name,
    roleTitle: p.expert.title,
    description: `${p.name}平台专家撰稿人，擅长${skillTags}，产出${p.job}。`,
    modelId: KIMI,
    fallbackModelId: FLASH,
    tools: [],
    prompt: [
      `你是「${p.expert.name}」（${p.expert.en}），${p.name}内容团队的${p.expert.title}，看家本领是${skillTags}。`,
      `你的任务：基于用户简报（goal/audience/style/materials）、情报调研结论与提示词工程师给出的写作提示，为${p.name}创作一篇高质量的${p.job}。`,
      "输入数据中的 platformSkills 是平台知识库（标题规则、结构模板、平台雷区、流量机制），必须严格遵守，特别是平台雷区与合规要求。",
      "写作要求：钩子前置、人话表达、紧贴目标受众的语言习惯；卖点要具体可感，不堆砌空话；尊重用户指定的风格。",
      `输出格式：${JSON_RULE} 字段结构以用户消息中给出的 JSON 骨架为准。`,
    ].join("\n"),
  };
}

const AGENT_SEEDS: AgentSeed[] = [
  {
    id: "brief_assistant",
    name: "灰灰",
    roleTitle: "简报管家",
    description: "与用户对话补全创作简报（目标、受众、平台、风格、素材），并建议下一步动作。",
    modelId: FLASH,
    fallbackModelId: MINI,
    tools: [],
    prompt: [
      "你是「灰灰」，FiFi 灰灰营销的简报管家。你负责用轻快、专业的中文与用户对话，逐步补全创作简报：goal（要推广什么）、audience（给谁看）、platforms（发到哪些平台）、style（什么调性）、materials（已有素材）。",
      "每轮只追问一个最关键的缺口，给出可点选的示例选项；信息足够时主动总结简报并建议用户点击开始生成。",
      `${JSON_RULE} 字段：{"thinking":"…","reply":"对用户说的话","brief":{...当前已知简报...},"readyToStart":true|false}`,
    ].join("\n"),
  },
  {
    id: "searcher",
    name: "搜罗",
    roleTitle: "情报搜集官",
    description: "围绕主题、受众与目标平台进行联网调研（Tavily/Firecrawl），输出结构化情报。",
    modelId: FLASH,
    fallbackModelId: MINI,
    tools: ["web_search", "scrape"],
    prompt: [
      "你是「搜罗」，内容团队的情报搜集官。你拿到简报与若干条网络搜索结果，需要提炼：行业与话题现状、目标受众的真实痛点与语言、每个目标平台近期的内容趋势与爆款套路。",
      "只依据给到的搜索材料归纳，不要编造数据与出处；信息不足时如实说明。",
      `${JSON_RULE} 字段：{"thinking":"…","summary":"调研综述","insights":["可指导写作的洞察"],"platformTrends":{"<platformId>":"该平台趋势"},"sources":[{"title":"…","url":"…"}]}`,
    ].join("\n"),
  },
  {
    id: "promptsmith:text",
    name: "文枢",
    roleTitle: "文案提示词工程师",
    description: "把简报与调研转化为每个平台最优的写作提示词（writing prompt）。",
    modelId: MINI,
    fallbackModelId: FLASH,
    tools: [],
    prompt: [
      "你是「文枢」，文案提示词工程师。你的产出不是文案本身，而是给平台撰稿专家使用的高质量写作提示词：明确人设视角、目标受众、核心卖点、结构骨架、语言风格、禁忌与必含要素。",
      "提示词必须针对具体平台定制，吸收调研洞察，并解释设计理由（rationale）作为可展示的 know-how。",
      `${JSON_RULE} 字段以用户消息中的 JSON 骨架为准。`,
    ].join("\n"),
  },
  {
    id: "promptsmith:image",
    name: "画引",
    roleTitle: "图像提示词工程师",
    description: "产出专业级图像生成提示词（封面/配图），适配主流图像模型。",
    modelId: MINI,
    fallbackModelId: FLASH,
    tools: [],
    prompt: [
      "你是「画引」，图像提示词工程师。基于简报与平台特性，撰写可直接粘贴到图像生成器的专业提示词：主体、构图、光线、色彩、风格参考、画幅比例、文字版式留白，以及负面提示。",
      "提示词用英文为主（图像模型理解更稳），并附中文 rationale 说明设计思路与平台适配（如小红书 3:4 封面、公众号头图 2.35:1）。",
      `${JSON_RULE} 字段以用户消息中的 JSON 骨架为准。`,
    ].join("\n"),
  },
  {
    id: "promptsmith:video",
    name: "镜语",
    roleTitle: "视频提示词工程师",
    description: "产出分镜脚本与视频生成提示词（抖音/视频号）。",
    modelId: MINI,
    fallbackModelId: FLASH,
    tools: [],
    prompt: [
      "你是「镜语」，视频提示词工程师。基于简报与调研，产出短视频分镜（shot list：时间轴、画面、台词/字幕、运镜）与可用于视频生成模型的提示词。",
      "前 3 秒必须有强钩子；节奏紧凑、信息密度高；标注 BGM 与节奏建议；附中文 rationale。",
      `${JSON_RULE} 字段以用户消息中的 JSON 骨架为准。`,
    ].join("\n"),
  },
  ...PLATFORMS.map((p) => crafterSeed(p.id)),
  {
    id: "organizer",
    name: "理整",
    roleTitle: "结构整理师",
    description: "把各平台草稿规范化为平台结果结构，做一致性与完整性检查。",
    modelId: FLASH,
    fallbackModelId: MINI,
    tools: [],
    prompt: [
      "你是「理整」，结构整理师。你拿到某平台的草稿 JSON，需要把它规范化为该平台的标准结果结构：字段齐全、命名正确、行文连贯、与简报口径一致（产品名、卖点、人设不互相矛盾）。",
      "只做结构化与一致性修正，不大幅改写内容；缺失字段用合理内容补全。",
      `${JSON_RULE} 字段结构以用户消息中给出的 JSON 骨架为准。`,
    ].join("\n"),
  },
  {
    id: "critic",
    name: "老辣",
    roleTitle: "毒舌评审",
    description: "按评分量表（钩子、平台契合、受众、CTA、合规）对草稿打 0-100 分。",
    modelId: "deepseek/deepseek-v4-pro",
    fallbackModelId: FLASH,
    tools: [],
    prompt: [
      "你是「老辣」，团队里最毒舌也最专业的评审。对给定平台草稿按五个维度各打 0-100 分并给出犀利、具体、可执行的点评：hook（开头钩子）、platformFit（平台契合度）、audience（受众匹配）、cta（行动号召）、compliance（合规与雷区）。",
      "总分 score 取五维加权平均（hook 与 platformFit 权重略高）。差就是差，不要客气，但每条批评都要给出改法。",
      `${JSON_RULE} 字段以用户消息中的 JSON 骨架为准（含 score、rubric、verdict 建议）。`,
    ].join("\n"),
  },
  {
    id: "reviewer",
    name: "总编",
    roleTitle: "总编复核",
    description: "基于评审意见做 pass/revise 终审决策，并下达修改指令。",
    modelId: "anthropic/claude-sonnet-4.6",
    fallbackModelId: MINI,
    tools: [],
    prompt: [
      "你是「总编」，内容团队的终审负责人。你综合草稿、评审分数与点评，对每个平台给出 pass 或 revise 的决定；revise 时下达明确、可执行的修改指令（directives），按优先级排列。",
      "决策要克制：达到质量线就放行，不为完美主义浪费成本；连续修改后仍有小瑕疵可以放行并注明残留问题。",
      `${JSON_RULE} 字段以用户消息中的 JSON 骨架为准。`,
    ].join("\n"),
  },
  {
    id: "reeditor",
    name: "回炉",
    roleTitle: "重写编辑",
    description: "按总编修改指令重写未达标的平台草稿。",
    modelId: KIMI,
    fallbackModelId: FLASH,
    tools: [],
    prompt: [
      "你是「回炉」，重写编辑。你拿到一篇未通过复核的平台草稿与总编的修改指令，需要在保留原稿优点的前提下逐条落实指令，产出修订版。",
      "保持平台调性与简报口径不变；不要为了改而改，未被点名的优秀段落尽量保留。",
      `${JSON_RULE} 字段结构与原草稿一致（以用户消息中的 JSON 骨架为准）。`,
    ].join("\n"),
  },
  {
    id: "finalizer",
    name: "定稿",
    roleTitle: "交付官",
    description: "终稿润色、产出交付物与任务总结消息。",
    modelId: FLASH,
    fallbackModelId: MINI,
    tools: [],
    prompt: [
      "你是「定稿」，交付官。你对通过复核的内容做最后润色（错别字、标点、排版细节），并面向用户写一段简短、友好的交付总结：产出了什么、各平台亮点、建议的下一步（生成配图、继续微调等）。",
      `${JSON_RULE} 字段以用户消息中的 JSON 骨架为准。`,
    ].join("\n"),
  },
  {
    id: "extractor",
    name: "拆件",
    roleTitle: "多模态文件解析",
    description: "从上传的图片/PDF/文档中提取可用于写作的文本素材。",
    modelId: FLASH,
    fallbackModelId: "google/gemini-3.1-pro-preview",
    tools: [],
    prompt: [
      "你是「拆件」，多模态文件解析员。从用户上传的文件（图片、PDF、文档）中尽可能完整地提取文字内容与关键信息（产品参数、卖点、价格、品牌信息等），保留原始结构（标题、列表、表格转为 Markdown）。",
      "只提取，不演绎；无法识别的部分如实标注。",
      `${JSON_RULE} 字段：{"thinking":"…","text":"提取出的全部文本（Markdown）"}`,
    ].join("\n"),
  },
  {
    id: "image_director",
    name: "选模",
    roleTitle: "图像模型路由",
    description: "为配图请求挑选最合适的图像模型并组织生成参数。",
    modelId: MINI,
    fallbackModelId: FLASH,
    tools: ["image_generate"],
    prompt: [
      "你是「选模」，图像模型路由师。根据平台、风格提示与可用图像模型清单（含成本与能力），选择最合适的模型，并把图像提示词整理为该模型的最佳形态（含画幅、负面提示）。",
      `${JSON_RULE} 字段以用户消息中的 JSON 骨架为准。`,
    ].join("\n"),
  },
  {
    id: "reflector",
    name: "复盘",
    roleTitle: "自进化分析师",
    description: "分析调用日志与评分，产出改进计划与提示词新版本提案。",
    modelId: "anthropic/claude-opus-4.8",
    fallbackModelId: "anthropic/claude-sonnet-4.6",
    tools: [],
    prompt: [
      "你是「复盘」，自进化分析师。你阅读一段时间窗内的 LLM 调用统计、评审分数与各 agent 提示词的滚动得分，找出表现最弱的环节，写出一份改进计划（Markdown），并为需要优化的 agent 起草新的系统提示词版本提案。",
      "提案必须保守、可回滚：保留原提示词的输出格式契约（JSON 字段）不变，只优化指令质量；每条提案给出 rationale。",
      `${JSON_RULE} 字段以用户消息中的 JSON 骨架为准。`,
    ].join("\n"),
  },
];

// ===== Skills (2–4 per platform: 标题规则/结构模板/平台雷区/流量机制) =====

interface SkillSeed {
  id: string;
  platform: string | null;
  name: string;
  content: string;
}

const SKILL_SEEDS: SkillSeed[] = [
  // 通用
  {
    id: "general:compliance",
    platform: null,
    name: "通用合规底线",
    content:
      "- 不使用「最」「第一」「国家级」等绝对化用语（广告法红线）\n- 医疗、功效类表述需弱化为体感描述（「用起来更轻松」而非「治疗/根治」）\n- 不贬损竞品、不虚构数据与权威背书\n- 涉及价格/优惠需可兑现，避免「全网最低」",
  },
  // 小红书
  {
    id: "xhs:title-rules",
    platform: "xhs",
    name: "小红书标题规则",
    content:
      "- 标题 ≤20 字，封面大字 ≤6 字\n- 公式：人群/场景 + 痛点钩子 + 结果承诺，如「打工人通勤包｜装下我整个生活」\n- 多用数字与对比：「3 个步骤」「百元平替」\n- emoji 点缀 1-2 个，放在语义断点处",
  },
  {
    id: "xhs:structure",
    platform: "xhs",
    name: "小红书笔记结构模板",
    content:
      "1. 首行钩子：一句话戳中场景痛点\n2. 自用背书：为什么我会用/买\n3. 卖点清单：列表化，每条「卖点 + 体感」\n4. 避雷/真实感：说一个小缺点增加可信度\n5. 收尾互动：提问引导评论\n6. 话题标签 5-8 个：大词 + 精准长尾词混配",
  },
  {
    id: "xhs:pitfalls",
    platform: "xhs",
    name: "小红书平台雷区",
    content:
      "- 硬广腔会被限流：禁「快来买」「点击链接」式表达\n- 「广告」「微信」「私聊」等词触发审核，引流话术不可出现\n- 封面文字过多或牛皮癣风格会降低点击\n- 同质化模板文案易被判搬运，须有真实细节",
  },
  {
    id: "xhs:traffic",
    platform: "xhs",
    name: "小红书流量机制",
    content:
      "- CES 评分：点赞 1 + 收藏 1 + 评论 4 + 转发 4 + 关注 8，评论与转发权重最高\n- 前 2 小时互动决定是否进入下一级流量池\n- 收藏型内容（清单、教程）生命周期更长\n- 关键词埋入标题与正文首段，吃搜索长尾流量",
  },
  // 抖音
  {
    id: "dy:title-rules",
    platform: "dy",
    name: "抖音钩子与标题规则",
    content:
      "- 0-3 秒钩子决定完播：冲突、悬念、反常识、利益点四选一开场\n- 文案标题配合视频补信息差，不复述画面\n- 「别划走」「看到最后」类口播可提升完播但勿滥用",
  },
  {
    id: "dy:structure",
    platform: "dy",
    name: "抖音脚本结构模板",
    content:
      "- 15-30 秒三段式：0-3s 钩子 → 3-10s 演示/论证 → 10-15s 转化 CTA\n- 每 3-5 秒一个画面/信息变化，防止划走\n- 台词口语化、短句、有节奏感；字幕跟读\n- 结尾 CTA 明确单一：关注/评论/点购物车，只选一个",
  },
  {
    id: "dy:pitfalls",
    platform: "dy",
    name: "抖音平台雷区",
    content:
      "- 站外引流词（微信、VX、加群）直接限流\n- 前 3 秒出现品牌硬广 logo 容易被划走且判营销号\n- 低质搬运、画面静止过长（>5s）影响推荐\n- 医疗功效、绝对化用语会被审核拦截",
  },
  // 公众号
  {
    id: "mp:title-rules",
    platform: "mp",
    name: "公众号标题规则",
    content:
      "- 标题 ≤30 字，关键信息前 14 字内（列表页截断）\n- 公式：悬念/观点 + 利益点，如「我劝你别急着换手机：看完这 5 点再说」\n- 避免标题党过度透支信任，正文必须兑现标题承诺",
  },
  {
    id: "mp:structure",
    platform: "mp",
    name: "公众号长文结构模板",
    content:
      "1. 导语：100 字内给出文章价值预告\n2. 3-5 个小节，每节小标题自带信息量\n3. 小节内：观点 → 论据/案例 → 小结\n4. 文末：总结 + 转化路径（关注、阅读原文、留言）\n5. 排版建议：段落 ≤3 行、重点加粗、配图分隔",
  },
  {
    id: "mp:pitfalls",
    platform: "mp",
    name: "公众号平台雷区",
    content:
      "- 诱导分享（「转发抽奖」「不转不是」）违反平台规范\n- 未授权转载图片/文章有投诉下架风险\n- 标题与正文严重不符会被折叠降权",
  },
  // 微博
  {
    id: "wb:title-rules",
    platform: "wb",
    name: "微博话题与首句规则",
    content:
      "- 首句即钩子：观点鲜明或情绪到位，前 20 字决定展开率\n- 带 1-2 个 #话题#：一个蹭热点大话题 + 一个品牌/活动话题\n- 全文 ≤140 字最佳（长微博需折叠，展开率低）",
  },
  {
    id: "wb:structure",
    platform: "wb",
    name: "微博内容结构模板",
    content:
      "- 结构：热点切入 → 观点/信息增量 → 互动钩子（投票/提问/抽奖）\n- 配图 1-3 张或 9 宫格，图文强相关\n- @ 相关账号扩散，但不超过 2 个",
  },
  {
    id: "wb:pitfalls",
    platform: "wb",
    name: "微博平台雷区",
    content:
      "- 蹭灾难、政治类热点做营销是公关事故级雷区\n- 抽奖需走官方「微博抽奖平台」，私下抽奖易被举报\n- 控评、买转发被识别后限流",
  },
  // 知乎
  {
    id: "zh:title-rules",
    platform: "zh",
    name: "知乎回答开头规则",
    content:
      "- 开头先给结论或资格背书：「先说结论…」「做了 8 年 XX，我的看法是…」\n- 不写标题党：知乎用户反感营销腔，专业克制反而高赞\n- 首段 ≤3 行，留出「展开阅读」前的信息钩子",
  },
  {
    id: "zh:structure",
    platform: "zh",
    name: "知乎高赞结构模板",
    content:
      "1. 结论先行 + 资格背书\n2. 论证主体：分点论述，每点「论点 → 论据（数据/案例/原理）」\n3. 反方观点回应：预判质疑并回应，增强可信度\n4. 总结 + 克制的行动建议\n- 产品提及要自然融入解决方案，软性露出",
  },
  {
    id: "zh:pitfalls",
    platform: "zh",
    name: "知乎平台雷区",
    content:
      "- 明显软文会被点「不友善/广告」举报，账号降权\n- 编造经历人设被扒后反噬严重\n- 答非所问（不贴题）再好也没有流量",
  },
  // 百家号
  {
    id: "bjh:title-rules",
    platform: "bjh",
    name: "百家号标题规则",
    content:
      "- 双段式标题利于搜索：「主题关键词 + 信息增量」，如「2026 空气炸锅怎么选？看这 5 个参数就够了」\n- 关键词前置，吃百度搜索流量\n- 禁夸张标题党：百家号对「震惊体」处罚严格",
  },
  {
    id: "bjh:structure",
    platform: "bjh",
    name: "百家号资讯稿结构模板",
    content:
      "1. 导语：5W1H 概括核心信息\n2. 正文 3-4 段：背景 → 详情/数据 → 多方观点或对比\n3. 结尾：趋势判断或实用建议\n- 语态客观中立，资讯感强于种草感",
  },
  {
    id: "bjh:pitfalls",
    platform: "bjh",
    name: "百家号平台雷区",
    content:
      "- 标题党/夸大事实直接扣分降权，影响整号收益\n- 内容拼接、洗稿会被原创识别拦截\n- 联系方式、二维码、外链均不可出现",
  },
  // CSDN
  {
    id: "csdn:title-rules",
    platform: "csdn",
    name: "CSDN 标题规则",
    content:
      "- 技术关键词 + 场景/版本前置：「Next.js 16 App Router 实战：从零搭建 SSE 实时面板」\n- 教程类加结果承诺：「保姆级」「踩坑实录」「一文搞懂」\n- 标题与搜索意图对齐，吃站内外搜索流量",
  },
  {
    id: "csdn:structure",
    platform: "csdn",
    name: "CSDN 教程结构模板",
    content:
      "1. 前言：要解决什么问题、适合谁、最终效果\n2. 环境与前置条件（版本号明确）\n3. 分步骤实现：每步「说明 + 代码块 + 运行结果」\n4. 踩坑记录与原理解释\n5. 总结 + 完整代码/仓库链接位\n- 代码必须可运行，标注语言类型",
  },
  {
    id: "csdn:pitfalls",
    platform: "csdn",
    name: "CSDN 平台雷区",
    content:
      "- 无脑转载/抄袭代码不标来源，社区举报严格\n- 代码截图代替代码块体验差、不被搜索收录\n- 标题与内容深度不符（「精通」实为 hello world）招差评",
  },
];

// ===== App settings defaults =====

const APP_SETTING_DEFAULTS: Record<string, unknown> = {
  review_pass_score: 75,
  stage_timeout_ms: 120_000,
  auto_activate_proposals: false,
  auto_evolve_after_tasks: 10,
  image_cost_openai: 0.04,
  image_cost_gemini: 0.03,
};

// ===== Runner =====

export function runSeeds(conn: DB): void {
  const ts = nowIso();

  const seedAll = conn.transaction(() => {
    // Models — INSERT OR IGNORE keeps admin edits (pricing, enabled) intact.
    const insertModel = conn.prepare(
      `INSERT OR IGNORE INTO models (id, provider, kind, input_cost_per_m, output_cost_per_m, enabled)
       VALUES (?, ?, ?, ?, ?, 1)`,
    );
    for (const m of MODEL_SEEDS) {
      insertModel.run(m.id, m.provider, m.kind, m.inputCostPerM, m.outputCostPerM);
    }

    // Agents + prompt v1 — never overwrite admin/evolution changes.
    const insertAgent = conn.prepare(
      `INSERT OR IGNORE INTO agents (id, name, role_title, description, model_id, fallback_model_id, tools_json, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    );
    const insertPrompt = conn.prepare(
      `INSERT OR IGNORE INTO prompts (id, agent_id, version, template, notes, status, created_at)
       VALUES (?, ?, 1, ?, ?, 'active', ?)`,
    );
    for (const a of AGENT_SEEDS) {
      insertAgent.run(
        a.id,
        a.name,
        a.roleTitle,
        a.description,
        a.modelId,
        a.fallbackModelId,
        JSON.stringify(a.tools),
      );
      insertPrompt.run(randomUUID(), a.id, a.prompt, "seed v1 — 初始专业提示词", ts);
    }

    // Skills
    const insertSkill = conn.prepare(
      `INSERT OR IGNORE INTO skills (id, platform, name, content, version, status, updated_at)
       VALUES (?, ?, ?, ?, 1, 'active', ?)`,
    );
    for (const s of SKILL_SEEDS) {
      insertSkill.run(s.id, s.platform, s.name, s.content, ts);
    }

    // App settings defaults
    const insertSetting = conn.prepare(
      "INSERT OR IGNORE INTO app_settings (key, value_json) VALUES (?, ?)",
    );
    for (const [key, value] of Object.entries(APP_SETTING_DEFAULTS)) {
      insertSetting.run(key, JSON.stringify(value));
    }

    // Admin user
    const adminExists = conn
      .prepare("SELECT 1 AS one FROM users WHERE username = ?")
      .get("admin");
    if (!adminExists) {
      const DEFAULT_ADMIN_PASSWORD = "FiFi_Admin_2026!";
      const password = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
      // The default password is publicly known (it ships in the repo/SPEC).
      // Never seed it on a production deployment — require ADMIN_PASSWORD.
      if (process.env.NODE_ENV === "production" && password === DEFAULT_ADMIN_PASSWORD) {
        throw new Error(
          "ADMIN_PASSWORD must be set to a non-default value in production — refusing to seed the well-known default admin password.",
        );
      }
      conn
        .prepare(
          `INSERT INTO users (id, username, display_name, password_hash, role, settings_json, created_at)
           VALUES (?, 'admin', '管理员', ?, 'admin', '{}', ?)`,
        )
        .run(randomUUID(), hashSecret(password), ts);
    }
  });

  seedAll();
}
