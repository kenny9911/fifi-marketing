/** 灰灰营销 logo: red rounded square + blue circle, at three sizes. */
export function LogoMark({ size = 26 }: { size?: number }) {
  const radius = Math.round(size * 0.23);
  return (
    <div className="flex gap-[3px]" aria-hidden>
      <div
        className="bg-poppy"
        style={{ width: size, height: size, borderRadius: radius }}
      />
      <div
        className="bg-klein rounded-full"
        style={{ width: size, height: size }}
      />
    </div>
  );
}
