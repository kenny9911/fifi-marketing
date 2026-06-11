const BRIEF_ROWS = [
  { label: "目标：", value: "新品冻干咖啡上市种草" },
  { label: "受众：", value: "25–35 岁都市白领" },
  { label: "风格：", value: "真实种草 · 口碑安利" },
  { label: "素材：", value: "产品图 ×6 · 卖点文档" },
];

const OUTPUT_CARDS = [
  {
    stripClass: "bg-xhs",
    labelClass: "text-xhs",
    label: "小红书 · 种草笔记",
    title: "打工人续命神器！3 秒一杯的冻干咖啡也太香了",
    caption: "封面文案 + 正文 + 5 个话题标签",
  },
  {
    stripClass: "bg-douyin",
    labelClass: "text-douyin",
    label: "抖音 · 15s 短视频脚本",
    title: "「再也不用排队买咖啡了」3 镜头分镜脚本",
    caption: "开场钩子 + 台词 + BGM 建议",
  },
  {
    stripClass: "bg-wechat",
    labelClass: "text-wechat",
    label: "公众号 · 深度长文",
    title: "为什么精品冻干，成了写字楼的新社交货币",
    caption: "导语 + 四段大纲 + 转化位建议",
  },
];

/** "One brief, many outputs" showcase: brief card → dashed arrow → 3 platform drafts. */
export function Showcase() {
  return (
    <section id="showcase" className="border-t-2 border-ink">
      <div className="mx-auto max-w-[1400px] px-6 py-[72px] lg:px-12">
        <div className="mb-[44px] text-center">
          <h2 className="mb-[10px] font-display text-[46px] font-normal leading-[1.2]">
            同一份简报，平台各自成稿
          </h2>
          <div className="font-grotesk text-[13px] font-bold tracking-[3px] text-poppy">
            SAME BRIEF · NATIVE VOICE
          </div>
        </div>

        <div className="grid items-center gap-8 lg:grid-cols-[360px_80px_1fr] lg:gap-0">
          {/* Brief card */}
          <div className="rounded-[18px] bg-ink p-[26px] text-paper shadow-[8px_8px_0_#FFC53D]">
            <div className="mb-[14px] font-grotesk text-[12px] font-bold tracking-[2px] text-sun">
              YOUR BRIEF · 你的简报
            </div>
            <div className="text-[14.5px] leading-[2.1]">
              {BRIEF_ROWS.map((row) => (
                <div key={row.label}>
                  <span className="text-stone">{row.label}</span>
                  {row.value}
                </div>
              ))}
            </div>
          </div>

          {/* Dashed arrow */}
          <svg
            width="80"
            height="60"
            viewBox="0 0 80 60"
            className="rotate-90 justify-self-center lg:rotate-0 lg:justify-self-auto"
            aria-hidden
          >
            <path
              d="M6 30 L60 30"
              stroke="#17130C"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="2 10"
            />
            <polygon points="74,30 56,20 56,40" fill="#FF4B2E" />
          </svg>

          {/* Output cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            {OUTPUT_CARDS.map((card) => (
              <div
                key={card.label}
                className="overflow-hidden rounded-2xl border-2 border-ink bg-paper"
              >
                <div className={`h-2 ${card.stripClass}`} />
                <div className="p-[18px]">
                  <div
                    className={`mb-2 text-[12px] font-bold ${card.labelClass}`}
                  >
                    {card.label}
                  </div>
                  <div className="text-[14.5px] font-bold leading-[1.6]">
                    {card.title}
                  </div>
                  <div className="mt-[10px] text-[12px] text-stone">
                    {card.caption}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
