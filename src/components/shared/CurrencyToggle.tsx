"use client";

import { Tip } from "@/components/shared/Tip";
import { useCurrency, type Currency } from "@/components/hooks/useCurrency";

const OPTIONS: { id: Currency; label: string }[] = [
  { id: "USD", label: "$ USD" },
  { id: "CNY", label: "¥ CNY" },
];

/**
 * Two-segment cost-currency toggle (display-only conversion; ledger is USD).
 * variant "light" for paper/cream surfaces, "dark" for ink panels.
 */
export function CurrencyToggle({
  variant = "light",
}: {
  variant?: "light" | "dark";
}) {
  const { currency, setCurrency, money } = useCurrency();
  const dark = variant === "dark";

  return (
    <Tip tip={`成本显示货币切换 — ${money.rateLabel}；账本始终以 USD 记账`}>
      <div
        role="group"
        aria-label="成本显示货币"
        className={`inline-flex items-center overflow-hidden rounded-full border-[1.5px] ${
          dark ? "border-[rgba(255,253,247,.3)]" : "border-ink"
        }`}
      >
        {OPTIONS.map((o) => {
          const active = currency === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={active}
              onClick={() => setCurrency(o.id)}
              className={`cursor-pointer px-3 py-1 font-grotesk text-[11px] font-bold tracking-[1px] transition-colors ${
                active
                  ? dark
                    ? "bg-sun text-ink"
                    : "bg-ink text-paper"
                  : dark
                    ? "bg-transparent text-tan-dark hover:text-paper"
                    : "bg-paper text-soot hover:bg-cream"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </Tip>
  );
}
