import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/shared/LogoMark";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export const metadata: Metadata = {
  title: "设置 · 灰灰营销 FiFi",
  description: "管理你的资料、创作偏好与账号安全。",
};

/** Account settings: static topbar (server) + interactive panel (client). */
export default function SettingsPage() {
  return (
    <div className="min-h-dvh bg-cream">
      <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper">
        <div className="mx-auto flex max-w-[920px] items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5" title="回到首页">
            <LogoMark size={22} />
            <span className="font-display text-[21px] font-normal leading-none">
              灰灰营销
            </span>
            <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
              SETTINGS
            </span>
          </Link>
          <Link
            href="/studio"
            title="返回灰灰创作台"
            className="rounded-full border-[1.5px] border-ink bg-sun px-4 py-1.5 text-[13px] font-bold"
          >
            ← 返回创作台
          </Link>
        </div>
      </header>
      <SettingsPanel />
    </div>
  );
}
