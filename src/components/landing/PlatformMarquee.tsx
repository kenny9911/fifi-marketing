import { MARQUEE_NAMES } from "@/lib/platforms";

function MarqueeSequence({ decorative = false }: { decorative?: boolean }) {
  return (
    <div
      className="flex items-center"
      aria-hidden={decorative ? true : undefined}
    >
      {MARQUEE_NAMES.map((name) => (
        <span key={name} className="flex items-center">
          <span className="text-paper font-display text-2xl px-[22px] whitespace-nowrap">
            {name}
          </span>
          <span className="text-sun text-base">✦</span>
        </span>
      ))}
    </div>
  );
}

/** Ink band with the platform names scrolling in a seamless loop. */
export function PlatformMarquee() {
  return (
    <div className="bg-ink border-y-2 border-ink h-16 flex items-center overflow-hidden">
      <div className="flex items-center whitespace-nowrap animate-marquee">
        <MarqueeSequence />
        <MarqueeSequence decorative />
      </div>
    </div>
  );
}
