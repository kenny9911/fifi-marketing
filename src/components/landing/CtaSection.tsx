import Link from "next/link";
import { BurstStar } from "@/components/shared/BurstStar";

/** Final call-to-action: display headline, studio link button, free-quota caption. */
export function CtaSection() {
  return (
    <section
      id="cta"
      className="overflow-hidden border-t-2 border-ink bg-cream"
    >
      <div className="relative mx-auto max-w-[1400px] px-6 py-[88px] text-center lg:px-12">
        <BurstStar
          size={80}
          fill="#FFC53D"
          className="absolute left-[70px] top-[30px] hidden -rotate-[14deg] sm:block"
        />
        <BurstStar
          size={64}
          fill="#FF7AB6"
          className="absolute bottom-[24px] right-[80px] hidden rotate-[20deg] sm:block"
        />
        <h2 className="mb-[14px] font-display text-[40px] font-normal leading-[1.2] sm:text-[60px]">
          让灰灰，承包你的全网内容
        </h2>
        <div className="mb-9 font-grotesk text-[14px] font-bold tracking-[3px] text-klein">
          START CREATING IN 60 SECONDS
        </div>
        <Link
          href="/studio"
          className="inline-block rounded-2xl border-2 border-ink bg-poppy px-11 py-[19px] text-[19px] font-bold text-paper shadow-[8px_8px_0_#17130C]"
        >
          免费开始创作 →
        </Link>
        <div className="mt-[18px] text-[13px] text-stone">
          每月 20 篇免费额度 · 无需信用卡
        </div>
      </div>
    </section>
  );
}
