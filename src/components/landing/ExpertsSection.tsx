import { BurstStar } from "@/components/shared/BurstStar";
import { PLATFORMS } from "@/lib/platforms";

/** "Meet the experts" intro band + the 7 platform expert cards and recruit card. */
export function ExpertsSection() {
  return (
    <section id="experts">
      {/* intro band */}
      <div className="mx-auto max-w-[1400px] px-12 pt-20 pb-6 text-center">
        <div className="mb-[14px] font-grotesk text-[13px] font-bold tracking-[3px] text-poppy">
          MEET THE EXPERTS
        </div>
        <h2 className="mb-[14px] font-display text-[52px] font-normal leading-[1.2]">
          一支懂中文互联网的{" "}
          <span className="rounded-[10px] bg-sun px-[10px]">AI 专家团</span>
        </h2>
        <p className="mx-auto max-w-[640px] text-[16.5px] leading-[1.9] text-soot">
          每个平台的玩法、语感、流量规则都不一样。灰灰为每个平台训练了一位专属专家——你的简报，由最懂这个平台的「人」来写。
        </p>
      </div>

      {/* expert cards */}
      <div className="mx-auto max-w-[1400px] px-12 pt-9 pb-18">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {PLATFORMS.map((platform) => (
            <div
              key={platform.id}
              className="rounded-[18px] border-2 border-ink bg-paper p-[22px]"
              style={{ boxShadow: `6px 6px 0 ${platform.color}` }}
            >
              <div
                className="mb-[14px] flex h-[60px] w-[60px] items-center justify-center font-archivo text-[18px]"
                style={{
                  background: platform.color,
                  borderRadius: platform.expert.avatarRadius,
                  color: platform.expert.monoColor,
                }}
              >
                {platform.expert.mono}
              </div>
              <div className="text-[19px] font-black">
                「{platform.expert.name}」
                <span className="font-grotesk text-[12px] font-bold tracking-[1px] text-stone">
                  {" "}
                  {platform.expert.en}
                </span>
              </div>
              <div
                className="mt-2 mb-3 inline-block rounded-full px-[10px] py-[3px] text-[12px] font-bold"
                style={{
                  background: platform.color,
                  color: platform.expert.monoColor,
                }}
              >
                {platform.name} · {platform.expert.title}
              </div>
              <div className="flex flex-wrap gap-[6px]">
                {platform.expert.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-tan px-[9px] py-[3px] text-[12px] text-soot"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {/* recruit card */}
          <div className="flex flex-col justify-between rounded-[18px] border-2 border-ink bg-ink p-[22px] shadow-[6px_6px_0_#FFC53D]">
            <BurstStar size={56} fill="#FFC53D" />
            <div>
              <div className="font-display text-[24px] leading-[1.4] text-paper">
                更多平台专家
                <br />
                正在训练中
              </div>
              <div className="mt-[10px] font-grotesk text-[12px] font-bold tracking-[2px] text-stone">
                B站 · 视频号 · COMING SOON
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
