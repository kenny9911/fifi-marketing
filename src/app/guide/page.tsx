import type { Metadata } from "next";
import Link from "next/link";
import { BurstStar } from "@/components/shared/BurstStar";
import { LogoMark } from "@/components/shared/LogoMark";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { GUIDE_GENERAL, GUIDE_PLATFORMS } from "@/lib/guide-content";
import type { GuideSource } from "@/lib/guide-content";
import { getPlatform } from "@/lib/platforms";

export const metadata: Metadata = {
  title: "创作指南 · 灰灰营销 FiFi",
  description:
    "各平台爆款方法论：小红书、抖音、公众号、微博、知乎、百家号、CSDN 的算法机制、内容公式、标题套路与避坑红线，全部有据可查。",
};

/* ===== derived editorial stats (computed from the content itself) ===== */

const SOURCE_COUNT =
  GUIDE_GENERAL.sources.length +
  GUIDE_PLATFORMS.reduce((n, g) => n + g.sources.length, 0);

const POINT_COUNT =
  GUIDE_GENERAL.principles.length +
  GUIDE_GENERAL.workflow.length +
  GUIDE_GENERAL.toolTips.length +
  GUIDE_PLATFORMS.reduce(
    (n, g) =>
      n +
      g.algorithm.length +
      g.formula.length +
      g.titleTips.length +
      g.dos.length +
      g.donts.length +
      g.metrics.length,
    0,
  );

/** accent colors cycled through the numbered principle cards */
const ACCENTS = [
  "text-poppy",
  "text-klein",
  "text-amber-deep",
  "text-jade",
  "text-rose",
];

/** "标题前置：说明文字" → ["标题前置", "说明文字"]; no colon → [s, null] */
function splitLead(s: string): [string, string | null] {
  const i = s.indexOf("：");
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, null];
}

/* ===== small presentational pieces ===== */

function SubHead({ zh, en }: { zh: string; en: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <h3 className="font-display text-[24px] font-normal leading-[1.3]">
        {zh}
      </h3>
      <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
        {en}
      </span>
    </div>
  );
}

