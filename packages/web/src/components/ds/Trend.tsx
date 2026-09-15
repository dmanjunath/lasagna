import { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { HIDDEN_AMOUNT, isAmountsHidden, isMasked } from '../../lib/hide-amounts';
import { HiddenAmount } from '../uikit/HiddenAmount';

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
  isAmountsHidden()
    ? HIDDEN_AMOUNT
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function Trend({ value, label, invert, className }: TrendProps) {
  const good = invert ? value < 0 : value > 0;
  const neutral = value === 0;
  const rendered = label ?? fmt(Math.abs(value));
  // The arrow is a SIBLING of the value, so the mask span's own color cannot
  // neutralise it — it has to go separately while the amount is hidden.
  const masked = isMasked(rendered);
  const cls = neutral || masked ? 'ds-trend--neutral' : good ? 'ds-trend--pos' : 'ds-trend--neg';
  const arrow = neutral || masked ? '' : value > 0 ? '↑ ' : '↓ ';
  return (
    <span className={cn('ds-trend', cls, className)}>
      {arrow}{masked ? <HiddenAmount /> : rendered}
    </span>
  );
}
