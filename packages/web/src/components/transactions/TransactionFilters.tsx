import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Link } from 'wouter';
import { OptionMenu, PANEL_CLASS } from '../common/OptionMenu';
import type { TxnQueryBody } from '../../lib/api';
import type { AccountIndexEntry } from '../../lib/use-accounts-index';
import { Badge, SegmentedControl, button } from '../uikit';
import { cn, formatStoredDay, formatStoredMonth } from '../../lib/utils';
import { AccountPicker } from '../common/AccountPicker';
import { CategoryMultiSelect, scopeChipProps, useCategoryChips } from '../common/CategoryMultiSelect';
import { MerchantPicker, StatusFields, StatusPicker, ViewsPicker } from './FilterPickers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Any (no filter), only those, or hide them. */
export type TriState = 'any' | 'only' | 'hide';
/** What a row is: money in and out leave transfers out (the Spending rule), so the numbers agree everywhere. */
export type TxnKind = 'all' | 'in' | 'out' | 'transfer';

export interface TxnFilters {
  search: string;
  /** Exact merchants, as the rows show them. Picked in the Merchant list or by clicking a row's merchant. */
  merchants: string[];
  categories: string[];
  /** Category ids to drop. Arrives from a /spending exclude scope. */
  excludeCategories: string[];
  accountIds: string[];
  datePreset: 'all' | 'this-month' | 'last-month' | 'last-3-months' | 'ytd' | 'custom';
  customStart: string;   // 'YYYY-MM-DD' or ''
  customEnd: string;
  amountOp: 'any' | 'atLeast' | 'atMost' | 'between';
  amountMin: string;     // raw input; '' = unset
  amountMax: string;
  kind: TxnKind;
  pending: TriState;
  /** Rows excluded from totals. */
  excluded: TriState;
  recurring: TriState;
  /** Added by the bank (Plaid) or by you. */
  source: 'any' | 'bank' | 'manual';
}

export const EMPTY_FILTERS: TxnFilters = {
  search: '',
  merchants: [],
  categories: [],
  excludeCategories: [],
  accountIds: [],
  datePreset: 'all',
  customStart: '',
  customEnd: '',
  amountOp: 'any',
  amountMin: '',
  amountMax: '',
  kind: 'all',
  pending: 'any',
  excluded: 'any',
  recurring: 'any',
  source: 'any',
};

/** The kind control's labels, the same words as the app and Spending. */
export const KIND_LABELS: Record<TxnKind, string> = {
  all: 'All',
  in: 'Money in',
  out: 'Money out',
  transfer: 'Transfers',
};

/** The status filters, in the order the panel lists them. */
export const STATUS_FIELDS = [
  { key: 'pending', label: 'Pending', only: 'Pending only', hide: 'Hide pending' },
  { key: 'excluded', label: 'Excluded from totals', only: 'Excluded only', hide: 'Hide excluded' },
  { key: 'recurring', label: 'Recurring', only: 'Recurring only', hide: 'Hide recurring' },
] as const;

type StatusKey = 'pending' | 'excluded' | 'recurring' | 'source';

/** Each status filter that is set, as its chip reads ("Pending only", "Added by you"). */
export function statusChipLabels(f: TxnFilters): Array<{ key: StatusKey; label: string }> {
  const out: Array<{ key: StatusKey; label: string }> = [];
  for (const s of STATUS_FIELDS) {
    const v = f[s.key];
    if (v !== 'any') out.push({ key: s.key, label: v === 'only' ? s.only : s.hide });
  }
  if (f.source !== 'any') out.push({ key: 'source', label: f.source === 'bank' ? 'Added by bank' : 'Added by you' });
  return out;
}

const statusSet = (f: TxnFilters) =>
  f.pending !== 'any' || f.excluded !== 'any' || f.recurring !== 'any' || f.source !== 'any';

// ---------------------------------------------------------------------------
// filtersToQuery — converts UI filter state to TxnQueryBody['filters'].
// ---------------------------------------------------------------------------

export function amountRangeInverted(f: TxnFilters): boolean {
  return f.amountOp === 'between' && f.amountMin !== '' && f.amountMax !== '' && Number(f.amountMin) > Number(f.amountMax);
}

/** From after To. Ignored until fixed, the same way an inverted amount is. */
export function dateRangeInverted(f: TxnFilters): boolean {
  return f.datePreset === 'custom' && f.customStart !== '' && f.customEnd !== '' && f.customStart > f.customEnd;
}

// "Custom range" with no dates typed yet filters nothing, so it isn't counted
// or chipped until a date is entered. Nor is a backwards one.
function isDateActive(f: TxnFilters): boolean {
  if (dateRangeInverted(f)) return false;
  return f.datePreset !== 'all' && (f.datePreset !== 'custom' || !!f.customStart || !!f.customEnd);
}

