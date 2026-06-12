"use client";

import Link from "next/link";
import { Tip } from "@/components/shared/Tip";
import { useCurrency } from "@/components/hooks/useCurrency";
import type { UsageTotals } from "@/lib/api-types";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Compact live cost pill (req 5): cost · tokens · calls, sun accent with a
 * pulsing dot while the pipeline runs. The trailing ⇄ button flips the cost
 * display between USD and CNY (display-only; the ledger stays in USD).
 * Tooltip breaks down prompt/completion tokens; clicking opens /usage.
 */
export function CostChip({
  usage,
  live,
}: {
  usage: UsageTotals | null;
  live: boolean;
}) {
  const { currency, toggle, money } = useCurrency();
  const cost = usage?.costUsd ?? 0;
  const tokens = (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
  const calls = usage?.calls ?? 0;
  const tip = usage
    ? `输入 ${fmt(usage.promptTokens)} tokens · 输出 ${fmt(usage.completionTokens)} tokens — 点击查看完整用量账本`
    : "任务开跑后这里实时累计本次成本 — 点击查看完整用量账本";
  const other = currency === "USD" ? "CNY" : "USD";

  return (
    <div
      className={`flex items-center overflow-hidden rounded-full border-[1.5px] bg-ink ${
        live ? "border-sun" : "border-[rgba(255,253,247,.28)]"
      }`}
    >
      <Tip tip={tip}>
        <Link href="/usage" className="flex items-center gap-2 py-1.5 pl-3.5 pr-2.5">
          {live && (
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sun" />
          )}
          <span
            className={`font-archivo text-[12.5px] leading-none ${
              live ? "text-sun" : "text-paper"
            }`}
          >
            {money.costShort(cost)}
          </span>
          <span className="text-[10px] leading-none text-stone">·</span>
          <span className="font-grotesk text-[10.5px] font-bold leading-none tracking-[1px] text-tan-dark">
            {fmt(tokens)} TOK
          </span>
          <span className="text-[10px] leading-none text-stone">·</span>
          <span className="font-grotesk text-[10.5px] font-bold leading-none tracking-[1px] text-tan-dark">
            {fmt(calls)} CALLS
          </span>
        </Link>
      </Tip>
      <Tip tip={`切换为 ${other} 显示 — ${money.rateLabel}`}>
        <button
          type="button"
          onClick={toggle}
          aria-label={`切换成本显示货币为 ${other}`}
          className="cursor-pointer self-stretch border-l border-[rgba(255,253,247,.22)] px-2.5 font-grotesk text-[10.5px] font-bold leading-none text-tan-dark transition-colors hover:bg-[rgba(255,253,247,.1)] hover:text-sun"
        >
          {currency === "USD" ? "¥" : "$"}⇄
        </button>
      </Tip>
    </div>
  );
}
