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
  // Optional separator/marker (•• · ... … # * x X - ( ) and whitespace) then the mask, anchored to the end.
  const re = new RegExp('[\\s(]*(?:[•·]{1,2}|\\.{2,3}|…|[#*xX])?\\s*' + m + '[)\\s]*$');
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

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
