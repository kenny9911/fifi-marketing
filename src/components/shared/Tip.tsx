"use client";

import type { ReactNode } from "react";

/**
 * Pop-collage tooltip: ink bubble, paper text, hard offset shadow.
 * Pure CSS positioning — appears on hover AND keyboard focus (focus-within),
 * so every control wrapped in a Tip stays accessible.
 */
export function Tip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex max-w-full">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 z-[70] w-max max-w-[240px] -translate-x-1/2 rounded-[10px] border-[1.5px] border-paper/30 bg-ink px-3 py-[7px] text-center text-[12px] leading-[1.65] font-medium text-paper opacity-0 shadow-[3px_3px_0_rgba(23,19,12,0.25)] transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {tip}
        <span
          aria-hidden
          className="absolute top-full left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r-[1.5px] border-b-[1.5px] border-paper/30 bg-ink"
        />
      </span>
    </span>
  );
}
