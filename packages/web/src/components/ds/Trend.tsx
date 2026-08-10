import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface TrendProps {
  /** Signed number. Positive = up. */
  value: number;
  /** Optional override for the rendered label */
  label?: ReactNode;
  /** Invert color logic (e.g. for expenses where down is good) */
  invert?: boolean;
  className?: string;
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function Trend({ value, label, invert, className }: TrendProps) {
  const good = invert ? value < 0 : value > 0;
  const neutral = value === 0;
  const cls = neutral ? 'ds-trend--neutral' : good ? 'ds-trend--pos' : 'ds-trend--neg';
  const arrow = neutral ? '·' : value > 0 ? '↑' : '↓';
  return (
    <span className={cn('ds-trend', cls, className)}>
      {arrow} {label ?? fmt(Math.abs(value))}
    </span>
  );
}
