import {
  ResultActions,
  TuningNotes,
} from "@/components/studio/results/CardParts";
import type { DyResult } from "@/lib/results";

/** 抖音 result card: dark video header + timed shot list + tuning notes. */
export function DyCard({
  result,
  onRefine,
  refineDisabledReason,
}: {
  result: DyResult;
  /** sends a preset revision directive (label) through the chat flow */
  onRefine?: (label: string) => void;
  refineDisabledReason?: string;
}) {
  const copyText = [
    result.title,
    "",
    ...result.shots.map((shot) => `${shot.time} ${shot.label}｜${shot.text}`),
  ].join("\n");

  return (
    <div className="overflow-hidden rounded-[18px] bg-paper">
      <div className="flex items-center justify-between bg-douyin px-[22px] py-[18px]">
        <div>
          <div className="text-[15.5px] font-black text-white">
            {result.title}
          </div>
          <div className="mt-1 font-grotesk text-[11px] font-bold tracking-[2px] text-douyin-cyan">
            {result.subtitle}
          </div>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-douyin-red">
          <div className="ml-[3px] h-0 w-0 border-y-8 border-l-[13px] border-y-transparent border-l-white" />
        </div>
      </div>
      <div className="flex flex-col gap-3 px-[22px] py-5">
        {result.shots.map((shot) => (
          <div key={shot.time} className="flex items-start gap-3">
            <span
              className="shrink-0 rounded-lg px-2.5 py-[5px] font-grotesk text-xs font-bold"
              style={{ background: shot.chipBg, color: shot.chipColor }}
            >
              {shot.time}
            </span>
            <div className="text-[13.5px] leading-[1.85]">
              <b>{shot.label}｜</b>
              {shot.text}
            </div>
          </div>
        ))}
        <TuningNotes name="阿飞" notes={result.tuningNotes} />
        <ResultActions
          primary="复制脚本"
          copyText={copyText}
          secondary={["换个钩子", "改 30s 版"]}
          onSecondary={onRefine}
          secondaryDisabledReason={refineDisabledReason}
        />
      </div>
    </div>
  );
}
