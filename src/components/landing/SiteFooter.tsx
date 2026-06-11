import { LogoMark } from "@/components/shared/LogoMark";

const FOOTER_LINKS = ["产品", "价格", "帮助中心", "用户协议", "隐私政策"];

/** Ink footer: logo + wordmark, link row, copyright / ICP notice. */
export function SiteFooter() {
  return (
    <footer className="bg-ink text-[13px] text-tan-dark">
      <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-6 px-6 py-10 md:flex-row lg:px-12">
        <div className="flex items-center gap-[10px]">
          <LogoMark size={20} />
          <span className="font-display text-[19px] font-normal text-paper">
            灰灰营销 FiFi*
          </span>
        </div>
        <div className="flex flex-wrap justify-center gap-7">
          {FOOTER_LINKS.map((link) => (
            <span key={link}>{link}</span>
          ))}
        </div>
        <div>© 2026 灰灰营销 · 沪ICP备2026xxxxxx号</div>
      </div>
    </footer>
  );
}
