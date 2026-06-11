import type { ChipSetId, Platform, PlatformId } from "./types";

/** The seven platform experts, in canonical display order. */
export const PLATFORMS: Platform[] = [
  {
    id: "xhs",
    name: "小红书",
    color: "#FF2442",
    uiColor: "#FF2442",
    job: "种草笔记",
    expert: {
      name: "桃桃",
      en: "TAOTAO",
      mono: "TT",
      title: "种草主理人",
      skills: ["封面标题党", "话题标签", "爆款笔记结构"],
      avatarRadius: "16px 16px 16px 50%",
      monoColor: "#FFFFFF",
    },
  },
  {
    id: "dy",
    name: "抖音",
    color: "#161823",
    uiColor: "#FE2C55",
    job: "短视频脚本",
    expert: {
      name: "阿飞",
      en: "FEI",
      mono: "AF",
      title: "短视频导演",
      skills: ["3秒开场钩子", "分镜脚本", "热点节奏"],
      avatarRadius: "50% 16px 16px 16px",
      monoColor: "#25F4EE",
    },
  },
  {
    id: "mp",
    name: "公众号",
    color: "#07C160",
    uiColor: "#07C160",
    job: "深度长文",
    expert: {
      name: "文叔",
      en: "UNCLE WEN",
      mono: "WS",
      title: "深度主笔",
      skills: ["长文结构", "转化路径", "排版建议"],
      avatarRadius: "16px",
      monoColor: "#FFFFFF",
    },
  },
  {
    id: "wb",
    name: "微博",
    color: "#E6162D",
    uiColor: "#E6162D",
    job: "热搜话题",
    expert: {
      name: "薇薇",
      en: "VIVI",
      mono: "VV",
      title: "热点操盘手",
      skills: ["热搜借势", "话题互动", "转发裂变"],
      avatarRadius: "50%",
      monoColor: "#FFFFFF",
    },
  },
  {
    id: "zh",
    name: "知乎",
    color: "#0084FF",
    uiColor: "#0084FF",
    job: "高赞回答",
    expert: {
      name: "谨言",
      en: "JINYAN",
      mono: "JY",
      title: "专业答主",
      skills: ["逻辑论证", "专业背书", "高赞结构"],
      avatarRadius: "16px 50% 16px 16px",
      monoColor: "#FFFFFF",
    },
  },
  {
    id: "bjh",
    name: "百家号",
    color: "#2932E1",
    uiColor: "#2932E1",
    job: "资讯稿",
    expert: {
      name: "百晓",
      en: "BAIXIAO",
      mono: "BX",
      title: "资讯编辑",
      skills: ["资讯化表达", "搜索流量", "标题分寸感"],
      avatarRadius: "16px 16px 50% 16px",
      monoColor: "#FFFFFF",
    },
  },
  {
    id: "csdn",
    name: "CSDN",
    color: "#FC5531",
    uiColor: "#FC5531",
    job: "技术教程",
    expert: {
      name: "码哥",
      en: "CODER",
      mono: "MG",
      title: "技术博主",
      skills: ["技术干货", "代码示例", "教程结构"],
      avatarRadius: "8px",
      monoColor: "#FFFFFF",
    },
  },
];

export function getPlatform(id: PlatformId): Platform {
  return PLATFORMS.find((p) => p.id === id)!;
}

/** Quick-reply chips for each briefing question in the studio chat. */
export const CHIP_SETS: Record<Exclude<ChipSetId, "platforms">, string[]> = {
  audience: ["25–35 岁都市白领", "大学生 / 早八人", "宝妈家庭客群", "数码发烧友"],
  style: [
    "真实种草 · 口碑安利",
    "专业测评 · 数据说话",
    "情感故事 · 生活方式",
    "热点借势 · 节奏快",
  ],
  materials: ["有产品图 ×6", "有卖点文档", "只有文字介绍，帮我补全"],
};

/** Sample goals shown above the studio input when idle. */
export const SAMPLE_GOALS = [
  "新品冻干咖啡下周上市，想种草年轻白领",
  "门店三周年庆，想做全网活动推广",
  "科技公司招聘季，想做雇主品牌内容",
];

/** Names scrolled in the landing-page marquee. */
export const MARQUEE_NAMES = [
  ...PLATFORMS.map((p) => p.name),
  "B站",
  "视频号",
];