/** Any filter the Filters panel holds is narrowing the list (search lives
 *  outside it). Drives the dot on the phone's top-bar Filters button. */
export function hasPanelFilters(f: TxnFilters): boolean {
  return (
    f.categories.length > 0 ||
    f.excludeCategories.length > 0 ||
    f.accountIds.length > 0 ||
    f.merchants.length > 0 ||
    isDateActive(f) ||
    ((f.amountMin !== '' || f.amountMax !== '') && !amountRangeInverted(f)) ||
    statusSet(f)
  );
}

export function filtersToQuery(f: TxnFilters, now: Date = new Date()): TxnQueryBody['filters'] {
  const result: TxnQueryBody['filters'] = {};

  const search = f.search.trim();
  if (search) result.search = search;
  if (f.merchants.length > 0) result.merchants = f.merchants;
  if (f.categories.length > 0) result.categories = f.categories;
  if (f.excludeCategories.length > 0) result.excludeCategories = f.excludeCategories;
  if (f.accountIds.length > 0) result.accountIds = f.accountIds;

  // Date presets
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Open-ended presets (this-month, last-3-months, ytd) omit endDate so the
  // API uses "now" server-side, avoiding inverted ranges for users east of UTC
  // on month boundaries where a local-date start could exceed an ISO "now" end.
  switch (f.datePreset) {
    case 'this-month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      result.startDate = fmt(start);
      break;
    }
    case 'last-month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      result.startDate = fmt(start);
      result.endDate = `${fmt(end)}T23:59:59`;
      break;
    }
    case 'last-3-months': {
      const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      result.startDate = fmt(start);
      break;
    }
    case 'ytd': {
      const start = new Date(now.getFullYear(), 0, 1);
      result.startDate = fmt(start);
      break;
    }
    case 'custom': {
      if (dateRangeInverted(f)) break;
      if (f.customStart) result.startDate = f.customStart;
      if (f.customEnd) result.endDate = `${f.customEnd}T23:59:59`;
      break;
    }
  }

  // A range whose min is above its max matches nothing, so it is left out
  // until fixed. The Amount field says "Min is more than max." meanwhile.
  if (!amountRangeInverted(f)) {
    const min = parseFloat(f.amountMin);
    if (!isNaN(min) && (f.amountOp === 'atLeast' || f.amountOp === 'between')) result.amountMin = min;
    const max = parseFloat(f.amountMax);
    if (!isNaN(max) && (f.amountOp === 'atMost' || f.amountOp === 'between')) result.amountMax = max;
  }
  if (f.kind !== 'all') result.kind = f.kind;
  for (const s of STATUS_FIELDS) if (f[s.key] !== 'any') result[s.key] = f[s.key] === 'only';
  if (f.source !== 'any') result.source = f.source;

  return result;
}

// ---------------------------------------------------------------------------
// URL <-> filters. The parameter names are the ones filtersToQuery already
// emits (search, categories, startDate, endDate), so a caller that scopes a
// drill-in and the address bar the user ends up with speak the same language.
// ---------------------------------------------------------------------------

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// startDate/endDate may carry a time (filtersToQuery appends T23:59:59 to the
// end). Keep the day, drop anything that isn't a real YYYY-MM-DD.
function isoDay(raw: string | null): string {
  if (!raw) return '';
  const day = raw.slice(0, 10);
  return ISO_DAY.test(day) ? day : '';
}

// The reading half of filtersToQuery: rebuilds filter state from a URL query
// string. A date range arrives as a custom range, since the presets are
// relative to "now" and a caller means the exact span it computed.
export function filtersFromQuery(queryString: string): TxnFilters {
  const params = new URLSearchParams(queryString);
  const filters: TxnFilters = { ...EMPTY_FILTERS };

  const search = params.get('search')?.trim();
  if (search) filters.search = search;

  // Repeated, one name per param: a merchant name can hold a comma.
  const merchants = params.getAll('merchant').filter(Boolean);
  if (merchants.length > 0) filters.merchants = [...new Set(merchants)];

  const categories = params.get('categories');
  if (categories) filters.categories = categories.split(',').filter(Boolean);

  const excludeCategories = params.get('excludeCategories');
  if (excludeCategories) filters.excludeCategories = excludeCategories.split(',').filter(Boolean);

  const accountIds = params.get('accountIds');
  if (accountIds) filters.accountIds = accountIds.split(',').filter(Boolean);

  const kind = params.get('kind');
  if (kind === 'in' || kind === 'out' || kind === 'transfer') filters.kind = kind;
  else {
    // Older links: direction=credit|debit, read as money in / money out.
    const direction = params.get('direction');
    if (direction === 'credit') filters.kind = 'in';
    if (direction === 'debit') filters.kind = 'out';
  }
  for (const s of STATUS_FIELDS) {
    const v = params.get(s.key);
    if (v === 'only' || v === 'hide') filters[s.key] = v;
  }
  const source = params.get('source');
  if (source === 'bank' || source === 'manual') filters.source = source;

  const amountOp = params.get('amountOp');
  if (amountOp === 'atLeast' || amountOp === 'atMost' || amountOp === 'between') {
    filters.amountOp = amountOp;
    filters.amountMin = params.get('amountMin') ?? '';
    filters.amountMax = params.get('amountMax') ?? '';
  }

  // A relative preset travels by name, so a reload or a saved view keeps
  // "Last month" meaning last month, not the span it was on the day it was saved.
  const preset = params.get('datePreset');
  if (preset === 'this-month' || preset === 'last-month' || preset === 'last-3-months' || preset === 'ytd') {
    filters.datePreset = preset;
    return filters;
  }

  const start = isoDay(params.get('startDate'));
  const end = isoDay(params.get('endDate'));
  if (start || end) {
    filters.datePreset = 'custom';
    filters.customStart = start;
    filters.customEnd = end;
  }

  return filters;
}

