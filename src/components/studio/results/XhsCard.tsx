import { BurstStar } from "@/components/shared/BurstStar";
import {
  ResultActions,
  TuningNotes,
} from "@/components/studio/results/CardParts";
import type { XhsResult } from "@/lib/results";

/** 小红书 result card: cover mock + note body + hashtags + tuning notes. */
export function XhsCard({ result }: { result: XhsResult }) {
  const copyText = [
    result.title,
    "",
    ...result.bodyLines,
    "",
    result.hashtags.join(" "),
  ].join("\n");

  return (
    <div className="overflow-hidden rounded-[18px] bg-paper">
      <div className="relative flex h-[170px] items-center justify-center bg-rose">
        <BurstStar size={120} fill="#FFC53D" />
        <div className="absolute text-center">
          <div className="font-display text-[30px] font-normal leading-[1.2]">
            {result.coverHeadline}
          </div>
          <div className="text-sm font-black">{result.coverSub}</div>
        </div>
        <span className="absolute left-3 top-3 rounded-full bg-xhs px-[11px] py-1 text-[11.5px] font-bold text-white">
          小红书 · 桃桃 出品
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-[rgba(255,253,247,.9)] px-2.5 py-1 text-[11px] font-bold">
          封面建议
        </span>
      </div>
      <div className="px-[22px] py-5">
        <div className="text-[16.5px] font-black leading-[1.6]">
          {result.title}
        </div>
        <div className="mt-2.5 whitespace-pre-line text-[13.5px] leading-[1.95] text-soot">
          {result.bodyLines.join("\n")}
        </div>
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {result.hashtags.map((tag) => (
            <span key={tag} className="text-xs font-bold text-klein">
              {tag}
            </span>
          ))}
        </div>
        <TuningNotes name="桃桃" notes={result.tuningNotes} className="mt-4" />
        <ResultActions
          primary="复制全文"
          copyText={copyText}
          secondary={["换个角度", "微调标题"]}
          className="mt-4"
        />
      </div>
    </div>
  );
}
