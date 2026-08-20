import type { KeyboardEvent } from 'react';
import { RefreshCw, Sparkles, Pencil } from 'lucide-react';
import { cn, exactSyncTime } from '../../lib/utils';
import { Tooltip } from '../uikit';

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
  syncedAt,
  onActivate,
}: {
  source: ValueSource;
  /** `sm` for account rows; `md` for the detail hero. */
  size?: 'sm' | 'md';
  className?: string;
  /** ISO of the last sync — reveals the exact date+time on hover for synced badges. */
  syncedAt?: string;
  /**
   * When this badge sits inside a clickable row, pass the row's navigation
   * handler. The tooltip trigger swallows the row's bubbling click, so we run
   * it directly here (on click + Enter/Space) to keep the whole row clickable.
   * Leave undefined for standalone badges (hero, /accounts) — tooltip-only.
   */
  onActivate?: () => void;
}) {
  const { label, className: tint, Icon } = CONFIG[source];
  const iconSize = size === 'md' ? 12 : 10;
  const exact = source === 'synced' && syncedAt ? exactSyncTime(syncedAt) : null;
  const badge = (
    <span
      // When it carries a sync tooltip the badge is an interactive affordance:
      // make it keyboard-focusable (with the DS focus ring) and give it an
      // accessible name so the exact time reaches screen-reader users too.
      {...(exact
        ? { tabIndex: 0, 'aria-label': `Last synced ${exact}` }
        : {})}
      {...(exact && onActivate
        ? {
            onClick: onActivate,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivate();
              }
            },
          }
        : {})}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-bold',
        size === 'md' ? 'px-2.5 py-1 text-[11.5px]' : 'px-2 py-0.5 text-[11px]',
        exact && 'ui-focus',
        tint,
        className,
      )}
    >
      <Icon size={iconSize} strokeWidth={2.2} aria-hidden="true" />
      {label}
    </span>
  );
  return exact ? <Tooltip content={exact}>{badge}</Tooltip> : badge;
}
