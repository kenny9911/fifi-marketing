"use client";

import type { Studio } from "@/components/studio/useStudio";
import { getPlatform } from "@/lib/platforms";
import type { StudioPhase } from "@/lib/types";

const FILLING_PHASES: StudioPhase[] = [
  "audience",
  "platform",
  "style",
  "materials",
];

function statusFor(phase: StudioPhase): {
  label: string;
  pill: string;
  dot: string;
} {
  if (FILLING_PHASES.includes(phase)) {
    return { label: "简报填写中", pill: "bg-sun text-ink", dot: "bg-ink" };
  }
  if (phase === "generating") {
    return {
      label: "专家创作中…",
      pill: "bg-klein text-paper",
      dot: "bg-douyin-cyan",
    };
  }
  if (phase === "done") {
    return {
      label: "已生成 · 可微调",
      pill: "bg-jade text-paper",
      dot: "bg-paper",
    };
  }
  return {
    label: "等待简报",
    pill: "bg-ink/[0.07] text-soot",
    dot: "bg-tan-dark",
  };
}

export function BriefPanel({ studio }: { studio: Studio }) {
  const { brief } = studio;
  const platformNames = brief.platforms
    .map((id) => getPlatform(id).name)
    .join("、");

  const fields = [
    { label: "目标 GOAL", value: brief.goal },
    { label: "受众 AUDIENCE", value: brief.audience },
    { label: "平台 PLATFORMS", value: platformNames },
    { label: "风格 STYLE", value: brief.style },
    { label: "素材 MATERIALS", value: brief.materials },
  ];

  const status = statusFor(studio.phase);

  return (
    <div className="flex h-full flex-col gap-[18px] border-r-2 border-ink bg-cream px-[22px] py-6">
      <div>
        <div className="text-[17px] font-black">创作简报</div>
        <div className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
          CREATIVE BRIEF
        </div>
      </div>
      <div className="flex flex-col gap-[14px] text-sm">
        {fields.map((field) => (
          <div
            key={field.label}
            className="rounded-xl border-[1.5px] border-tan bg-paper px-[14px] py-3"
          >
            <div className="mb-1 text-[11.5px] font-bold text-stone">
              {field.label}
            </div>
            <div className="leading-[1.6]">{field.value || "待填写 —"}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto">
        <div
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold ${status.pill}`}
        >
          <span className={`h-2 w-2 rounded-full ${status.dot}`} />
          {status.label}
        </div>
      </div>
    </div>
  );
}