// The writing half: the query string that filtersFromQuery reads back to these
// same filters. Commas stay literal so the emitted URL matches the shape a
// drill-in builds by hand.
export function filtersToSearchParams(f: TxnFilters): string {
  const parts: string[] = [];
  const search = f.search.trim();
  if (search) parts.push(`search=${encodeURIComponent(search)}`);
  for (const m of f.merchants) parts.push(`merchant=${encodeURIComponent(m)}`);
  if (f.categories.length > 0) {
    parts.push(`categories=${f.categories.map(encodeURIComponent).join(',')}`);
  }
  if (f.excludeCategories.length > 0) {
    parts.push(`excludeCategories=${f.excludeCategories.map(encodeURIComponent).join(',')}`);
  }
  if (f.accountIds.length > 0) {
    parts.push(`accountIds=${f.accountIds.map(encodeURIComponent).join(',')}`);
  }
  if (f.kind !== 'all') parts.push(`kind=${f.kind}`);
  for (const s of STATUS_FIELDS) if (f[s.key] !== 'any') parts.push(`${s.key}=${f[s.key]}`);
  if (f.source !== 'any') parts.push(`source=${f.source}`);
  if (f.amountOp !== 'any') {
    parts.push(`amountOp=${f.amountOp}`);
    if (f.amountMin && f.amountOp !== 'atMost') parts.push(`amountMin=${encodeURIComponent(f.amountMin)}`);
    if (f.amountMax && f.amountOp !== 'atLeast') parts.push(`amountMax=${encodeURIComponent(f.amountMax)}`);
  }
  if (f.datePreset !== 'all' && f.datePreset !== 'custom') parts.push(`datePreset=${f.datePreset}`);
  if (f.datePreset === 'custom') {
    if (f.customStart) parts.push(`startDate=${f.customStart}`);
    if (f.customEnd) parts.push(`endDate=${f.customEnd}`);
  }
  return parts.join('&');
}

/**
 * The /transactions URL another page hands a scope over in: the window a figure
 * was counted over, plus the category scope it was counted under.
 *
 * `startDate`/`endDate` are passed in as the caller already holds them — the
 * SAME strings it sent to the endpoint that produced the figure — so the landed
 * window cannot be a second, separately-derived one that disagrees. The day is
 * all the URL carries; the page re-appends its own end-of-day stamp.
 *
 * Built through filtersToSearchParams rather than by hand so the parameter
 * order matches what the page writes back on mount, and so a field added to the
 * scope later is carried by construction.
 */
export function transactionsHref(scope: {
  startDate: string;
  endDate: string;
  categories?: string[];
  excludeCategories?: string[];
  kind?: TxnKind;
}): string {
  const query = filtersToSearchParams({
    ...EMPTY_FILTERS,
    kind: scope.kind ?? 'all',
    categories: scope.categories ?? [],
    excludeCategories: scope.excludeCategories ?? [],
    datePreset: 'custom',
    customStart: scope.startDate.slice(0, 10),
    customEnd: scope.endDate.slice(0, 10),
  });
  return query ? `/transactions?${query}` : '/transactions';
}

