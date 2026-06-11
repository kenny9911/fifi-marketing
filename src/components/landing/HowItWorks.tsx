const STEPS = [
  {
    num: "01",
    stripClass: "bg-poppy",
    numClass: "text-poppy",
    title: "说出你的目标",
    body: "像聊天一样描述：要推什么、给谁看、有什么素材。灰灰会追问补全简报。",
  },
  {
    num: "02",
    stripClass: "bg-klein",
    numClass: "text-klein",
    title: "专家团接单",
    body: "每个目标平台的专属专家分头开工，各自按平台规则与语感创作。",
  },
  {
    num: "03",
    stripClass: "bg-sun",
    numClass: "text-amber-deep",
    title: "七平台同步生成",
    body: "标题、正文、标签、封面建议、发布时间——每篇都按平台调优到位。",
  },
  {
    num: "04",
    stripClass: "bg-jade",
    numClass: "text-jade",
    title: "微调，发布",
    body: "对话式修改任何细节，满意后一键复制或排期发布到各平台。",
  },
];

/** Four-step "how it works" band on the paper background. */
export function HowItWorks() {
  return (
    <section id="how" className="border-t-2 border-ink bg-paper">
      <div className="mx-auto max-w-[1400px] px-12 py-18">
        <div className="mb-10 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[46px] font-normal leading-[1.2]">
            四步，从想法到全网开花
          </h2>
          <span className="font-grotesk text-[13px] font-bold tracking-[3px] text-stone">
            HOW IT WORKS
          </span>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((step) => (
            <div
              key={step.num}
              className="overflow-hidden rounded-[18px] border-2 border-ink"
            >
              <div className={`h-[10px] ${step.stripClass}`} />
              <div className="p-6">
                <div className={`font-archivo text-[34px] ${step.numClass}`}>
                  {step.num}
                </div>
                <div className="mt-[10px] mb-2 text-[19px] font-black">
                  {step.title}
                </div>
                <div className="text-[14px] leading-[1.8] text-soot">
                  {step.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
