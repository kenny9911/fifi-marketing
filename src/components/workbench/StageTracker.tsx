"use client";

import { Fragment } from "react";
import {
  PIPELINE_STAGES,
  type PipelineStage,
  type TaskStatus,
} from "@/lib/api-types";

type StepState = "done" | "active" | "pending" | "failed" | "cancelled";

/**
 * Compact horizontal 8-step pipeline tracker that sits atop the flight deck.
 * Done steps are ink-filled with ✓, the active step pulses in poppy with its
 * EN label, pending steps stay outlined; failed/cancelled runs tint the bar.
 * Pure presentational — feed it `stage`/`status` from the task stream
 * (`status` may be null before the stream delivers its first payload).
 */
export function StageTracker({
  stage,
  status,
}: {
  stage: PipelineStage | null;
  status: TaskStatus | null;
}) {
  const idx = stage ? PIPELINE_STAGES.findIndex((s) => s.id === stage) : -1;
  // done = whole run delivered; reviewing with no stage = pipeline finished,
  // waiting on the user's verdict.
  const finished = status === "done" || (status === "reviewing" && idx === -1);

  const stateOf = (i: number): StepState => {
    if (finished) return "done";
    if (idx === -1) return "pending";
    if (i < idx) return "done";
    if (i > idx) return "pending";
    if (status === "failed") return "failed";
    if (status === "cancelled") return "cancelled";
    return "active";
  };

  const surface =
    status === "failed"
      ? "border-poppy bg-[#FFE7E0]"
      : status === "cancelled"
        ? "border-tan-dark bg-sand"
        : "border-ink bg-cream";

  return (
    <div
      className={`flex items-center rounded-[14px] border-[1.5px] px-3 py-2.5 ${surface}`}
      title="流水线 8 个阶段：情报搜集 → 提示词工程 → 专家撰稿 → 结构整理 → 毒舌评审 → 总编复核 → 回炉重写 → 定稿交付"
    >
      {PIPELINE_STAGES.map((s, i) => {
        const st = stateOf(i);
        return (
          <Fragment key={s.id}>
            <div
              className="flex shrink-0 items-center"
              title={`${s.label} · ${s.en}`}
            >
              {st === "done" ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-paper">
                  ✓
                </span>
              ) : st === "active" ? (
                <span className="flex items-center gap-1.5 rounded-full bg-poppy px-2.5 py-[5px] text-paper shadow-[2px_2px_0_#17130C]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-paper" />
                  <span className="text-[11.5px] font-bold leading-none">
                    {s.label}
                  </span>
                  <span className="font-grotesk text-[9px] font-bold leading-none tracking-[1px] opacity-85">
                    {s.en}
                  </span>
                </span>
              ) : st === "failed" ? (
                <span className="flex items-center gap-1.5 rounded-full bg-poppy px-2.5 py-[5px] text-paper">
                  <span className="text-[11px] font-bold leading-none">✕</span>
                  <span className="text-[11.5px] font-bold leading-none">
                    {s.label}
                  </span>
                  <span className="font-grotesk text-[9px] font-bold leading-none tracking-[1px] opacity-85">
                    FAILED
                  </span>
                </span>
              ) : st === "cancelled" ? (
                <span className="flex items-center gap-1.5 rounded-full bg-stone px-2.5 py-[5px] text-paper">
                  <span className="text-[11.5px] font-bold leading-none">
                    {s.label}
                  </span>
                  <span className="font-grotesk text-[9px] font-bold leading-none tracking-[1px] opacity-85">
                    CANCELLED
                  </span>
                </span>
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-tan-mid bg-paper font-grotesk text-[10px] font-bold text-stone">
                  {i + 1}
                </span>
              )}
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <span
                aria-hidden
                className={`h-[2px] min-w-1.5 flex-1 ${
                  stateOf(i + 1) === "pending" ? "bg-tan" : "bg-ink"
                }`}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
