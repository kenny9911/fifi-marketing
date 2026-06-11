import type { Metadata } from "next";
import { BurstStar } from "@/components/shared/BurstStar";
import { LoginCard, type AuthTab } from "@/components/auth/LoginCard";

export const metadata: Metadata = {
  title: "登录 · 灰灰营销 FiFi",
  description: "登录或注册灰灰营销，让七位平台专家替你创作全网内容。",
};

/**
 * Public auth page: pop-collage backdrop + the interactive LoginCard.
 * Reads `?next=`(post-login destination, validated to be a same-site path)
 * and `?tab=`(login / register / forgot) from the URL.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const rawNext = typeof sp.next === "string" ? sp.next : undefined;
  // Only same-site paths — never absolute or protocol-relative URLs.
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : undefined;

  const rawTab = typeof sp.tab === "string" ? sp.tab : undefined;
  const initialTab: AuthTab =
    rawTab === "register" || rawTab === "forgot" ? rawTab : "login";

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-cream px-4 py-12">
      {/* pop-collage backdrop */}
      <div
        aria-hidden
        className="absolute -top-16 right-[8%] hidden h-[280px] w-[280px] rotate-[10deg] rounded-[36px] bg-sun sm:block"
      />
      <div
        aria-hidden
        className="absolute -bottom-20 left-[6%] hidden h-[240px] w-[240px] rounded-full bg-klein sm:block"
      />
      <div
        aria-hidden
        className="absolute bottom-[18%] right-[12%] hidden h-[110px] w-[110px] -rotate-[10deg] rounded-[0_50%_50%_50%] bg-jade sm:block"
      />
      <BurstStar
        size={92}
        fill="#FF4B2E"
        className="absolute left-[14%] top-[12%] hidden -rotate-12 sm:block"
      />
      <BurstStar
        size={56}
        fill="#FF7AB6"
        className="absolute bottom-[10%] right-[30%] hidden rotate-[18deg] sm:block"
      />
      <div className="absolute left-[10%] top-[58%] hidden -rotate-6 rounded-full border-2 border-ink bg-paper px-4 py-2 font-grotesk text-xs font-bold tracking-[1.5px] shadow-[4px_4px_0_#2849F4] lg:block">
        ONE BRIEF → EVERY PLATFORM
      </div>

      <LoginCard next={next} initialTab={initialTab} />
    </main>
  );
}
