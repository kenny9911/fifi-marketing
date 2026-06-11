import {
  ResultActions,
  TuningNotes,
} from "@/components/studio/results/CardParts";
import type { MpResult } from "@/lib/results";

/** 公众号 result card: wechat strip + title/intro + numbered outline. */
export function MpCard({
  result,
  onRefine,
  refineDisabledReason,
}: {
  result: MpResult;
  /** sends a preset revision directive (label) through the chat flow */
  onRefine?: (label: string) => void;
  refineDisabledReason?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[18px] bg-paper">
      <div className="h-2 bg-wechat" />
      <div className="p-[22px]">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-wechat px-[11px] py-1 text-[11.5px] font-bold text-white">
            {result.badge}
          </span>
          <span className="text-xs text-stone">{result.meta}</span>
        </div>
        <div className="text-[18px] font-black leading-[1.6]">
          {result.title}
        </div>
        <div className="mt-2.5 border-l-[3px] border-wechat pl-3 text-[13.5px] leading-[1.95] text-soot">
          {result.intro}
        </div>
        <div className="mt-3.5 flex flex-col gap-2 text-[13.5px]">
          {result.outline.map((item, i) => (
            <div key={item} className="flex gap-2.5">
              <span className="font-grotesk font-bold text-wechat">
                {String(i + 1).padStart(2, "0")}
              </span>
              {item}
            </div>
          ))}
        </div>
        <TuningNotes name="文叔" notes={result.tuningNotes} className="mt-4" />
        <ResultActions
          primary="展开全文"
          secondary={["换个标题", "调整大纲"]}
          onSecondary={onRefine}
          secondaryDisabledReason={refineDisabledReason}
          className="mt-4"
        />
      </div>
    </div>
  );
}
