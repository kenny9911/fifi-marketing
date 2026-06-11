"use client";

import { useEffect, useRef, useState } from "react";
import { Tip } from "@/components/shared/Tip";
import type { ChatMessageDto, TaskStatus } from "@/lib/api-types";

function FiAvatar() {
  return (
    <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[12px_12px_12px_4px] bg-poppy font-archivo text-sm text-paper">
      Fi
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface TaskChatProps {
  messages: ChatMessageDto[];
  status: TaskStatus;
  onSend: (text: string) => void;
  sending: boolean;
}

/**
 * Chat history for a loaded task (user / 灰灰 / system bubbles) plus the
 * revision input: enabled when the task is done/reviewing (修改意见 →
 * targeted reedit), disabled with an explanatory Tip otherwise.
 */
export function TaskChat({ messages, status, onSend, sending }: TaskChatProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const revisable = status === "done" || status === "reviewing";
  const canSend = revisable && !sending;

  const sendTip = sending
    ? "发送中…"
    : revisable
      ? "提出修改意见，灰灰会派专家回炉重做对应内容"
      : status === "running"
        ? "专家团创作中，交付后即可在这里提出修改意见"
        : status === "briefing"
          ? "任务还没开始 — 点下方状态栏的「开始生成」派单给专家团"
          : status === "failed"
            ? "任务执行失败，无法继续对话 — 可在左侧新建任务重试"
            : "任务已取消 — 可在左侧新建任务重新开始";

  const placeholder = revisable
    ? "告诉灰灰要怎么改，专家团会回炉重做…"
    : status === "running"
      ? "专家团创作中…完成后可在这里提修改意见"
      : status === "briefing"
        ? "派单后，灰灰会在这里同步进展"
        : "任务已结束，新建任务继续创作";

  const handleSend = () => {
    const text = input.trim();
    if (!text || !canSend) return;
    setInput("");
    onSend(text);
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-paper">
      <div
        ref={listRef}
        className="scrollbar-chat flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-6"
      >
        {messages.length === 0 && (
          <div className="m-auto max-w-[340px] text-center">
            <div className="mx-auto flex h-[46px] w-[46px] items-center justify-center rounded-[14px_14px_14px_5px] bg-poppy font-archivo text-[16px] text-paper">
              Fi
            </div>
            <div className="mt-3 text-[14px] font-bold text-soot">
              这里还空空的
            </div>
            <p className="mt-1.5 text-[12.5px] leading-[1.8] text-stone">
              任务派单后，灰灰会在这里同步专家团的汇报；
              内容交付后，你可以在下方输入修改意见，专家团会回炉重做。
            </p>
          </div>
        )}

        {messages.map((m) =>
          m.role === "system" ? (
            <div key={m.id} className="flex justify-center">
              <span
                title={formatTime(m.createdAt)}
                className="max-w-[80%] truncate rounded-full border border-tan-mid bg-cream px-3.5 py-1 text-center font-grotesk text-[11px] font-bold tracking-[0.5px] text-stone"
              >
                {m.text}
              </span>
            </div>
          ) : m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div
                title={formatTime(m.createdAt)}
                className="max-w-[480px] whitespace-pre-wrap rounded-[16px_4px_16px_16px] bg-ink px-[18px] py-[13px] text-[14.5px] leading-[1.8] text-paper"
              >
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-3">
              <FiAvatar />
              <div
                title={formatTime(m.createdAt)}
                className="max-w-[560px] whitespace-pre-wrap rounded-[4px_16px_16px_16px] border-[1.5px] border-tan-light bg-cream px-[18px] py-[14px] text-[14.5px] leading-[1.8]"
              >
                {m.text}
              </div>
            </div>
          ),
        )}

        {sending && (
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

      {/* revision input */}
      <div className="shrink-0 border-t-2 border-ink bg-paper px-5 py-4">
        <div className="flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                handleSend();
              }
            }}
            disabled={!canSend}
            placeholder={placeholder}
            title={sendTip}
            className="min-w-0 flex-1 rounded-[14px] border-2 border-ink bg-paper px-[18px] py-[13px] text-[14.5px] outline-none disabled:border-tan-mid disabled:bg-cream disabled:text-stone"
          />
          <Tip tip={sendTip}>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend || !input.trim()}
              className={`h-full rounded-[14px] border-2 px-[22px] py-[13px] text-[14.5px] font-bold ${
                canSend && input.trim()
                  ? "cursor-pointer border-ink bg-poppy text-paper shadow-[4px_4px_0_#17130C]"
                  : "cursor-not-allowed border-tan-mid bg-cream text-stone"
              }`}
            >
              {sending ? "发送中…" : "发送 →"}
            </button>
          </Tip>
        </div>
      </div>
    </div>
  );
}
