import Link from "next/link";
import { BurstStar } from "@/components/shared/BurstStar";

/** Landing hero: headline + CTAs on the left, pop-collage of platform cards on the right. */
export function Hero() {
  return (
    <section className="bg-cream">
      <div className="relative max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_600px] gap-10 px-6 lg:px-12 pt-16 pb-[72px]">
        {/* Left: copy */}
        <div className="pt-4">
          <div className="inline-flex items-center gap-2 border-[1.5px] border-ink bg-paper rounded-full px-3.5 py-[7px] font-grotesk font-bold text-xs tracking-[2px] mb-[26px]">
            <span className="w-2 h-2 bg-jade rounded-full" />
            AI-NATIVE CONTENT STUDIO
          </div>
          <h1 className="font-display font-normal text-[54px] lg:text-[78px] leading-[1.12] mb-2.5">
            一句话，
            <br />
            承包你的<span className="text-poppy">全网内容</span>
          </h1>
          <div className="font-grotesk font-bold text-[15px] tracking-[3px] text-klein mb-[22px]">
            ONE BRIEF → EVERY PLATFORM
          </div>
          <p className="text-[17px] leading-[1.9] text-soot max-w-[520px] mb-[34px] text-pretty">
            输入目标、受众与手头素材，灰灰的平台专家 AI
            团队接单创作——微博、公众号、小红书、抖音、知乎、百家号、CSDN，每个平台一篇为它量身调优的内容。
          </p>
          <div className="flex gap-4 items-center">
            <Link
              href="/studio"
              className="bg-poppy text-paper px-[34px] py-[17px] rounded-[14px] font-bold text-[17px] border-2 border-ink shadow-[6px_6px_0_#17130C]"
            >
              开始创作 →
            </Link>
            <a
              href="#how"
              className="font-bold text-base border-b-[2.5px] border-ink pb-0.5"
            >
              看 90 秒演示
            </a>
          </div>
          <div className="flex flex-wrap gap-6 mt-10 text-[13.5px] text-stone">
            <span>✓ 无需排版经验</span>
            <span>✓ 平台规则自动适配</span>
            <span>✓ 中文语感优先</span>
          </div>
        </div>

        {/* Right: collage */}
        <div className="relative h-[560px] hidden lg:block">
          {/* color blobs */}
          <div className="absolute top-[30px] right-10 w-[300px] h-[300px] bg-sun rounded-[32px] rotate-[8deg]" />
          <div className="absolute bottom-10 left-2.5 w-[220px] h-[220px] bg-klein rounded-full" />
          <div className="absolute top-0 left-20 w-[120px] h-[120px] bg-jade rounded-[0_50%_50%_50%] -rotate-[10deg]" />

          {/* xiaohongshu card */}
          <div className="absolute top-[70px] left-[50px] w-[256px] bg-paper border-2 border-ink rounded-[18px] -rotate-[5deg] shadow-[8px_8px_0_#17130C] overflow-hidden z-[3]">
            <div className="relative h-[150px] bg-rose flex items-center justify-center">
              <BurstStar size={110} fill="#FFC53D" />
              <div className="absolute font-display text-[26px] text-ink">
                3秒一杯
              </div>
              <span className="absolute top-2.5 left-2.5 bg-xhs text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
                小红书
              </span>
            </div>
            <div className="py-3.5 px-4">
              <div className="font-bold text-[14.5px] leading-[1.5]">
                打工人续命神器！冻干咖啡也太香了
              </div>
              <div className="flex items-center gap-2 mt-2.5 text-xs text-stone">
                <span className="w-[18px] h-[18px] bg-xhs rounded-full inline-block" />
                桃桃 · 赞 2.1w
              </div>
            </div>
          </div>

          {/* douyin card */}
          <div className="absolute top-[130px] right-[30px] w-[184px] h-[312px] bg-douyin border-2 border-ink rounded-[20px] rotate-[4deg] shadow-[8px_8px_0_#17130C] z-[4] overflow-hidden">
            <span className="absolute top-3 left-3 bg-douyin-red text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
              抖音
            </span>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 bg-douyin-cyan rounded-full flex items-center justify-center">
              <div className="w-0 h-0 border-l-[18px] border-l-douyin border-y-[11px] border-y-transparent ml-[5px]" />
            </div>
            <div className="absolute bottom-[18px] left-3.5 right-3.5 text-white">
              <div className="text-[12.5px] font-bold leading-[1.5]">
                「再也不用排队买咖啡」
              </div>
              <div className="text-[11px] text-douyin-cyan mt-1.5 font-grotesk">
                15s SCRIPT · HOOK READY
              </div>
            </div>
          </div>

          {/* gongzhonghao strip */}
          <div className="absolute bottom-[70px] left-[90px] w-[320px] bg-paper border-2 border-ink rounded-[14px] -rotate-2 shadow-[6px_6px_0_#17130C] py-3.5 px-[18px] z-[5] flex items-center gap-3">
            <span className="w-[34px] h-[34px] bg-wechat rounded-[10px] shrink-0 flex items-center justify-center text-white font-black text-[13px]">
              公
            </span>
            <div>
              <div className="font-bold text-[13.5px]">
                深度长文已生成 · 预计阅读 4 分钟
              </div>
              <div className="text-xs text-stone mt-0.5">
                公众号 · 文叔 · 10w+ 结构
              </div>
            </div>
          </div>

          {/* stickers */}
          <div className="absolute top-1.5 right-[150px] z-[6] rotate-12">
            <BurstStar size={92} fill="#FF4B2E" />
            <div className="absolute inset-0 flex items-center justify-center text-paper font-display text-[22px]">
              爆款
            </div>
          </div>
          <div className="absolute bottom-5 right-[90px] bg-paper border-2 border-ink rounded-full px-4 py-2 font-grotesk font-bold text-xs tracking-[1.5px] -rotate-6 z-[6] shadow-[4px_4px_0_#2849F4]">
            AI GENERATED ✦
          </div>
          <svg
            className="absolute top-[380px] left-0 z-[6]"
            width="90"
            height="64"
            viewBox="0 0 90 64"
            aria-hidden
          >
            <path
              d="M8 54 C 24 14, 54 10, 72 28"
              stroke="#FF4B2E"
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
            />
            <polygon points="78,34 60,30 72,16" fill="#FF4B2E" />
          </svg>
        </div>
      </div>
    </section>
  );
}
