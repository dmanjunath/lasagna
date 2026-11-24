import { useId } from 'react';

/**
 * How full a savings goal is, as the native app's jar (packages/mobile
 * src/ui/Progress.tsx): a lid, a rounded body in the jar color and the fill
 * rising with a soft wave. Shown where the design's progress skin is `jar`.
 * Decorative: the caller states the percent in text.
 */
export function Jar({ pct, fill, width = 42 }: { pct: number; fill: string; width?: number }) {
  const clip = useId();
  const p = Math.max(0, Math.min(100, pct)) / 100;
  // The body runs from y 12 to 78 in a 64 by 80 box.
  const top = 78 - 66 * p;
  return (
    <svg width={width} height={(width * 80) / 64} viewBox="0 0 64 80" aria-hidden className="shrink-0">
      <defs>
        <clipPath id={clip}>
          <rect x={6} y={12} width={52} height={66} rx={14} />
        </clipPath>
      </defs>
      <rect x={12} y={2} width={40} height={9} rx={3} style={{ fill: 'var(--ui-line-strong)' }} />
      <rect x={6} y={12} width={52} height={66} rx={14} style={{ fill: 'rgb(var(--ui-jar))' }} />
      {p > 0 ? <path d={`M6 ${top} Q32 ${top - 6} 58 ${top} V80 H6 Z`} style={{ fill }} clipPath={`url(#${clip})`} /> : null}
    </svg>
  );
}
