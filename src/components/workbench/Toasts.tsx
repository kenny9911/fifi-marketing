"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Minimal state-based toast stack for the workbench: pop-collage cards
 * (ink border + hard shadow) pinned bottom-right, auto-dismiss after 5s.
 * No portal, no deps — the shell owns the state via useToasts().
 */

export type ToastTone = "error" | "success" | "info";

export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

const TONE_CLASS: Record<ToastTone, string> = {
  error: "bg-poppy text-paper",
  success: "bg-jade text-paper",
  info: "bg-sun text-ink",
};

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, tone: ToastTone = "error") => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, text, tone }]);
      window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-[min(340px,calc(100vw-48px))] flex-col gap-3"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 rounded-[14px] border-2 border-ink px-4 py-3 text-[13.5px] font-bold leading-[1.6] shadow-[4px_4px_0_#17130C] ${TONE_CLASS[t.tone]}`}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            title="关闭提示"
            className="cursor-pointer font-archivo text-[11px] leading-[1.8] opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
