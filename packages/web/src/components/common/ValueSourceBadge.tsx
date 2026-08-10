import { RefreshCw, Sparkles, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';

// ---------------------------------------------------------------------------
// Source-of-truth badge — names where an account's displayed value came from.
// Subtle, tinted, icon + label. Derived server-side (accounts.valueSource):
//   synced    — a Plaid-linked institution keeps it current
//   estimated — a latest "estimate" balance snapshot (address valuation)
//   manual    — the user typed the number in
// ---------------------------------------------------------------------------

export type ValueSource = 'synced' | 'estimated' | 'manual';

const CONFIG: Record<ValueSource, { label: string; className: string; Icon: typeof RefreshCw }> = {
  synced: {
    label: 'Synced',
    className: 'bg-positive-soft text-positive',
    Icon: RefreshCw,
  },
  estimated: {
    label: 'Estimated',
    className: 'bg-info-soft text-info',
    Icon: Sparkles,
  },
  manual: {
    label: 'You entered',
    className: 'bg-canvas-sunken text-content-secondary',
    Icon: Pencil,
  },
};

export function ValueSourceBadge({
  source,
  size = 'sm',
  className,
}: {
  source: ValueSource;
  /** `sm` for account rows; `md` for the detail hero. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { label, className: tint, Icon } = CONFIG[source];
  const iconSize = size === 'md' ? 12 : 10;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-bold',
        size === 'md' ? 'px-2.5 py-1 text-[11.5px]' : 'px-2 py-0.5 text-[11px]',
        tint,
        className,
      )}
    >
      <Icon size={iconSize} strokeWidth={2.2} aria-hidden="true" />
      {label}
    </span>
  );
}
