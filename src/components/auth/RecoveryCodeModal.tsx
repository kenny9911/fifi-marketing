"use client";

import { useEffect, useRef, useState } from "react";
import { BurstStar } from "@/components/shared/BurstStar";

/**
 * The one-time recovery-code reveal: big mono code, copy button and an
 * explicit "I wrote it down" confirmation. Used after register (fresh code),
 * after reset (rotated code) and after an authenticated rotate in /settings.
 */
export function RecoveryCodeModal({
  code,
  title,
  message,
  confirmLabel,
  confirmPending,
  onConfirm,
}: {
  code: string;
  title: string;
  message: string;
  confirmLabel: string;
  confirmPending?: boolean;
  onConfirm: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时，恢复码本身可整段选中手动复制
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/70 px-4"
    >
      <div className="relative w-full max-w-[480px] rounded-[20px] border-2 border-ink bg-paper p-7 shadow-[10px_10px_0_#FF4B2E]">
        <BurstStar
          size={56}
          fill="#FFC53D"
          className="absolute -left-6 -top-6 -rotate-12"
        />
        <div className="mb-1 font-grotesk text-[11px] font-bold tracking-[2px] text-poppy">
          RECOVERY CODE
        </div>
        <h2 className="mb-2 font-display text-[26px] font-normal leading-[1.3]">
          {title}
        </h2>
        <p className="mb-4 text-[13.5px] leading-[1.8] text-soot">{message}</p>

        <div className="mb-3 select-all break-all rounded-[14px] border-2 border-ink bg-cream px-5 py-5 text-center font-mono text-[26px] font-bold tracking-[3px]">
          {code}
        </div>

        <div className="mb-5 flex items-start gap-2 rounded-[10px] border-[1.5px] border-ink bg-sun px-3.5 py-2.5 text-[12.5px] font-bold leading-[1.7]">
          <span aria-hidden>⚠️</span>
          <span>
            这是唯一一次显示 · 用于找回密码。请立即抄写或复制保存，丢失后将无法自助找回账号。
          </span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={copy}
            title="把恢复码复制到剪贴板"
            className="flex-1 cursor-pointer rounded-[14px] border-2 border-ink bg-paper px-5 py-3 text-[14.5px] font-bold shadow-[4px_4px_0_#2849F4]"
          >
            {copied ? "已复制 ✓" : "复制恢复码"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmPending}
            title="确认你已妥善保存恢复码"
            className="flex-1 cursor-pointer rounded-[14px] border-2 border-ink bg-poppy px-5 py-3 text-[14.5px] font-bold text-paper shadow-[4px_4px_0_#17130C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirmPending ? "请稍候…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
