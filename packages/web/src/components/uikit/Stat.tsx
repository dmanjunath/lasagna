import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { isMasked } from '../../lib/hide-amounts';
import { HiddenAmount } from './HiddenAmount';

export type DeltaDirection = 'up' | 'down' | 'flat';

/** Delta — a +/- pill. Direction drives BOTH the arrow and the color, so the
 *  signal survives without color (the arrow + sign carry meaning too). */
export function Delta({
  value,
  direction,
  className,
}: {
  value: string;
  direction: DeltaDirection;
  className?: string;
}) {
  // A masked dollar delta drops its arrow and tone — both are siblings of the
  // value, so neither is covered by the mask span's own color. A percentage
  // delta is scale-invariant and stays exactly as it is.
  const masked = isMasked(value);
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const tone =
    masked || direction === 'flat'
      ? 'bg-canvas-sunken text-content-secondary'
      : direction === 'up'
        ? 'bg-positive-soft text-positive'
        : 'bg-negative-soft text-negative';
  return (
    <span
      className={cn(
        'ui-tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-none',
        tone,
        className,
      )}
    >
      {!masked && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {masked ? <HiddenAmount /> : value}
    </span>
  );
}

/**
 * Stat / KPI — an eyebrow label, a big tabular value, and an optional delta and
 * sub-caption. The value uses lining tabular numerals so money columns align.
 */
export function Stat({
  label,
  value,
  delta,
  deltaDirection = 'flat',
  caption,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: string;
  deltaDirection?: DeltaDirection;
  caption?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center gap-2">
        {icon && <span className="text-content-muted">{icon}</span>}
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-muted">
          {label}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2.5">
        <span className="ui-tnum text-[28px] font-semibold leading-none tracking-tight text-content">
          {isMasked(value) ? <HiddenAmount /> : value}
        </span>
        {delta && <Delta value={delta} direction={deltaDirection} />}
      </div>
      {caption && <p className="mt-1.5 text-[13px] text-content-muted">{caption}</p>}
    </div>
  );
}
