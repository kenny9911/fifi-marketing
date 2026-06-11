import Link from "next/link";
import { LogoMark } from "@/components/shared/LogoMark";

/** Sticky site header: logo + anchor nav + studio CTA. */
export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 bg-paper border-b-2 border-ink">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between px-6 lg:px-12 py-5">
        <div className="flex items-center gap-2.5">
          <LogoMark size={26} />
          <span className="font-display font-normal text-2xl">灰灰营销</span>
          <span className="font-grotesk font-bold text-xs tracking-[1.5px] text-poppy">
            FiFi*
          </span>
        </div>
        <div className="flex items-center gap-8">
          <nav className="hidden md:flex items-center gap-8 text-[15px] font-medium">
            <a href="#how">产品</a>
            <a href="#experts">AI 专家团</a>
            <a href="#showcase">案例</a>
            <a href="#cta">价格</a>
          </nav>
          <Link
            href="/studio"
            className="bg-ink text-paper px-[22px] py-[11px] rounded-full font-bold text-[14.5px] shadow-[4px_4px_0_#FF4B2E]"
          >
            免费开始创作
          </Link>
        </div>
      </div>
    </header>
  );
}
