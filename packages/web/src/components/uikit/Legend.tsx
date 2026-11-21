import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface LegendItem {
  key: string;
  label: ReactNode;
  /** Swatch fill, a token reference such as `var(--ui-viz-2)`. */
  color: string;
  /** Overrides on the default 11px square, e.g. a band, a line or a hatch. */
  swatchStyle?: CSSProperties;
}

/**
 * The chart legend: a swatch and a name per series, in one left-aligned row of
 * small muted text under the plot. Text stays in content ink, the swatch alone
 * carries the series colour. `children` render at the end of the row.
 */
export function Legend({
  items,
  className,
  style,
  children,
  'data-testid': testId,
}: {
  items: LegendItem[];
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] font-semibold text-content-muted ui-tnum', className)}
      style={style}
      data-testid={testId}
    >
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-[11px] w-[11px] shrink-0 rounded-[3.5px]"
            style={{ background: it.color, ...it.swatchStyle }}
          />
          {it.label}
        </span>
      ))}
      {children}
    </div>
  );
}
