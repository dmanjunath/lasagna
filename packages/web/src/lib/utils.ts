import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { HIDDEN_AMOUNT, isAmountsHidden } from './hide-amounts';

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
  // "no value" stays distinguishable from "hidden", so the null check runs first.
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  if (isAmountsHidden()) return HIDDEN_AMOUNT;

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
 * A STORED DATE, printed as the calendar day it names.
 *
 * A transaction date, a goal deadline, a statement or maturity date, a payoff
 * or month bucket: all are `timestamp with time zone` columns holding midnight
 * UTC, so the value carries a calendar DATE, not a moment. Read in the viewer's
 * own zone it renders the day BEFORE anywhere west of UTC, which is how a
 * receipt reading "on Apr 16, 2026" ended up above a row reading "Apr 15", and
 * how a row on the 1st lands in the previous month's total. Formatted in UTC,
 * which is both how it is stored and how the server computes the windows these
 * dates are counted in.
 *
 * `timeZone` is forced AFTER the spread so a caller cannot reintroduce the bug.
 * Accepts a bare `YYYY-MM-DD` too, which `Date` already parses as UTC.
 *
 * Shared so a heading and the rows beneath it cannot disagree. Every surface
 * printing a stored date reads it from here. For a real moment — `createdAt`,
 * `lastSyncedAt`, an activity event — use `formatInstant` instead.
 */
export function formatStoredDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

/** A stored date as a day, e.g. "Apr 16". */
export function formatStoredDay(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return formatStoredDate(iso, { month: 'short', day: 'numeric', ...opts });
}

/** A stored date as the month it falls in, e.g. "Apr 2026". */
export function formatStoredMonth(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return formatStoredDate(iso, { month: 'short', year: 'numeric', ...opts });
}

/**
 * The same calendar day as a sortable `YYYY-MM-DD`, for grouping rows under one
 * heading and for comparing one against today.
 */
export function storedDayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/**
 * A real MOMENT, printed in the viewer's own zone — the deliberate opposite of
 * `formatStoredDate`. A row was created, a plan was generated, a sync ran: the
 * instant is what happened, so "2:14 PM" should mean 2:14 PM where the reader
 * sits. Passing no `timeZone` here is the sanctioned exception the lint guard
 * points at.
 */
export function formatInstant(value: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  return d.toLocaleString('en-US', opts);
}

/**
 * A real MOMENT reduced to the calendar day it happened on WHERE THE READER
 * SITS, as a `YYYY-MM-DD` key. The viewer-zone counterpart to `storedDayKey`,
 * which keys a stored date in UTC.
 *
 * Use it at the boundary where a series of instants becomes a day-labelled one
 * (a balance snapshot taken at 11pm local belongs on that evening, not on the
 * next day in UTC). Converting once here means every later reader gets a real
 * stored day, and the stored-date helpers name it correctly for everyone.
 */
export function localDayKey(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Exact calendar date + clock time for a sync timestamp, e.g.
 * "Aug 19, 2026, 2:14 PM". Used as the hover tooltip behind a relative
 * "synced 3h ago" label so the precise moment is one hover away. Returns null
 * for a falsy/invalid ISO so callers can skip the tooltip entirely.
 */
export function exactSyncTime(iso: string): string | null {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null;
  return formatInstant(iso, {
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
