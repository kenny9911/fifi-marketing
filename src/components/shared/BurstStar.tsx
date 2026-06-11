import type { CSSProperties } from "react";

/** Ten-point starburst used as a sticker motif throughout the design. */
export function BurstStar({
  size,
  fill,
  className,
  style,
}: {
  size: number;
  fill: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={style}
      aria-hidden
    >
      <polygon
        points="100,50 79,57.8 93.3,75 71.2,71.2 75,93.3 57.8,79 50,100 42.2,79 25,93.3 28.8,71.2 6.7,75 21,57.8 0,50 21,42.2 6.7,25 28.8,28.8 25,6.7 42.2,21 50,0 57.8,21 75,6.7 71.2,28.8 93.3,25 79,42.2"
        fill={fill}
      />
    </svg>
  );
}
