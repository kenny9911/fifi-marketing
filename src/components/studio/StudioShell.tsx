"use client";

import Link from "next/link";
import { LogoMark } from "@/components/shared/LogoMark";
import { BriefPanel } from "@/components/studio/BriefPanel";
import { ChatPanel } from "@/components/studio/ChatPanel";
import { ResultsPanel } from "@/components/studio/ResultsPanel";
import { useStudio } from "@/components/studio/useStudio";

/**
 * Full-viewport studio workspace: cream topbar + three-panel grid
 * (brief / chat / results). Owns the single useStudio() instance and
 * hands the same studio object to every panel. Panels scroll internally;
 * the page itself never scrolls on desktop.
 */
export function StudioShell() {
  const studio = useStudio();

  return (
    <div className="flex h-dvh flex-col bg-paper">
      {/* Topbar */}
      <header className="flex shrink-0 items-center justify-between border-b-2 border-ink bg-cream px-7 py-4">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <span className="font-display text-[21px] font-normal leading-none">
              灰灰创作台
            </span>
          </Link>
          <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
            STUDIO
          </span>
        </div>
        <div className="flex items-center gap-3.5">
          <span className="rounded-full border-[1.5px] border-ink bg-sun px-3 py-1 text-[12px] font-bold">
            交互演示 DEMO
          </span>
          <button
            type="button"
            onClick={() => studio.reset()}
            className="cursor-pointer rounded-full border-[1.5px] border-ink bg-paper px-4 py-1.5 text-[13px] font-bold"
          >
            ↺ 重新开始
          </button>
        </div>
      </header>

      {/* Workspace: brief | chat | results. Stacks below lg, where the
          workspace (not the document) scrolls vertically. */}
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[260px_1fr_420px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[280px_1fr_540px]">
        <div className="min-h-0 min-w-0 border-b-2 border-ink lg:overflow-y-auto lg:border-b-0">
          <BriefPanel studio={studio} />
        </div>
        <div className="h-[70dvh] min-h-0 min-w-0 overflow-hidden border-b-2 border-ink lg:h-auto lg:border-b-0">
          <ChatPanel studio={studio} />
        </div>
        <div className="h-[70dvh] min-h-0 min-w-0 overflow-hidden lg:h-auto">
          <ResultsPanel studio={studio} />
        </div>
      </main>
    </div>
  );
}
