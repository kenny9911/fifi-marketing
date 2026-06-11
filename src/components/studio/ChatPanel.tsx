"use client";

import { useEffect, useRef } from "react";
import type { Studio } from "@/components/studio/useStudio";
import { CHIP_SETS, PLATFORMS, SAMPLE_GOALS } from "@/lib/platforms";
import type { ChatMessage } from "@/lib/types";

function FiAvatar() {
  return (
    <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[12px_12px_12px_4px] bg-poppy font-archivo text-sm text-paper">
      Fi
    </div>
  );
}

function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[4px_16px_16px_16px] border-[1.5px] border-tan-light bg-cream px-[18px] py-[14px] text-[14.5px] leading-[1.8]">
      {children}
    </div>
  );
}

function ChipRow({ message, studio }: { message: ChatMessage; studio: Studio }) {
  const set = message.chipSet;
  if (!set) return null;

  if (set === "platforms") {
    return (
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => {
          const selected = studio.selectedPlatforms.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={
                message.locked ? undefined : () => studio.togglePlatform(p.id)
              }
              className={`rounded-full border-[1.5px] px-[15px] py-[9px] text-[13.5px] font-medium ${
                selected ? "text-white" : "border-tan-mid bg-paper text-ink"
              } ${message.locked ? "cursor-default" : "cursor-pointer"}`}
              style={
                selected
                  ? { background: p.color, borderColor: p.color }
                  : message.locked
                    ? { opacity: 0.4 }
                    : undefined
              }
            >
              {p.name}
            </button>
          );
        })}
        {!message.locked && studio.selectedPlatforms.length > 0 && (
          <button
            type="button"
            onClick={studio.confirmPlatforms}
            className="cursor-pointer rounded-full border-[1.5px] border-ink bg-sun px-[18px] py-[9px] text-[13.5px] font-bold text-ink"
          >
            ✓ 就这些，继续
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {CHIP_SETS[set].map((label) => (
        <button
          key={label}
          type="button"
          onClick={
            message.locked ? undefined : () => studio.pickChip(set, label)
          }
          className={`rounded-full border-[1.5px] border-tan-mid bg-paper px-[15px] py-[9px] text-[13.5px] font-medium text-ink ${
            message.locked ? "cursor-default opacity-[0.45]" : "cursor-pointer"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ChatPanel({ studio }: { studio: Studio }) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [studio.messages, studio.typing]);

  const placeholder =
    studio.phase === "idle"
      ? "告诉灰灰你的目标，比如：下周上线冻干咖啡新品，想在小红书和抖音种草…"
      : studio.phase === "done"
        ? "继续对话微调内容…（Demo 到此为止）"
        : "点击上方选项继续，或重新开始";

  return (
    <div className="flex h-full min-w-0 flex-col bg-paper">
      <div
        ref={listRef}
        className="scrollbar-chat flex flex-1 flex-col gap-4 overflow-y-auto px-7 py-[26px]"
      >
        {/* welcome */}
        <div className="flex gap-3">
          <FiAvatar />
          <div className="max-w-[560px]">
            <AiBubble>
              你好，我是灰灰 👋
              说说这次的创作目标吧——要推什么、想达成什么？我会帮你补全简报，然后让专家团接单。
            </AiBubble>
          </div>
        </div>

        {studio.messages.map((m) => (
          <div key={m.id} className="flex flex-col gap-2.5">
            {m.role === "user" ? (
              <div className="flex justify-end">
                <div className="max-w-[480px] rounded-[16px_4px_16px_16px] bg-ink px-[18px] py-[13px] text-[14.5px] leading-[1.8] text-paper">
                  {m.text}
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <FiAvatar />
                <div className="flex max-w-[560px] flex-col gap-2.5">
                  <AiBubble>{m.text}</AiBubble>
                  <ChipRow message={m} studio={studio} />
                </div>
              </div>
            )}
          </div>
        ))}

        {studio.typing && (
          <div className="flex items-center gap-3">
            <FiAvatar />
            <div className="flex gap-[5px] rounded-[4px_16px_16px_16px] border-[1.5px] border-tan-light bg-cream px-[18px] py-4">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block h-[7px] w-[7px] animate-blink rounded-full bg-stone"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* input area */}
      <div className="border-t-2 border-ink bg-paper px-6 py-4">
        {studio.phase === "idle" && (
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="self-center text-[12.5px] text-stone">
              试试：
            </span>
            {SAMPLE_GOALS.map((goal) => (
              <button
                key={goal}
                type="button"
                onClick={() => studio.start(goal)}
                className="cursor-pointer rounded-full border-[1.5px] border-dashed border-tan-dark bg-cream px-[14px] py-2 text-[13px] text-soot"
              >
                {goal}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <input
            value={studio.input}
            onChange={(e) => studio.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") studio.start(studio.input);
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded-[14px] border-2 border-ink bg-paper px-[18px] py-[15px] text-[15px] outline-none"
          />
          <button
            type="button"
            onClick={() => studio.start(studio.input)}
            className="cursor-pointer rounded-[14px] border-2 border-ink bg-poppy px-[26px] text-[15px] font-bold text-paper shadow-[4px_4px_0_#17130C]"
          >
            发送 →
          </button>
        </div>
      </div>
    </div>
  );
}
