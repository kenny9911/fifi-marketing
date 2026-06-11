"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { BurstStar } from "@/components/shared/BurstStar";

export interface CoachStep {
  /** CSS selector of the element this hint points at */
  target: string;
  title: string;
  body: string;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_W = 312;
const GAP = 14;
const EDGE = 16;

/**
 * First-visit guided hints (req 9). Shows one pop-collage card per step with
 * a sun-ring spotlight on the target element; the dim layer is a single
 * box-shadow cutout, so no SVG masking is needed. Dismissal is remembered in
 * localStorage under `storageKey` — once dismissed the component renders
 * nothing, ever.
 *
 * Keyboard: Enter / → next · ← previous · Esc dismiss.
 */
export function CoachMarks({
  steps,
  storageKey,
}: {
  steps: CoachStep[];
  storageKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  // 首次访问才弹出；localStorage 里有记录就永远保持沉默
  useEffect(() => {
    if (steps.length === 0) return;
    let seen = true;
    try {
      seen = window.localStorage.getItem(storageKey) !== null;
    } catch {
      // 隐私模式等拿不到 storage：宁可不弹，也不每次都弹
    }
    if (seen) return;
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [steps.length, storageKey]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // 写不进就算了，本次会话内也不会再弹
    }
    setOpen(false);
  }, [storageKey]);

  const next = useCallback(() => {
    if (index >= steps.length - 1) {
      dismiss(); // 最后一步 → 收尾即视为已读
    } else {
      setIndex(index + 1);
    }
  }, [index, steps.length, dismiss]);

  const prev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // 量取目标位置；窗口缩放 / 滚动时跟随
  const measure = useCallback(() => {
    const step = steps[index];
    const el = step ? document.querySelector(step.target) : null;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [steps, index]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const step = steps[index];
      const el = step ? document.querySelector(step.target) : null;
      if (el) el.scrollIntoView({ block: "nearest" });
      measure();
    });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, index, steps, measure]);

  // 键盘：Esc 关闭，Enter / → 下一步，← 上一步
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss, next, prev]);

  // 焦点落在主按钮上，键盘用户开箱即用
  useEffect(() => {
    if (open) nextBtnRef.current?.focus();
  }, [open, index]);

  if (!open || steps.length === 0) return null;
  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  // 卡片定位：默认贴在目标下方；目标偏下时改挂上方（用 bottom 让卡片向上长）
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardStyle: CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.min(
          Math.max(EDGE, rect.left),
          Math.max(EDGE, vw - CARD_W - EDGE),
        ),
        width: CARD_W,
        ...(rect.top + rect.height + 260 > vh
          ? { bottom: Math.max(EDGE, vh - rect.top + GAP) }
          : { top: rect.top + rect.height + GAP }),
      }
    : {
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: CARD_W,
      };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`新手引导：${step.title}`}
      className="fixed inset-0 z-[80]"
    >
      {/* 聚光圈：box-shadow 把其余区域压暗，圈内保持透亮 */}
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-[14px] border-2 border-sun shadow-[0_0_0_9999px_rgba(23,19,12,0.55)] transition-all duration-200"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-ink/55" />
      )}

      {/* 提示卡片 */}
      <div
        className="rounded-[16px] border-2 border-ink bg-paper p-5 shadow-[6px_6px_0_#17130C]"
        style={cardStyle}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-sun px-2.5 py-[3px] font-grotesk text-[10px] font-bold tracking-[0.14em] text-ink">
            <BurstStar size={10} fill="#17130C" />
            GUIDE
          </span>
          <span className="font-archivo text-[11px] text-stone">
            {index + 1} / {steps.length}
          </span>
        </div>

        <h3 className="mt-3 font-display text-[19px] leading-snug font-normal text-ink">
          {step.title}
        </h3>
        <p className="mt-1.5 text-[13.5px] leading-[1.75] text-soot">
          {step.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={dismiss}
            title="跳过全部引导，以后不再提示（Esc）"
            className="cursor-pointer text-[12.5px] text-stone underline decoration-tan-dark underline-offset-4 hover:text-soot"
          >
            跳过引导
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={prev}
                title="回看上一条提示（←）"
                className="cursor-pointer rounded-[10px] border-[1.5px] border-tan-mid bg-cream px-3 py-[7px] text-[13px] font-medium text-soot hover:border-ink"
              >
                ← 上一步
              </button>
            )}
            <button
              ref={nextBtnRef}
              type="button"
              onClick={next}
              title={
                isLast ? "完成引导，开始创作（Enter）" : "看下一条提示（Enter / →）"
              }
              className="cursor-pointer rounded-[10px] border-2 border-ink bg-poppy px-4 py-[7px] text-[13px] font-bold text-paper shadow-[3px_3px_0_#17130C] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#17130C]"
            >
              {isLast ? "知道了 ✓" : "下一步 →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
