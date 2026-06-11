import type { PlatformId } from "./types";

/**
 * Canned demo outputs for the studio results panel.
 *
 * These mirror the design prototype exactly. The agent pipeline returns real
 * per-platform content in these same shapes (finals in `artifacts` rows) —
 * the result cards only know about these types.
 */

export interface XhsResult {
  kind: "xhs";
  coverHeadline: string;
  coverSub: string;
  title: string;
  /** body paragraphs/lines, rendered with line breaks */
  bodyLines: string[];
  hashtags: string[];
  tuningNotes: string[];
}

export interface DyShot {
  time: string;
  /** chip colors from the design: cyan 0–3s, yellow 3–10s, red 10–15s */
  chipBg: string;
  chipColor: string;
  label: string;
  text: string;
}

export interface DyResult {
  kind: "dy";
  title: string;
  subtitle: string;
  shots: DyShot[];
  tuningNotes: string[];
}

export interface MpResult {
  kind: "mp";
  badge: string;
  meta: string;
  title: string;
  intro: string;
  outline: string[];
  tuningNotes: string[];
}

/**
 * Final shape the pipeline writes for platforms without a bespoke card
 * (wb/zh/bjh/csdn) and as the error placeholder for any platform whose
 * generation failed (see `errorDraft` in the pipeline stages).
 */
export interface GenericResult {
  kind: "generic";
  title: string;
  sections: string[];
  hashtags?: string[];
  tuningNotes: string[];
  /** true when this is an error placeholder for a failed platform */
  error?: boolean;
}

export type PlatformResult = XhsResult | DyResult | MpResult;

/** What `TaskDetail.finals` actually carries per platform. */
export type FinalResult = PlatformResult | GenericResult;

export const DEMO_RESULTS: Partial<Record<PlatformId, PlatformResult>> = {
  xhs: {
    kind: "xhs",
    coverHeadline: "3秒一杯",
    coverSub: "打工人的续命快乐水",
    title: "打工人续命神器！3 秒一杯的冻干咖啡也太香了",
    bodyLines: [
      "最近被办公室姐妹安利了这个冻干咖啡，真的回不去了…",
      "① 热水冷水都能冲，3 秒全溶不结块",
      "② 一颗 = 一杯美式，深烘豆子香气在线",
      "③ 算下来一杯不到 4 块，比楼下咖啡店省太多",
      "早八人冲鸭，链接放评论区了～",
    ],
    hashtags: ["#冻干咖啡", "#打工人日常", "#办公室好物", "#咖啡测评", "#早八人"],
    tuningNotes: [
      "标题 19 字 · 含热词「打工人」",
      "正文 186 字 · 列表化卖点",
      "建议周三 12:30 发布",
    ],
  },
  dy: {
    kind: "dy",
    title: "15s 短视频脚本 · 「再也不用排队买咖啡了」",
    subtitle: "抖音 · 阿飞 出品 · HOOK FIRST",
    shots: [
      {
        time: "0–3s",
        chipBg: "#25F4EE",
        chipColor: "#161823",
        label: "钩子",
        text: "怼脸拍：把咖啡粉倒进冰美式，3 秒摇匀。台词：「公司楼下咖啡店倒闭了，我居然一点都不慌」",
      },
      {
        time: "3–10s",
        chipBg: "#FFC53D",
        chipColor: "#161823",
        label: "演示",
        text: "办公位实拍三连：热水冲 / 冰水摇 / 兑燕麦奶。字幕逐条弹出卖点：3 秒全溶 · 一颗一杯 · 不到 4 块",
      },
      {
        time: "10–15s",
        chipBg: "#FE2C55",
        chipColor: "#FFFFFF",
        label: "转化",
        text: "口播：「整个工位的快乐都是它给的，小黄车里见」。结尾定格产品 + 价格贴纸。",
      },
    ],
    tuningNotes: [
      "前 3 秒反常识钩子",
      "BGM：轻快 City Pop 卡点",
      "建议 18:00–20:00 发布",
    ],
  },
  mp: {
    kind: "mp",
    badge: "公众号 · 文叔 出品",
    meta: "预计阅读 4 分钟 · 约 2400 字",
    title: "为什么精品冻干，成了写字楼里的新社交货币",
    intro:
      "导语：当「带杯咖啡上楼」变成职场社交礼仪，一颗 4 块钱的冻干，正在悄悄改写写字楼的咖啡经济学。",
    outline: [
      "从排队 20 分钟到 3 秒一杯：办公室咖啡的效率革命",
      "拆解一颗冻干的成本账：为什么它能做到 4 块钱",
      "三个真实工位故事：谁在为「即溶精品」买单",
      "怎么挑不踩雷：看豆源、看工艺、看溶解度",
    ],
    tuningNotes: [
      "标题走「现象解读」路线",
      "第 3 节后插入转化卡片",
      "文末引导「在看 + 星标」",
    ],
  },
};