// "July 2026" when a custom range covers exactly one calendar month, so a drill
// that promised a month visibly lands on it. Anything else returns null.
export function wholeMonthLabel(start: string, end: string): string | null {
  const a = ISO_DAY.exec(start);
  const b = ISO_DAY.exec(end);
  if (!a || !b) return null;
  if (a[1] !== b[1] || a[2] !== b[2]) return null;
  if (a[3] !== '01') return null;
  const year = Number(a[1]);
  const month = Number(a[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(year, month, 0).getDate();
  if (Number(b[3]) !== lastDay) return null;
  return formatStoredMonth(start, { month: 'long' });
}

// "2026" when a custom range covers exactly one calendar year. The year drill
// is the month drill's sibling — /spending hands over Jan 1 to Dec 31 from its
// Year mode — so its chip has to name the period the same way, not spell out
// the two endpoints the month case is spared.
export function wholeYearLabel(start: string, end: string): string | null {
  const a = ISO_DAY.exec(start);
  const b = ISO_DAY.exec(end);
  if (!a || !b) return null;
  if (a[1] !== b[1]) return null;
  if (a[2] !== '01' || a[3] !== '01') return null;
  if (b[2] !== '12' || b[3] !== '31') return null;
  return a[1];
}

/**
 * "Jan 1 to Aug 31, 2026" — the range a custom scope actually covers.
 *
 * The fallback for every span that is not one whole calendar month. The chip
 * used to read "Custom dates", which told the reader nothing and sat directly
 * above a tile printing the real range, so the page stated the same scope twice
 * and only one of the two was worth reading. The year is printed once where both
 * ends share it.
 */
export function dateRangeLabel(start: string, end: string): string | null {
  const a = ISO_DAY.test(start) ? start : null;
  const b = ISO_DAY.test(end) ? end : null;
  const full = { month: 'short', day: 'numeric', year: 'numeric' } as const;
  if (a && b) {
    if (a === b) return formatStoredDay(a, full);
    const from = a.slice(0, 4) === b.slice(0, 4) ? formatStoredDay(a) : formatStoredDay(a, full);
    return `${from} to ${formatStoredDay(b, full)}`;
  }
  if (a) return `From ${formatStoredDay(a, full)}`;
  if (b) return `Through ${formatStoredDay(b, full)}`;
  return null;
}


// ---------------------------------------------------------------------------
// ChipBadge — one removable scope chip. Shared by this page's chip row and by
// /spending's scope row, which kept a byte-identical copy that had already
// drifted (a generic remove label, a different gap). One copy, one behaviour.
// ---------------------------------------------------------------------------

export function ChipBadge({
  label,
  tone,
  removeLabel,
  href,
  onClear,
}: {
  label: string;
  tone?: 'brand' | 'neutral';
  /** A page for the filtered thing, linked from inside the chip. */
  href?: string;
  /** Overrides the default "Remove X filter" accessible name. */
  removeLabel?: string;
  onClear: () => void;
}) {
  return (
    <Badge tone={tone ?? 'neutral'} className="pr-2">
      {/* An unresolvable-but-well-formed category id is labelled with the id
           itself (a shared link is never rewritten), and 36 characters ran past
           a 390px screen, carrying the × off the edge with it. */}
      <span className="max-w-[16rem] truncate" title={label}>{label}</span>
      {href && (
        <Link
          href={href}
          className="ui-focus touch-target-inline ml-1.5 rounded-ui-xs font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
        >
          View
        </Link>
      )}
      <button
        type="button"
        onClick={onClear}
        aria-label={removeLabel ?? `Remove ${label} filter`}
        className="ui-focus group relative inline-flex items-center justify-center rounded-full px-1 max-sm:before:absolute max-sm:before:-inset-x-2 max-sm:before:-inset-y-3 max-sm:before:content-['']"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full transition-colors group-hover:bg-content/10">
          <X size={12} />
        </span>
      </button>
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// TransactionFilters — one toolbar row: [search] [Date] [Filters] [trailing],
// plus the active-filter chips row beneath. On phones the Filters trigger is in
// the page's top bar (`filtersOpen`) and Date lives in that panel. Debounce ONLY the search
// input; all other controls call onChange immediately.
// ---------------------------------------------------------------------------

export function TransactionFilters({
  filters,
  onChange,
  accounts,
  trailing,
  hideControls,
  filtersOpen,
  onFiltersOpenChange,
}: {
  filters: TxnFilters;
  onChange: (f: TxnFilters) => void;
  accounts: AccountIndexEntry[];
  /** Rendered at the end of the toolbar row on wider screens (the page's sort). */
  trailing?: React.ReactNode;
  /** From sm up, hide the search row and keep only the chips (the page's bulk bar takes its place). */
  hideControls?: boolean;
  /** The phone's combined panel of every filter. Its trigger is in the top
   *  bar, marked `data-filters-trigger` so a tap on it isn't an outside tap. */
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
}) {
  const [searchInput, setSearchInput] = useState(filters.search);
  // 'all' = the phone's Filters panel, every filter. 'more' = the wider
  // toolbar's, opened from its Filters button: all but Date, which sits beside it.
  const [moreOpen, setMoreOpen] = useState(false);
  const openPanel: 'all' | 'more' | null = filtersOpen ? 'all' : moreOpen ? 'more' : null;
  const setOpenPanel = (v: 'all' | 'more' | null) => {
    setMoreOpen(v === 'more');
    onFiltersOpenChange(v === 'all');
  };
  const panelOpen = openPanel !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  // The panel hangs off a sticky toolbar, so the page can't scroll it into
  // view: cap it at the space left below its top edge and let it scroll inside,
  // so every section (Saved views last) is reachable on a phone or a short window.
  const [panelMaxH, setPanelMaxH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!panelOpen) return;
    const fit = () => {
      const el = panelRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setPanelMaxH(Math.max(200, Math.floor(window.innerHeight - top - 12)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [panelOpen]);

  // Keep a ref to the latest filters/onChange so the debounce closure isn't stale.
  const filtersRef = useRef(filters);
  const onChangeRef = useRef(onChange);
  useEffect(() => { filtersRef.current = filters; });
  useEffect(() => { onChangeRef.current = onChange; });

  // Sync external search changes (e.g., "Clear all") back into local input.
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  // Debounce: fire onChange 300ms after the user stops typing.
  useEffect(() => {
    const trimmed = searchInput.trim();
    const timer = setTimeout(() => {
      const f = filtersRef.current;
      if (trimmed !== f.search) {
        onChangeRef.current({ ...f, search: trimmed });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the filters popover on outside-click or Escape.
  useEffect(() => {
    if (!panelOpen) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || moreBtnRef.current?.contains(t)) return;
      // A picker's phone sheet portals outside the panel. A tap in it is still
      // a tap inside the panel's job. The top bar's trigger toggles the panel
      // itself.
      if ((t as Element).closest?.('[data-sheet], [data-filters-trigger]')) return;
      setOpenPanel(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (openPanel === 'more') moreBtnRef.current?.focus();
        setOpenPanel(null);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fully-selected groups collapse to one unit, so the trigger label, the
  // Filters badge, and the chips all agree on how a group selection is counted.
  const { chips: categoryChips, count: categoryCount } = useCategoryChips(
    filters.categories,
    (cats) => onChange({ ...filters, categories: cats }),
  );
  // An exclude scope has no authoring control here — it arrives from /spending.
  // It still gets chips, so the reader can see what the rows are missing and
  // drop the scope, the way an arrived date range already works.
  const { chips: excludeChips, count: excludeCount } = useCategoryChips(
    filters.excludeCategories,
    (cats) => onChange({ ...filters, excludeCategories: cats }),
  );
  // Both scopes name their mode per chip (scopeChipProps). Its own key prefix
  // keeps an excluded id distinct from the same id in the include list.
  const excludeChipItems = excludeChips.map((cat) => ({
    key: `ex-${cat.key}`,
    ...scopeChipProps('exclude', cat),
    clear: cat.remove,
  }));
  // Names shared by 2+ accounts — their chips get a ••mask suffix.
  const nameCounts = new Map<string, number>();
  for (const a of accounts) nameCounts.set(a.name, (nameCounts.get(a.name) ?? 0) + 1);

  const dateActive = isDateActive(filters);

  // Build active chips.
  type Chip = {
    key: string;
    label: string;
    clear: () => void;
    tone?: 'brand' | 'neutral';
    removeLabel?: string;
    /** A page for the filtered thing, linked from inside the chip. */
    href?: string;
  };
  const chips: Chip[] = [];

  // No chip for the search: the box above shows it, with its own clear button.
  for (const m of filters.merchants) {
    chips.push({
      key: `merchant-${m}`,
      label: m,
      removeLabel: `Remove merchant ${m}`,
      clear: () => onChange({ ...filters, merchants: filters.merchants.filter((x) => x !== m) }),
    });
  }
  // A fully-selected group is one chip; leftover loose categories get their own.
  // Brand-tone both so a drill-in from Spending reads as "you're scoped here",
  // distinct from search/account chips.
  for (const cat of categoryChips) {
    chips.push({ key: cat.key, ...scopeChipProps('include', cat), clear: cat.remove });
  }
  chips.push(...excludeChipItems);
  for (const accId of filters.accountIds) {
    const acc = accounts.find((a) => a.id === accId);
    const ambiguous = acc && (nameCounts.get(acc.name) ?? 0) > 1;
    const label = acc
      ? ambiguous && acc.mask ? `${acc.name} ••${acc.mask}` : acc.name
      : accId;
    chips.push({
      key: `acc-${accId}`,
      label,
      href: acc ? `/accounts/${accId}` : undefined,
      clear: () => onChange({ ...filters, accountIds: filters.accountIds.filter((id) => id !== accId) }),
    });
  }
  if (dateActive) {
    const presetLabels: Record<string, string> = {
      'this-month': 'This month',
      'last-month': 'Last month',
      'last-3-months': 'Last 3 months',
      'ytd': 'Year to date',
      'custom': 'Custom dates',
    };
    // The month it landed on where the span is exactly one, the span itself
    // otherwise. "Custom dates" is only left for a custom preset with no dates
    // entered yet, where there is no range to name.
    const spanLabel =
      filters.datePreset === 'custom'
        ? wholeMonthLabel(filters.customStart, filters.customEnd) ??
          wholeYearLabel(filters.customStart, filters.customEnd) ??
          dateRangeLabel(filters.customStart, filters.customEnd)
        : null;
    chips.push({
      key: 'date',
      label: spanLabel ?? presetLabels[filters.datePreset] ?? filters.datePreset,
      clear: () => onChange({ ...filters, datePreset: 'all', customStart: '', customEnd: '' }),
    });
  }
  if ((filters.amountMin || filters.amountMax) && !amountRangeInverted(filters)) {
    const label = filters.amountMin && filters.amountMax
      ? `$${filters.amountMin} to $${filters.amountMax}`
      : filters.amountMin
        ? `≥$${filters.amountMin}`
        : `≤$${filters.amountMax}`;
    chips.push({
      key: 'amount',
      label,
      clear: () => onChange({ ...filters, amountOp: 'any', amountMin: '', amountMax: '' }),
    });
  }
  for (const st of statusChipLabels(filters)) {
    chips.push({
      key: `status-${st.key}`,
      label: st.label,
      clear: () => onChange({ ...filters, [st.key]: 'any' }),
    });
  }

  const sectionLabel = 'mb-1.5 text-[12px] font-semibold text-content-secondary';
  // An exclude scope arrives from /spending and has no control of its own here,
  // so without this caption the picker reads "All categories" while a category
  // is dropped, and the Filters badge counts a filter the open panel never
  // shows. It is a caption rather than a second run of chips: the row below
  // already carries those, and on a wide screen both are on screen at once.
  const excludeCaptionId = 'txn-filters-excluded';

  const amountChip = chips.find((c) => c.key === 'amount');
  // The uikit field box, matching the menus above them in the panel.
  const inputClass = 'ui-focus h-11 min-h-touch w-full rounded-ui-md border border-line-strong bg-panel px-3.5 text-sm text-content shadow-ui-sm';

  // A labelled From row over a To row in one field box, the way iOS lays out
  // a date range. Side by side, two bare dates at 390px read as one
  // unlabelled pair, and iOS centres a date field's text whatever its padding.
  // The input fills its row, so a tap anywhere on it opens the picker.
  const dateRow = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex h-11 min-h-touch items-center gap-3 pl-3.5 pr-3">
      <span className="w-10 shrink-0 text-[13px] font-medium text-content-secondary">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => set(e.target.value)}
        className="h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-right text-sm text-content outline-none [&::-webkit-date-and-time-value]:text-right [&::-webkit-calendar-picker-indicator]:opacity-60"
      />
    </label>
  );
  const datesInverted = dateRangeInverted(filters);
  const customDateInputs = filters.datePreset === 'custom' && (
    <div>
      <div className="divide-y divide-line rounded-ui-md border border-line-strong bg-panel shadow-ui-sm transition-[border-color,box-shadow] duration-150 focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--ui-brand-ring)]">
        {dateRow('From', filters.customStart, (customStart) => onChange({ ...filters, customStart }))}
        {dateRow('To', filters.customEnd, (customEnd) => onChange({ ...filters, customEnd }))}
      </div>
      {datesInverted && (
        <p className="mt-1.5 text-[12px] font-medium text-negative">From is after To.</p>
      )}
    </div>
  );

  // No stepper arrows: nobody nudges a dollar filter by 1. The keypad on a
  // phone stays decimal.
  const amountInputClass = cn(inputClass, '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none');
  const amountInputs = filters.amountOp !== 'any' && (
    <div>
      <div className={cn('grid gap-2', filters.amountOp === 'between' && 'grid-cols-2')}>
        {(filters.amountOp === 'atLeast' || filters.amountOp === 'between') && (
          <input
            type="number"
            placeholder={filters.amountOp === 'between' ? '$ min' : '$ amount'}
            aria-label="Minimum amount"
            value={filters.amountMin}
            onChange={(e) => onChange({ ...filters, amountMin: e.target.value })}
            min="0"
            inputMode="decimal"
            className={amountInputClass}
          />
        )}
        {(filters.amountOp === 'atMost' || filters.amountOp === 'between') && (
          <input
            type="number"
            placeholder={filters.amountOp === 'between' ? '$ max' : '$ amount'}
            aria-label="Maximum amount"
            value={filters.amountMax}
            onChange={(e) => onChange({ ...filters, amountMax: e.target.value })}
            min="0"
            inputMode="decimal"
            className={amountInputClass}
          />
        )}
      </div>
      {amountRangeInverted(filters) && (
        <p className="mt-1.5 text-[12px] font-medium text-negative">Min is more than max.</p>
      )}
    </div>
  );

  const DATE_OPTIONS: Array<{ value: TxnFilters['datePreset']; label: string }> = [
    { value: 'all', label: 'All time' },
    { value: 'this-month', label: 'This month' },
    { value: 'last-month', label: 'Last month' },
    { value: 'last-3-months', label: 'Last 3 months' },
    { value: 'ytd', label: 'Year to date' },
    { value: 'custom', label: 'Custom range' },
  ];
  const AMOUNT_OPTIONS: Array<{ value: TxnFilters['amountOp']; label: string }> = [
    { value: 'any', label: 'Any amount' },
    { value: 'atLeast', label: 'At least' },
    { value: 'atMost', label: 'At most' },
    { value: 'between', label: 'Between' },
  ];
  const statusCount = statusChipLabels(filters).length;

  // Each filter, renderable two ways: `inline` is one compact trigger in the
  // wide toolbar row, the other is a labelled section of a stacked panel.
  type FilterField = { key: string; label: string; active: boolean; render: (inline: boolean) => React.ReactNode };
  const fields: FilterField[] = [
    {
      key: 'category',
      label: 'Category',
      active: categoryCount + excludeCount > 0,
      render: (inline) => (
        <>
          {/* Above the trigger, not below it: the picker's popover opens
               downward and covered the caption at exactly the moment the
               user is choosing categories. */}
          {!inline && excludeChips.length > 0 && (
            <p id={excludeCaptionId} className="mb-1.5 text-[12px] font-medium text-content-muted">
              Except {excludeChips.map((c) => c.label).join(', ')}
            </p>
          )}
          <CategoryMultiSelect
            variant="field"
            toolbar={inline ? { name: 'Category', count: categoryCount + excludeCount } : undefined}
            describedBy={!inline && excludeChips.length > 0 ? excludeCaptionId : undefined}
            selected={filters.categories}
            // Including a category that is also excluded matches nothing,
            // so ticking one here drops it from the exclude list rather
            // than leaving two chips that contradict each other over an
            // empty result.
            onChange={(cats) => onChange({
              ...filters,
              categories: cats,
              excludeCategories: filters.excludeCategories.filter((id) => !cats.includes(id)),
            })}
          />
        </>
      ),
    },
    ...(accounts.length > 0 ? [{
      key: 'account',
      label: 'Account',
      active: filters.accountIds.length > 0,
      render: (inline: boolean) => (
        <AccountPicker
          multiple
          accounts={accounts}
          toolbar={inline ? { name: 'Account', count: filters.accountIds.length } : undefined}
          selected={filters.accountIds}
          onChange={(ids) => onChange({ ...filters, accountIds: ids })}
        />
      ),
    }] : []),
    {
      key: 'date',
      label: 'Date',
      active: dateActive,
      render: (inline) => (
        <>
          <OptionMenu
            ariaLabel="Date"
            value={filters.datePreset}
            options={DATE_OPTIONS}
            toolbar={inline ? { name: 'Date', count: dateActive ? 1 : 0, badge: false } : undefined}
            // Inline, the range inputs live in this panel, so it stays open
            // for them. Stacked, they sit below the menu, so it closes.
            keepOpen={inline ? (v) => v === 'custom' : undefined}
            onChange={(datePreset) => onChange({ ...filters, datePreset, customStart: '', customEnd: '' })}
            panelClassName={inline && customDateInputs ? 'w-[300px]' : undefined}
          >
            {inline && customDateInputs && <div className="mt-1 border-t border-line px-1.5 pb-1.5 pt-2.5">{customDateInputs}</div>}
          </OptionMenu>
          {!inline && customDateInputs && <div className="mt-2">{customDateInputs}</div>}
        </>
      ),
    },
    {
      key: 'merchant',
      label: 'Merchant',
      active: filters.merchants.length > 0,
      render: (inline) => (
        <MerchantPicker
          selected={filters.merchants}
          toolbar={inline ? { name: 'Merchant', count: filters.merchants.length } : undefined}
          onChange={(merchants) => onChange({ ...filters, merchants })}
        />
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      active: !!amountChip,
      render: (inline) => (
        <>
          <OptionMenu
            ariaLabel="Amount"
            value={filters.amountOp}
            options={AMOUNT_OPTIONS}
            toolbar={inline ? { name: 'Amount', count: amountChip ? 1 : 0, badge: false } : undefined}
            keepOpen={inline ? (v) => v !== 'any' : undefined}
            onChange={(amountOp) => onChange({ ...filters, amountOp, amountMin: '', amountMax: '' })}
            panelClassName={inline && amountInputs ? 'w-[260px]' : undefined}
          >
            {inline && amountInputs && <div className="mt-1 border-t border-line px-1.5 pb-1.5 pt-2.5">{amountInputs}</div>}
          </OptionMenu>
          {!inline && amountInputs && <div className="mt-2">{amountInputs}</div>}
        </>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      active: statusCount > 0,
      render: (inline) => inline
        ? <StatusPicker filters={filters} onChange={onChange} toolbar={{ name: 'Status', count: statusCount }} />
        : <StatusFields filters={filters} onChange={onChange} />,
    },
    {
      key: 'views',
      label: 'Saved views',
      active: false,
      render: (inline) => <ViewsPicker filters={filters} onChange={onChange} toolbar={inline ? { name: 'Views', count: 0 } : undefined} onApplied={() => setOpenPanel(null)} />,
    },
  ];

  const dateField = fields.find((f) => f.key === 'date');
  const panelFields = fields.filter((f) => f.key !== 'date');
  const activeCount = panelFields.filter((f) => f.active).length;

  const stackedPanel = (list: FilterField[], align: 'left' | 'right') => (
    <div
      ref={panelRef}
      className={cn(
        'absolute top-full space-y-4 overflow-y-auto overscroll-contain', PANEL_CLASS, 'mt-2 p-4',
        align === 'left' ? 'left-0 right-0 sm:right-auto sm:w-[380px]' : 'right-0 w-[380px]',
      )}
      style={panelMaxH ? { maxHeight: panelMaxH } : undefined}
    >
      {list.map((f) => (
        <div key={f.key}>
          <div className={sectionLabel}>{f.label}</div>
          {f.render(false)}
        </div>
      ))}
    </div>
  );


  return (
    <div className="space-y-2">
      {/* Toolbar row — also the popover anchor so the panel can go full-width
           under the toolbar on mobile. */}
      <div className={cn('relative', hideControls && 'sm:hidden')}>
        {/* Below lg, search takes its own line and the buttons wrap under it. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Debounced search */}
          <div className="relative w-full min-w-0 lg:w-auto lg:flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              type="text"
              placeholder="Search transactions"
              aria-label="Search transactions"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="ui-focus touch-target h-10 w-full rounded-ui-md border border-line bg-panel pl-9 pr-8 text-[13px] text-content shadow-ui-sm sm:h-9"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); onChange({ ...filters, search: '' }); }}
                aria-label="Clear search"
                className="ui-focus absolute right-2.5 top-1/2 grid -translate-y-1/2 place-items-center rounded-ui-xs text-content-muted hover:text-content"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Wider screens: Date on its own, every other filter behind one button. */}
          {dateField && <div className="hidden shrink-0 sm:block">{dateField.render(true)}</div>}
          <div className="relative hidden shrink-0 sm:block">
            <button
              ref={moreBtnRef}
              type="button"
              onClick={() => setOpenPanel(openPanel === 'more' ? null : 'more')}
              aria-expanded={openPanel === 'more'}
              aria-haspopup="true"
              // Room for the count badge from the start, so search doesn't shrink when it shows.
              className={cn(button({ variant: activeCount > 0 ? 'secondary' : 'neutral', size: 'sm' }), 'min-w-[112px] shrink-0 px-3')}
            >
              <SlidersHorizontal size={14} className="opacity-70" aria-hidden />
              Filters
              {activeCount > 0 && <Badge tone="brand" size="sm">{activeCount}</Badge>}
            </button>
            {openPanel === 'more' && stackedPanel(panelFields, 'right')}
          </div>
          {trailing}
        </div>

        {openPanel === 'all' && (
          <>
            {/* Takes the tap that closes the panel, so it can't also land on
                 the row underneath and filter the list. */}
            <div aria-hidden className="fixed inset-0 z-40 sm:hidden" onClick={() => setOpenPanel(null)} />
            <div id="txn-filters-panel">{stackedPanel(fields, 'left')}</div>
          </>
        )}
      </div>

      {/* Active filter chips. On phones one row that scrolls sideways, with
           Clear all at its end. Each × there carries a 44px tall tap zone
           (max-sm:before:-inset-y-3), so the row pads vertically (and pulls the
           padding back with margin) to keep those zones inside its scroll box.
           Wider screens wrap. */}
      {chips.length > 0 && (
        <div className="flex items-center gap-x-2 max-sm:-mx-3 max-sm:-my-3 max-sm:overflow-x-auto max-sm:px-3 max-sm:py-3 max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden max-sm:[&>*]:shrink-0 sm:flex-wrap sm:gap-y-2">
          {chips.map((chip) => (
            <ChipBadge
              key={chip.key}
              label={chip.label}
              tone={chip.tone}
              removeLabel={chip.removeLabel}
              href={chip.href}
              onClear={chip.clear}
            />
          ))}
          {/* One Clear all: everything, search and the Money in / out / Transfers side included.
               It shows once two things are set, a side counting as one. */}
          {chips.length + (filters.kind !== 'all' ? 1 : 0) + (filters.search ? 1 : 0) >= 2 && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); onChange(EMPTY_FILTERS); }}
              className="ui-focus touch-target-inline rounded-ui-xs text-[12.5px] font-semibold text-content-muted transition-colors hover:text-content"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
