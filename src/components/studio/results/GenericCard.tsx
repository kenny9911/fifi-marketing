"use client";

import {
  ResultActions,
  TuningNotes,
} from "@/components/studio/results/CardParts";
import type { GenericResult } from "@/lib/results";
import type { Platform } from "@/lib/types";

/**
 * Result card for platforms without a bespoke layout (微博/知乎/百家号/CSDN)
 * and for error placeholder finals: colored platform strip + sectioned body +
 * hashtags + tuning notes, matching the Xhs/Dy/Mp card idiom.
 */
export function GenericCard({
  result,
  platform,
  onRefine,
  refineDisabledReason,
}: {
  result: GenericResult;
  platform: Platform;
  /** sends a preset revision directive (label) through the chat flow */
  onRefine?: (label: string) => void;
  refineDisabledReason?: string;
}) {
  const accent = result.error ? "#FF4B2E" : platform.uiColor;
  const copyText = [
    result.title,
    "",
    ...result.sections,
    ...(result.hashtags?.length ? ["", result.hashtags.join(" ")] : []),
  ].join("\n");

  return (
    <div className="overflow-hidden rounded-[18px] bg-paper">
      <div className="h-2" style={{ background: accent }} />
      <div className="p-[22px]">
        <div className="mb-3 flex items-center gap-2">
          <span
            className="rounded-full px-[11px] py-1 text-[11.5px] font-bold text-white"
            style={{ background: accent }}
          >
            {platform.name} · {platform.expert.name} 出品
          </span>
          <span className="text-xs text-stone">{platform.job}</span>
        </div>
        {result.error && (
          <div className="mb-3 rounded-[10px] border-[1.5px] border-poppy bg-[#FFE9E4] px-3 py-2 text-[12.5px] font-bold leading-[1.7] text-poppy">
            本平台生成失败，以下为降级占位稿 —
            可在对话里输入修改意见，让专家重新生成
          </div>
        )}
        <div className="text-[17px] font-black leading-[1.6]">
          {result.title}
        </div>
        <div className="mt-2.5 flex flex-col gap-2.5 text-[13.5px] leading-[1.95] text-soot">
          {result.sections.map((section, i) => (
            <p key={i} className="whitespace-pre-line">
              {section}
            </p>
          ))}
        </div>
        {result.hashtags && result.hashtags.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {result.hashtags.map((tag) => (
              <span key={tag} className="text-xs font-bold text-klein">
                {tag}
              </span>
            ))}
          </div>
        )}
        {result.tuningNotes.length > 0 && (
          <TuningNotes
            name={platform.expert.name}
            notes={result.tuningNotes}
            className="mt-4"
          />
        )}
        <ResultActions
          primary="复制全文"
          copyText={copyText}
          secondary={["换个角度", "再润色"]}
          onSecondary={onRefine}
          secondaryDisabledReason={refineDisabledReason}
          className="mt-4"
        />
      </div>
    </div>
  );
}
