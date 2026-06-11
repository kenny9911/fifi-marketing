import { SiteNav } from "@/components/landing/SiteNav";
import { Hero } from "@/components/landing/Hero";
import { PlatformMarquee } from "@/components/landing/PlatformMarquee";
import { ExpertsSection } from "@/components/landing/ExpertsSection";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Showcase } from "@/components/landing/Showcase";
import { StatsBand } from "@/components/landing/StatsBand";
import { CtaSection } from "@/components/landing/CtaSection";
import { SiteFooter } from "@/components/landing/SiteFooter";

export default function HomePage() {
  return (
    <main className="flex-1 bg-cream">
      <SiteNav />
      <Hero />
      <PlatformMarquee />
      <ExpertsSection />
      <HowItWorks />
      <Showcase />
      <StatsBand />
      <CtaSection />
      <SiteFooter />
    </main>
  );
}
