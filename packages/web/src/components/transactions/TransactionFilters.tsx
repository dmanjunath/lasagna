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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TxnFilters {
  search: string;
  /** Exact merchant, as the row shows it. Set by clicking a row's merchant. */
  merchant: string;
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
  /** credit = money in, debit = money out. */
  direction: 'all' | 'credit' | 'debit';
}

export const EMPTY_FILTERS: TxnFilters = {
  search: '',
  merchant: '',
  categories: [],
  excludeCategories: [],
  accountIds: [],
  datePreset: 'all',
  customStart: '',
  customEnd: '',
  amountOp: 'any',
  amountMin: '',
  amountMax: '',
  direction: 'all',
};

// ---------------------------------------------------------------------------
// filtersToQuery — converts UI filter state to TxnQueryBody['filters'].
// ---------------------------------------------------------------------------

export function amountRangeInverted(f: TxnFilters): boolean {
  return f.amountOp === 'between' && f.amountMin !== '' && f.amountMax !== '' && Number(f.amountMin) > Number(f.amountMax);
}

export function filtersToQuery(f: TxnFilters, now: Date = new Date()): TxnQueryBody['filters'] {
  const result: TxnQueryBody['filters'] = {};

  const search = f.search.trim();
  if (search) result.search = search;
  if (f.merchant) result.merchant = f.merchant;
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
  if (f.direction !== 'all') result.direction = f.direction;

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

  const merchant = params.get('merchant');
  if (merchant) filters.merchant = merchant;

  const categories = params.get('categories');
  if (categories) filters.categories = categories.split(',').filter(Boolean);

  const excludeCategories = params.get('excludeCategories');
  if (excludeCategories) filters.excludeCategories = excludeCategories.split(',').filter(Boolean);

  const accountIds = params.get('accountIds');
  if (accountIds) filters.accountIds = accountIds.split(',').filter(Boolean);

  const direction = params.get('direction');
  if (direction === 'credit' || direction === 'debit') filters.direction = direction;

  const amountOp = params.get('amountOp');
  if (amountOp === 'atLeast' || amountOp === 'atMost' || amountOp === 'between') {
    filters.amountOp = amountOp;
    filters.amountMin = params.get('amountMin') ?? '';
    filters.amountMax = params.get('amountMax') ?? '';
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
  if (f.merchant) parts.push(`merchant=${encodeURIComponent(f.merchant)}`);
  if (f.categories.length > 0) {
    parts.push(`categories=${f.categories.map(encodeURIComponent).join(',')}`);
  }
  if (f.excludeCategories.length > 0) {
    parts.push(`excludeCategories=${f.excludeCategories.map(encodeURIComponent).join(',')}`);
  }
  if (f.accountIds.length > 0) {
    parts.push(`accountIds=${f.accountIds.map(encodeURIComponent).join(',')}`);
  }
  if (f.direction !== 'all') parts.push(`direction=${f.direction}`);
  if (f.amountOp !== 'any') {
    parts.push(`amountOp=${f.amountOp}`);
    if (f.amountMin && f.amountOp !== 'atMost') parts.push(`amountMin=${encodeURIComponent(f.amountMin)}`);
    if (f.amountMax && f.amountOp !== 'atLeast') parts.push(`amountMax=${encodeURIComponent(f.amountMax)}`);
  }
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
}): string {
  const query = filtersToSearchParams({
    ...EMPTY_FILTERS,
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
// TransactionFilters — one toolbar row: [search] [Filters button → popover
// panel with Category / Account / Date / Amount], plus the active-filter chips
// row beneath. Debounce ONLY the search input; all other controls call
// onChange immediately.
// ---------------------------------------------------------------------------

export function TransactionFilters({
  filters,
  onChange,
  accounts,
  trailing,
}: {
  filters: TxnFilters;
  onChange: (f: TxnFilters) => void;
  accounts: AccountIndexEntry[];
  /** Rendered at the end of the toolbar row (e.g. the desktop sort select). */
  trailing?: React.ReactNode;
}) {
  const [searchInput, setSearchInput] = useState(filters.search);
  // 'all' = the phone's combined Filters panel. 'more' = the wider toolbar's
  // panel holding just the filters that didn't fit in the row.
  const [openPanel, setOpenPanel] = useState<'all' | 'more' | null>(null);
  const panelOpen = openPanel !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const filtersBtnRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

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
      if (panelRef.current?.contains(t) || filtersBtnRef.current?.contains(t) || moreBtnRef.current?.contains(t)) return;
      // A picker's phone sheet portals outside the panel. A tap in it is still
      // a tap inside the panel's job.
      if ((t as Element).closest?.('[data-sheet]')) return;
      setOpenPanel(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        (openPanel === 'more' ? moreBtnRef : filtersBtnRef).current?.focus();
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

  // "Custom range" with no dates typed yet filters nothing, so it isn't counted
  // or chipped until a date is entered.
  const dateActive = filters.datePreset !== 'all' && (filters.datePreset !== 'custom' || !!filters.customStart || !!filters.customEnd);

  // Active-filter count for the Filters button badge (search lives outside).
  // A whole selected group counts as one, matching the collapsed chips.
  const activeCount =
    categoryCount +
    excludeCount +
    filters.accountIds.length +
    (filters.merchant ? 1 : 0) +
    (dateActive ? 1 : 0) +
    ((filters.amountMin || filters.amountMax) && !amountRangeInverted(filters) ? 1 : 0) +
    (filters.direction !== 'all' ? 1 : 0);

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

  if (filters.search) {
    chips.push({
      key: 'search',
      label: `"${filters.search}"`,
      clear: () => { setSearchInput(''); onChange({ ...filters, search: '' }); },
    });
  }
  if (filters.merchant) {
    chips.push({
      key: 'merchant',
      label: `Merchant: ${filters.merchant}`,
      clear: () => onChange({ ...filters, merchant: '' }),
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
  if (filters.direction !== 'all') {
    chips.push({
      key: 'direction',
      label: filters.direction === 'credit' ? 'Credit' : 'Debit',
      clear: () => onChange({ ...filters, direction: 'all' }),
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
  const inputClass = 'ui-focus touch-target h-10 w-full rounded-ui-md border border-line bg-panel px-3 text-[13px] text-content shadow-ui-sm';

  const customDateInputs = filters.datePreset === 'custom' && (
    <div className="grid grid-cols-2 gap-2">
      <input
        type="date"
        aria-label="Start date"
        value={filters.customStart}
        onChange={(e) => onChange({ ...filters, customStart: e.target.value })}
        className={inputClass}
      />
      <input
        type="date"
        aria-label="End date"
        value={filters.customEnd}
        onChange={(e) => onChange({ ...filters, customEnd: e.target.value })}
        className={inputClass}
      />
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
  const TYPE_OPTIONS: Array<{ value: TxnFilters['direction']; label: string }> = [
    { value: 'all', label: 'All types' },
    { value: 'credit', label: 'Credit' },
    { value: 'debit', label: 'Debit' },
  ];

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
      key: 'type',
      label: 'Type',
      active: filters.direction !== 'all',
      render: (inline) => inline ? (
        <OptionMenu
          ariaLabel="Type"
          toolbar={{ name: 'Type', count: filters.direction !== 'all' ? 1 : 0, badge: false }}
          value={filters.direction}
          options={TYPE_OPTIONS}
          onChange={(direction) => onChange({ ...filters, direction })}
        />
      ) : (
        <SegmentedControl
          aria-label="Type"
          size="sm"
          value={filters.direction}
          onChange={(direction) => onChange({ ...filters, direction })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'credit', label: 'Credit' },
            { value: 'debit', label: 'Debit' },
          ]}
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
  ];

  // Wide toolbar: as many filters inline as fit, the rest under "More". An
  // invisible copy of the row measures each trigger at its natural width.
  const areaRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fitCount, setFitCount] = useState(fields.length);
  useLayoutEffect(() => {
    const area = areaRef.current;
    const measure = measureRef.current;
    if (!area || !measure) return;
    const GAP = 8;
    const fit = () => {
      const kids = Array.from(measure.children) as HTMLElement[];
      const moreWidth = kids[kids.length - 1]?.offsetWidth ?? 0;
      const widths = kids.slice(0, -1).map((k) => k.offsetWidth);
      const available = area.clientWidth;
      const total = widths.reduce((a, w) => a + w + GAP, 0) - GAP;
      if (total <= available) { setFitCount(widths.length); return; }
      let used = moreWidth;
      let n = 0;
      for (const w of widths) {
        if (used + GAP + w > available) break;
        used += GAP + w;
        n++;
      }
      setFitCount(n);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [fields.length]);

  const shown = fields.slice(0, fitCount);
  const overflow = fields.slice(fitCount);
  const overflowActive = overflow.filter((f) => f.active).length;
  const inlineWrap = 'max-w-[220px] shrink-0';

  const stackedPanel = (list: FilterField[], align: 'left' | 'right') => (
    <div
      ref={panelRef}
      className={cn(
        'absolute top-full space-y-4', PANEL_CLASS, 'mt-2 p-4',
        align === 'left' ? 'left-0 right-0 sm:right-auto sm:w-[380px]' : 'right-0 w-[380px]',
      )}
    >
      {list.map((f) => (
        <div key={f.key}>
          <div className={sectionLabel}>{f.label}</div>
          {f.render(false)}
        </div>
      ))}
    </div>
  );

  const moreLabel = shown.length === 0 ? 'Filters' : 'More';
  const moreButton = (ref?: React.Ref<HTMLButtonElement>, count = 0) => (
    <button
      ref={ref}
      type="button"
      onClick={ref ? () => setOpenPanel((v) => (v === 'more' ? null : 'more')) : undefined}
      aria-expanded={ref ? openPanel === 'more' : undefined}
      aria-haspopup="true"
      tabIndex={ref ? undefined : -1}
      className={cn(button({ variant: count > 0 ? 'primary' : 'secondary', size: 'sm' }), 'shrink-0 px-3')}
    >
      <SlidersHorizontal size={14} className="opacity-70" aria-hidden />
      {moreLabel}
      {count > 0 && <Badge tone="brand" size="sm">{count}</Badge>}
    </button>
  );

  return (
    <div className="space-y-2">
      {/* Toolbar row — also the popover anchor so the panel can go full-width
           under the toolbar on mobile. */}
      <div className="relative">
        <div className="flex items-center gap-2">
          {/* Debounced search */}
          <div className="relative min-w-0 flex-1 sm:w-[200px] sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              type="text"
              placeholder="Search merchants…"
              aria-label="Search merchants"
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

          {/* Phones: one Filters button over every filter. */}
          <button
            ref={filtersBtnRef}
            type="button"
            onClick={() => setOpenPanel((v) => (v === 'all' ? null : 'all'))}
            aria-expanded={openPanel === 'all'}
            aria-haspopup="true"
            className={cn(button({ variant: 'secondary', size: 'sm' }), 'h-10 shrink-0 px-3 sm:hidden')}
          >
            <SlidersHorizontal size={14} className="text-content-muted" aria-hidden />
            Filters
            {activeCount > 0 && <Badge tone="brand" size="sm">{activeCount}</Badge>}
          </button>

          {/* Wider screens: each filter that fits, then More. */}
          <div ref={areaRef} className="relative hidden min-w-0 flex-1 sm:block">
            <div className="flex items-center gap-2">
              {shown.map((f) => (
                <div key={f.key} className={inlineWrap}>{f.render(true)}</div>
              ))}
              {overflow.length > 0 && (
                <div className="relative">
                  {moreButton(moreBtnRef, overflowActive)}
                  {openPanel === 'more' && stackedPanel(overflow, 'right')}
                </div>
              )}
            </div>
            {/* Clipped wrapper: the copy is wider than the column on a narrow
                 window and would otherwise widen the page sideways. */}
            <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
              <div
                ref={measureRef}
                // inert: the copies are for measuring only, never for use.
                inert
                className="absolute left-0 top-0 flex w-max items-center gap-2"
              >
                {fields.map((f) => (
                  <div key={f.key} className={inlineWrap}>{f.render(true)}</div>
                ))}
                {moreButton(undefined, 9)}
              </div>
            </div>
          </div>

          {trailing}
        </div>

        {openPanel === 'all' && (
          <>
            {/* Takes the tap that closes the panel, so it can't also land on
                 the row underneath and filter the list. */}
            <div aria-hidden className="fixed inset-0 z-40 sm:hidden" onClick={() => setOpenPanel(null)} />
            {stackedPanel(fields, 'left')}
          </>
        )}
      </div>

      {/* Active filter chips. The row wraps, and each × carries a 44px tall tap
           zone on phones (max-sm:before:-inset-y-3), so the vertical gap has to
           clear that zone: at gap-2 the zones of two stacked lines overlapped by
           6px and a tap in the band deleted the chip on the other line. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-4 sm:gap-y-2">
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
          {chips.length >= 2 && (
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
