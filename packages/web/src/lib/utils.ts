import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strip a trailing account-number mask from a display name so it isn't shown
 * twice (some institutions name accounts like "Plaid Checking ••1234" while we
 * also render the mask separately). Only strips when the trailing digits match
 * the account's actual `mask`, and never returns an empty string.
 */
export function stripAccountMask(name: string, mask?: string | null): string {
  if (!mask) return name;
  const m = mask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Optional separator/marker (•• · ... … # * x X dashes ( ) and whitespace) then
  // the mask, anchored to the end. Markers may repeat (e.g. "****4242") so the
  // whole masked suffix is stripped, not just one glyph.
  const re = new RegExp('[\\s(–—-]*(?:[•·]{1,4}|\\.{2,4}|…|[#*xX]{1,4})?\\s*' + m + '[)\\s]*$');
  if (!re.test(name)) return name;
  const stripped = name.replace(re, '').trim();
  return stripped.length >= 2 ? stripped : name;
}

export function formatMoney(value: number | string | null, compact = false): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  }).format(num);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Exact local calendar date + clock time for a sync timestamp, e.g.
 * "Aug 19, 2026, 2:14 PM". Used as the hover tooltip behind a relative
 * "synced 3h ago" label so the precise moment is one hover away. Uses the
 * browser's locale (undefined) and returns null for a falsy/invalid ISO so
 * callers can skip the tooltip entirely.
 */
export function exactSyncTime(iso: string): string | null {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null;
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  // A bare "Dec 26" reads as this year, so a date from another year can read as
  // months in the FUTURE. Carry the year whenever the year is not this one.
  if (date.getFullYear() !== now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Split model prose into paragraphs on paragraph breaks. Handles both real
 * newlines AND the literal two-character "\n" sequence the model sometimes
 * emits as text (which would otherwise print verbatim, e.g. "robust pace.\n\nThe...").
 */
export function splitParagraphs(body: string): string[] {
  return body
    .replace(/\\n/g, '\n')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}