function SourceList({ sources }: { sources: GuideSource[] }) {
  return (
    <div className="border-t-[1.5px] border-dashed border-tan pt-5">
      <div className="mb-2.5 font-grotesk text-[10.5px] font-bold tracking-[2px] text-stone">
        参考来源 · SOURCES
      </div>
      <ol className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
        {sources.map((s, i) => (
          <li key={s.url} className="flex gap-2 text-[12.5px] leading-[1.7]">
            <span className="shrink-0 font-archivo text-[10.5px] text-tan-dark">
              {String(i + 1).padStart(2, "0")}
            </span>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              title="在新窗口打开来源"
              className="text-stone underline decoration-tan underline-offset-2 hover:text-ink"
            >
              {s.title} ↗
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ===== page ===== */

/** Public long-form playbook: general principles + 7 platform chapters. */
export default function GuidePage() {
  return (
    <div className="bg-paper">
      {/* top bar */}
      <header className="border-b-2 border-ink bg-paper">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-5 lg:px-12">
          <Link href="/" className="flex items-center gap-2.5" title="回到首页">
            <LogoMark size={26} />
            <span className="font-display text-2xl font-normal">灰灰营销</span>
            <span className="font-grotesk text-xs font-bold tracking-[1.5px] text-poppy">
              FiFi*
            </span>
          </Link>
          <Link
            href="/studio"
            title="进入灰灰创作台"
            className="rounded-full bg-ink px-[22px] py-[11px] text-[14.5px] font-bold text-paper shadow-[4px_4px_0_#FF4B2E]"
          >
            去创作台
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden border-b-2 border-ink bg-cream">
        <BurstStar
          size={96}
          fill="#FFC53D"
          className="absolute left-[6%] top-[36px] hidden -rotate-12 lg:block"
        />
        <BurstStar
          size={64}
          fill="#FF7AB6"
          className="absolute bottom-[42px] right-[8%] hidden rotate-[18deg] lg:block"
        />
        <div
          aria-hidden
          className="absolute -right-16 -top-20 hidden h-[260px] w-[260px] rotate-[12deg] rounded-[40px] bg-mist lg:block"
        />
        <div className="relative mx-auto max-w-[900px] px-6 py-20 text-center lg:py-24">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-paper px-3.5 py-[7px] font-grotesk text-xs font-bold tracking-[2px]">
            <span className="h-2 w-2 rounded-full bg-poppy" />
            THE FIFI PLAYBOOK
          </div>
          <h1 className="mb-3 font-display text-[44px] font-normal leading-[1.15] sm:text-[68px]">
            各平台<span className="rounded-[12px] bg-sun px-3">爆款</span>方法论
          </h1>
          <div className="mb-6 font-grotesk text-[14px] font-bold tracking-[3px] text-klein">
            PLAYBOOK · 7 PLATFORMS · 2026 EDITION
          </div>
          <p className="mx-auto mb-10 max-w-[640px] text-[16px] leading-[1.9] text-soot text-pretty">
            灰灰把 2025–2026
            中文社媒的算法机制、内容公式、标题套路与避坑红线，整理成这份公开手册——
            每一条都有出处，可以直接照着做。它也是七位平台专家写稿时遵循的同一套方法论。
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            {[
              { num: "07", label: "平台方法论" },
              { num: `${POINT_COUNT}`, label: "实操要点" },
              { num: `${SOURCE_COUNT}`, label: "参考来源" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-[16px] border-2 border-ink bg-paper px-7 py-4 shadow-[5px_5px_0_#17130C]"
              >
                <div className="font-archivo text-[28px] leading-none text-poppy">
                  {stat.num}
                </div>
                <div className="mt-1.5 text-[12.5px] font-bold text-soot">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* sticky chapter nav */}
      <nav
        aria-label="章节导航"
        className="sticky top-0 z-40 border-b-2 border-ink bg-paper print:hidden"
      >
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 overflow-x-auto px-6 py-3 lg:px-12">
          <span className="mr-1 hidden shrink-0 font-grotesk text-[11px] font-bold tracking-[2px] text-stone sm:inline">
            JUMP TO
          </span>
          <a
            href="#general"
            title="跳到通用心法"
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border-[1.5px] border-ink bg-cream px-3.5 py-1.5 text-[13px] font-bold"
          >
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-ink" />
            通用心法
          </a>
          {GUIDE_PLATFORMS.map((g) => (
            <a
              key={g.id}
              href={`#${g.id}`}
              title={`跳到「${g.name}」章节`}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border-[1.5px] border-tan-mid bg-paper px-3.5 py-1.5 text-[13px] font-medium hover:border-ink"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: getPlatform(g.id).uiColor }}
              />
              {g.name}
            </a>
          ))}
        </div>
      </nav>

      {/* ===== 通用心法 ===== */}
      <section id="general" className="scroll-mt-[72px] bg-paper">
        <div className="mx-auto max-w-[1200px] space-y-14 px-6 py-16 lg:px-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-[36px] font-normal leading-[1.2] sm:text-[44px]">
              先懂通用心法，再谈平台套路
            </h2>
            <span className="font-grotesk text-[13px] font-bold tracking-[3px] text-stone">
              GENERAL PRINCIPLES
            </span>
          </div>

          {/* principles: numbered cards */}
          <div className="grid gap-5 md:grid-cols-2">
            {GUIDE_GENERAL.principles.map((p, i) => {
              const [lead, body] = splitLead(p);
              return (
                <div
                  key={p}
                  className="rounded-[16px] border-2 border-ink bg-paper p-5 shadow-[5px_5px_0_#E8E3D8]"
                >
                  <div
                    className={`font-archivo text-[26px] leading-none ${ACCENTS[i % ACCENTS.length]}`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-2.5 text-[15.5px] font-black leading-[1.5]">
                    {lead}
                  </div>
                  {body && (
                    <div className="mt-1.5 text-[13.5px] leading-[1.8] text-soot">
                      {body}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* weekly workflow: ink card */}
          <div className="overflow-hidden rounded-[20px] border-2 border-ink bg-ink shadow-[8px_8px_0_#FFC53D]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-7 pb-2 pt-7">
              <h3 className="font-display text-[26px] font-normal text-paper">
                一周内容操作系统
              </h3>
              <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                WEEKLY OS
              </span>
            </div>
            <ol className="px-7 pb-7">
              {GUIDE_GENERAL.workflow.map((w, i) => {
                const [lead, body] = splitLead(w);
                return (
                  <li
                    key={w}
                    className="flex gap-4 border-b border-dashed border-soot py-3.5 last:border-0 last:pb-1"
                  >
                    <span className="w-8 shrink-0 font-archivo text-[15px] text-sun">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="text-[14px] leading-[1.75]">
                      <span className="font-bold text-paper">{lead}</span>
                      {body && <span className="text-tan-light">：{body}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* tool tips */}
          <div>
            <SubHead zh="AI 工具心法" en="TOOLCRAFT" />
            <div className="grid gap-4 md:grid-cols-2">
              {GUIDE_GENERAL.toolTips.map((t) => (
                <div
                  key={t}
                  className="flex gap-3 rounded-[14px] border-[1.5px] border-tan bg-cream px-5 py-4 text-[13.5px] leading-[1.8]"
                >
                  <span aria-hidden className="font-bold text-klein">
                    ✦
                  </span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <SourceList sources={GUIDE_GENERAL.sources} />
        </div>
      </section>

      {/* ===== 七个平台章节 ===== */}
      {GUIDE_PLATFORMS.map((g, idx) => {
        const platform = getPlatform(g.id);
        const accent = platform.uiColor;
        const chapter = String(idx + 1).padStart(2, "0");
        return (
          <section
            key={g.id}
            id={g.id}
            className="scroll-mt-[72px] border-t-2 border-ink"
          >
            {/* platform color band */}
            <div aria-hidden className="h-2.5" style={{ background: platform.color }} />

            {/* chapter header */}
            <div className="border-b-2 border-ink bg-cream">
              <div className="mx-auto max-w-[1200px] px-6 py-12 lg:px-12">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div className="flex items-start gap-5">
                    <div
                      aria-hidden
                      className="flex h-[72px] w-[72px] shrink-0 items-center justify-center border-2 border-ink font-archivo text-[20px]"
                      style={{
                        background: platform.color,
                        borderRadius: platform.expert.avatarRadius,
                        color: platform.expert.monoColor,
                        boxShadow: "5px 5px 0 #17130C",
                      }}
                    >
                      {platform.expert.mono}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-grotesk text-[12px] font-bold tracking-[2px] text-stone">
                          CHAPTER {chapter}
                        </span>
                        <h2 className="font-display text-[38px] font-normal leading-[1.15] sm:text-[44px]">
                          {g.name}
                        </h2>
                        <span
                          className="rounded-full px-3 py-1 text-[12px] font-bold"
                          style={{
                            background: accent,
                            color:
                              g.id === "dy" ? "#FFFFFF" : platform.expert.monoColor,
                          }}
                        >
                          {platform.job}
                        </span>
                      </div>
                      <p className="mt-2.5 max-w-[620px] text-[15.5px] leading-[1.8] text-soot text-pretty">
                        {g.tagline}
                      </p>
                    </div>
                  </div>

                  {/* expert byline */}
                  <div className="flex items-center gap-3 rounded-[16px] border-2 border-ink bg-paper px-4 py-3 shadow-[5px_5px_0_#17130C]">
                    <div>
                      <div className="text-[15px] font-black leading-tight">
                        「{platform.expert.name}」
                        <span className="font-grotesk text-[11px] font-bold tracking-[1px] text-stone">
                          {" "}
                          {platform.expert.en}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-stone">
                        本章主笔 · {platform.expert.title}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* chapter body */}
            <div className="bg-paper">
              <div className="mx-auto max-w-[1200px] space-y-12 px-6 pb-16 pt-12 lg:px-12">
                {/* 算法机制 + 内容公式 */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-[18px] border-2 border-ink bg-paper p-6 shadow-[6px_6px_0_#E8E3D8]">
                    <SubHead zh="算法机制" en="ALGORITHM" />
                    <ol className="space-y-3">
                      {g.algorithm.map((a, i) => (
                        <li key={a} className="flex gap-3">
                          <span
                            className="w-7 shrink-0 font-archivo text-[14px] leading-[1.7]"
                            style={{ color: accent }}
                          >
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="text-[13.5px] leading-[1.75]">{a}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="rounded-[18px] border-2 border-ink bg-paper p-6 shadow-[6px_6px_0_#E8E3D8]">
                    <SubHead zh="内容公式" en="FORMULA" />
                    <ol>
                      {g.formula.map((f, i) => (
                        <li
                          key={f}
                          className="flex items-start gap-3.5 border-b border-dashed border-tan py-3 first:pt-0 last:border-0 last:pb-0"
                        >
                          <span
                            aria-hidden
                            className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] font-archivo text-[12px] text-white"
                            style={{ background: accent }}
                          >
                            {i + 1}
                          </span>
                          <span className="text-[13.5px] leading-[1.75]">{f}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* 标题套路 */}
                <div>
                  <SubHead zh="标题套路" en="TITLE HOOKS" />
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {g.titleTips.map((t) => {
                      const [lead, body] = splitLead(t);
                      return (
                        <div
                          key={t}
                          className="rounded-[14px] border-[1.5px] border-ink bg-cream px-4 py-3.5"
                        >
                          <div
                            className="text-[13.5px] font-black"
                            style={{ color: accent }}
                          >
                            {lead}
                          </div>
                          {body && (
                            <div className="mt-1 text-[12.5px] leading-[1.7] text-soot">
                              {body}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* dos / don'ts */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-ink bg-jade px-4 py-1.5 text-[13px] font-bold text-paper">
                      ✓ 这样做 · DO
                    </div>
                    <ul className="space-y-2.5">
                      {g.dos.map((d) => (
                        <li
                          key={d}
                          className="flex gap-2.5 rounded-[12px] border-[1.5px] border-jade bg-[#f0faf5] px-4 py-3 text-[13.5px] leading-[1.7]"
                        >
                          <span aria-hidden className="font-black text-jade">
                            ✓
                          </span>
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border-2 border-ink bg-poppy px-4 py-1.5 text-[13px] font-bold text-paper">
                      ✗ 别这样 · DON&apos;T
                    </div>
                    <ul className="space-y-2.5">
                      {g.donts.map((d) => (
                        <li
                          key={d}
                          className="flex gap-2.5 rounded-[12px] border-[1.5px] border-poppy bg-[#fff3f0] px-4 py-3 text-[13.5px] leading-[1.7]"
                        >
                          <span aria-hidden className="font-black text-poppy">
                            ✗
                          </span>
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* 发布时间 + 关键指标 */}
                <div className="grid gap-6 lg:grid-cols-5">
                  <div className="rounded-[18px] border-2 border-ink bg-sun p-6 shadow-[6px_6px_0_#17130C] lg:col-span-2">
                    <div className="mb-3 flex items-baseline gap-3">
                      <h3 className="font-display text-[22px] font-normal">
                        ⏱ 最佳发布时间
                      </h3>
                      <span className="font-grotesk text-[10.5px] font-bold tracking-[2px] text-soot">
                        BEST TIME
                      </span>
                    </div>
                    <p className="text-[13.5px] leading-[1.9]">{g.bestTimes}</p>
                  </div>
                  <div className="rounded-[18px] border-2 border-ink bg-ink p-6 text-paper shadow-[6px_6px_0_#17130C] lg:col-span-3">
                    <div className="mb-4 flex items-baseline gap-3">
                      <h3 className="font-display text-[22px] font-normal text-paper">
                        关键指标
                      </h3>
                      <span className="font-grotesk text-[10.5px] font-bold tracking-[2px] text-stone">
                        KEY METRICS
                      </span>
                    </div>
                    <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                      {g.metrics.map((m) => (
                        <li key={m} className="flex gap-2.5">
                          <span
                            aria-hidden
                            className="mt-[7px] h-2 w-2 shrink-0 rounded-[2px]"
                            style={{ background: accent }}
                          />
                          <span className="text-[13px] leading-[1.7] text-tan-light">
                            {m}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* 案例拆解 */}
                <figure
                  className="relative rounded-[18px] border-2 border-ink bg-cream p-7 pl-8 sm:pl-16"
                  style={{ boxShadow: `8px 8px 0 ${platform.color}` }}
                >
                  <span
                    aria-hidden
                    className="absolute left-5 top-4 hidden font-display text-[44px] leading-none sm:block"
                    style={{ color: accent }}
                  >
                    「
                  </span>
                  <figcaption className="mb-2.5 flex items-baseline gap-3">
                    <span className="font-display text-[20px]">案例拆解</span>
                    <span className="font-grotesk text-[10.5px] font-bold tracking-[2px] text-stone">
                      CASE STUDY
                    </span>
                  </figcaption>
                  <blockquote className="text-[14.5px] leading-[2] text-soot">
                    {g.caseStudy}
                  </blockquote>
                </figure>

                <SourceList sources={g.sources} />
              </div>
            </div>
          </section>
        );
      })}

      {/* closing CTA */}
      <section className="relative overflow-hidden border-t-2 border-ink bg-cream print:hidden">
        <BurstStar
          size={80}
          fill="#FFC53D"
          className="absolute left-[70px] top-[30px] hidden -rotate-[14deg] sm:block"
        />
        <BurstStar
          size={60}
          fill="#FF7AB6"
          className="absolute bottom-[26px] right-[80px] hidden rotate-[20deg] sm:block"
        />
        <div className="relative mx-auto max-w-[1400px] px-6 py-20 text-center lg:px-12">
          <h2 className="mb-3 font-display text-[36px] font-normal leading-[1.25] sm:text-[52px]">
            方法论看懂了？
            <br className="sm:hidden" />
            让专家团替你写
          </h2>
          <div className="mb-9 font-grotesk text-[13px] font-bold tracking-[3px] text-klein">
            LET THE EXPERTS DO THE WRITING
          </div>
          <Link
            href="/studio"
            title="进入创作台，提交一份简报"
            className="inline-block rounded-2xl border-2 border-ink bg-poppy px-10 py-[18px] text-[18px] font-bold text-paper shadow-[8px_8px_0_#17130C]"
          >
            去创作台，让专家团替你写 →
          </Link>
          <div className="mt-4 text-[13px] text-stone">
            这页的每一条方法论，七位平台专家都背得滚瓜烂熟。
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
