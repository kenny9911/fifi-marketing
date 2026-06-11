"use client";

import { BurstStar } from "@/components/shared/BurstStar";
import { DyCard } from "@/components/studio/results/DyCard";
import { MpCard } from "@/components/studio/results/MpCard";
import { OtherCard } from "@/components/studio/results/OtherCard";
import { XhsCard } from "@/components/studio/results/XhsCard";
import type { Studio } from "@/components/studio/useStudio";
import { getPlatform } from "@/lib/platforms";
import { DEMO_RESULTS } from "@/lib/results";
import type { ExpertProgress } from "@/lib/types";

/**
 * Right column of the studio: empty hint → expert progress while generating
 * → tabbed per-platform result cards once done.
 */
export function ResultsPanel({ studio }: { studio: Studio }) {
  return (
    <section className="flex h-full min-w-0 flex-col bg-ink">
      {studio.phase === "generating" ? (
        <GeneratingState experts={studio.experts} />
      ) : studio.phase === "done" ? (
        <DoneState studio={studio} />
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-10">
      <div className="relative h-[130px] w-[130px]">
        <BurstStar size={130} fill="#FFC53D" />
        <div className="absolute inset-0 flex items-center justify-center font-display text-[24px] font-normal text-ink">
          出稿
        </div>
      </div>
      <div className="text-[17px] font-bold text-paper">
        生成结果会出现在这里
      </div>
      <div className="text-center text-[13.5px] leading-[1.9] text-stone">
        填好简报后，各平台专家会分头开工
        <br />
        <span className="font-grotesk text-[11px] font-bold tracking-[2px]">
          OUTPUT · PER-PLATFORM TUNED
        </span>
      </div>
    </div>
  );
}

function GeneratingState({ experts }: { experts: ExpertProgress[] }) {
  return (
    <div className="flex flex-1 flex-col gap-4 px-7 py-8">
      <div className="text-[18px] font-black text-paper">专家团创作中…</div>
      <div className="mb-2 font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
        EXPERTS AT WORK
      </div>
      {experts.map((e) => {
        const pct = Math.round(e.pct);
        const status =
          e.pct >= 100
            ? "已完成 ✓"
            : e.pct > 60
              ? "正在调优标题与标签…"
              : "正在撰写初稿…";
        return (
          <div
            key={e.id}
            className="rounded-[14px] border border-[rgba(255,253,247,.14)] bg-[rgba(255,253,247,.06)] px-[18px] py-4"
          >
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] font-archivo text-xs text-white"
                style={{ background: e.uiColor }}
              >
                {e.expert.mono}
              </div>
              <div>
                <div className="text-[14.5px] font-bold text-paper">
                  {e.expert.name} · {e.name} · {e.job}
                </div>
                <div className="text-xs text-stone">{status}</div>
              </div>
              <div className="ml-auto font-grotesk text-[13px] font-bold text-sun">
                {pct}%
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[rgba(255,253,247,.12)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: e.uiColor }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DoneState({ studio }: { studio: Studio }) {
  const result = DEMO_RESULTS[studio.activeResult];

  return (
    <>
      <div className="px-6 pt-5">
        <div className="flex items-baseline justify-between">
          <div className="text-[18px] font-black text-paper">生成结果</div>
          <div className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
            PER-PLATFORM TUNED
          </div>
        </div>
        <div className="my-4 flex gap-2">
          {studio.brief.platforms.map((id) => {
            const platform = getPlatform(id);
            const active = studio.activeResult === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => studio.setActiveResult(id)}
                className={`cursor-pointer rounded-full border-[1.5px] px-4 py-2 text-[13.5px] font-bold ${
                  active
                    ? "text-white"
                    : "border-[rgba(255,253,247,.3)] bg-transparent text-tan-dark"
                }`}
                style={
                  active
                    ? {
                        background: platform.uiColor,
                        borderColor: platform.uiColor,
                      }
                    : undefined
                }
              >
                {platform.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="scrollbar-studio min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {result?.kind === "xhs" ? (
          <XhsCard result={result} />
        ) : result?.kind === "dy" ? (
          <DyCard result={result} />
        ) : result?.kind === "mp" ? (
          <MpCard result={result} />
        ) : (
          <OtherCard platform={getPlatform(studio.activeResult)} />
        )}
      </div>
    </>
  );
}
