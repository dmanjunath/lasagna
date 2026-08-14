import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Layers, Search, SlidersHorizontal, X } from 'lucide-react';
import type { TxnQueryBody } from '../../lib/api';
import type { AccountIndexEntry } from '../../lib/use-accounts-index';
import { Badge } from '../uikit';
import { cn } from '../../lib/utils';
import { InstIcon } from '../common/InstIcon';
import { getCategoryDisplay } from '../../lib/categories';
import { categoryOptionLabel, usePickerGroups, useTaxonomy } from '../../lib/taxonomy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TxnFilters {
  search: string;
  categories: string[];
  accountIds: string[];
  datePreset: 'all' | 'this-month' | 'last-month' | 'last-3-months' | 'ytd' | 'custom';
  customStart: string;   // 'YYYY-MM-DD' or ''
  customEnd: string;
  amountMin: string;     // raw input; '' = unset
  amountMax: string;
}

export const EMPTY_FILTERS: TxnFilters = {
  search: '',
  categories: [],
  accountIds: [],
  datePreset: 'all',
  customStart: '',
  customEnd: '',
  amountMin: '',
  amountMax: '',
};

// ---------------------------------------------------------------------------
// filtersToQuery — converts UI filter state to TxnQueryBody['filters'].
// ---------------------------------------------------------------------------

export function filtersToQuery(f: TxnFilters, now: Date = new Date()): TxnQueryBody['filters'] {
  const result: TxnQueryBody['filters'] = {};

  const search = f.search.trim();
  if (search) result.search = search;
  if (f.categories.length > 0) result.categories = f.categories;
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

  const min = parseFloat(f.amountMin);
  if (!isNaN(min)) result.amountMin = min;
  const max = parseFloat(f.amountMax);
  if (!isNaN(max)) result.amountMax = max;

  return result;
}

// ---------------------------------------------------------------------------
// MultiSelectDropdown — hand-rolled; outside-click + Escape to close.
// ---------------------------------------------------------------------------

function MultiSelectDropdown({
  label,
  pluralLabel,
  options,
  selected,
  onChange,
  groupChildren,
}: {
  label: string;
  pluralLabel: string;
  /** Items with `heading: true` render as non-selectable section headers.
      `icon` renders left of the label; `sublabel` renders muted beneath it. */
  options: Array<{ value: string; label: string; heading?: boolean; icon?: React.ReactNode; sublabel?: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Maps a heading value → its child option values. When present for a heading,
      it renders as a select-all checkbox (with an indeterminate partial state)
      that toggles every child at once. */
  groupChildren?: Map<string, string[]>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Trigger label — collapse fully-selected groups so it agrees with the chips
  // and badge (a whole group counts as one, shown by name).
  const triggerLabel = (() => {
    if (selected.length === 0) return label;
    if (!groupChildren) {
      return selected.length === 1
        ? (options.find((o) => !o.heading && o.value === selected[0])?.label ?? label)
        : `${selected.length} ${pluralLabel}`;
    }
    const consumed = new Set<string>();
    const groupNames: string[] = [];
    for (const [gid, kids] of groupChildren) {
      if (kids.length > 0 && kids.every((v) => selected.includes(v))) {
        kids.forEach((v) => consumed.add(v));
        groupNames.push(options.find((o) => o.heading && o.value === gid)?.label ?? '');
      }
    }
    const loose = selected.filter((v) => !consumed.has(v));
    const total = groupNames.length + loose.length;
    if (total === 1) {
      return groupNames[0] || (options.find((o) => !o.heading && o.value === loose[0])?.label ?? label);
    }
    return `${total} ${pluralLabel}`;
  })();

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="ui-focus touch-target relative h-11 min-h-touch w-full appearance-none truncate rounded-ui-md border border-line-strong bg-panel pl-3 pr-9 text-left text-[13px] font-medium text-content shadow-ui-sm"
      >
        {triggerLabel}
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[320px] w-full min-w-[200px] overflow-y-auto rounded-ui-md border border-line-strong bg-panel-raised shadow-ui-lg">
          {options.map((opt) => {
            if (opt.heading) {
              const children = groupChildren?.get(opt.value);
              if (!children || children.length === 0) {
                return (
                  <div
                    key={`h-${opt.value}`}
                    className="px-3 pb-1 pt-2.5 text-[11px] font-semibold text-content-muted"
                  >
                    {opt.label}
                  </div>
                );
              }
              // Selectable group header: a shaded "select all in group" row that
              // reads as a section — a Layers glyph + bold dark label mark it as
              // the parent; children render indented beneath. Checked when every
              // child is selected, indeterminate when only some are.
              const allSelected = children.every((v) => selected.includes(v));
              const someSelected = children.some((v) => selected.includes(v));
              return (
                <label
                  key={`h-${opt.value}`}
                  className="flex min-h-touch cursor-pointer items-center gap-2.5 border-y border-line bg-canvas-sunken px-3 py-2 first:border-t-0 hover:bg-line/70"
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={() => {
                      onChange(
                        allSelected
                          ? selected.filter((v) => !children.includes(v))
                          : Array.from(new Set([...selected, ...children])),
                      );
                    }}
                    className="h-4 w-4 rounded border-line accent-[rgb(var(--ui-brand))]"
                  />
                  <Layers size={13} className="shrink-0 text-content-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-content">{opt.label}</span>
                </label>
              );
            }
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={cn(
                  'flex min-h-touch cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-canvas-sunken',
                  // Indent category rows so they nest under their group header.
                  groupChildren && 'pl-9',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((v) => v !== opt.value)
                      : [...selected, opt.value];
                    onChange(next);
                  }}
                  className="h-4 w-4 rounded border-line accent-[rgb(var(--ui-brand))]"
                />
                {opt.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-content">{opt.label}</span>
                  {opt.sublabel && (
                    <span className="block truncate text-[11.5px] text-content-muted">{opt.sublabel}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
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
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const filtersBtnRef = useRef<HTMLButtonElement>(null);

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
      if (panelRef.current?.contains(t) || filtersBtnRef.current?.contains(t)) return;
      setPanelOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPanelOpen(false);
        filtersBtnRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [panelOpen]);

  // Grouped category options — a heading row per group, category ids as values.
  const pickerGroups = usePickerGroups();
  const { byId } = useTaxonomy();
  const categoryOptions = useMemo(
    () =>
      pickerGroups.flatMap(({ group, categories }) => [
        { value: group.id, label: group.name, heading: true as const },
        ...categories.map((cat) => ({ value: cat.id, label: categoryOptionLabel(cat) })),
      ]),
    [pickerGroups],
  );
  // Group id → its child category ids, so a group header can select all at once
  // and a fully-selected group collapses into a single chip.
  const categoryGroupChildren = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const { group, categories } of pickerGroups) m.set(group.id, categories.map((c) => c.id));
    return m;
  }, [pickerGroups]);
  // Fully-selected groups collapse to one unit, so the trigger label, the
  // Filters badge, and the chips all agree on how a group selection is counted.
  const { selectedGroups, looseCatIds } = useMemo(() => {
    const consumed = new Set<string>();
    const selectedGroups: Array<{ id: string; name: string; childIds: string[] }> = [];
    for (const { group, categories } of pickerGroups) {
      const childIds = categories.map((c) => c.id);
      if (childIds.length > 0 && childIds.every((id) => filters.categories.includes(id))) {
        childIds.forEach((id) => consumed.add(id));
        selectedGroups.push({ id: group.id, name: group.name, childIds });
      }
    }
    return { selectedGroups, looseCatIds: filters.categories.filter((c) => !consumed.has(c)) };
  }, [pickerGroups, filters.categories]);
  // Account options carry the institution identity so several accounts named
  // e.g. "CREDIT CARD" stay distinguishable (logo + "Chase ••1234").
  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: a.name,
    icon: <InstIcon institution={a.institution} isManual={a.isManual} size="sm" />,
    sublabel: `${a.institution}${a.mask ? ` ••${a.mask}` : ''}`,
  }));
  // Names shared by 2+ accounts — their chips get a ••mask suffix.
  const nameCounts = new Map<string, number>();
  for (const a of accounts) nameCounts.set(a.name, (nameCounts.get(a.name) ?? 0) + 1);

  // Active-filter count for the Filters button badge (search lives outside).
  // A whole selected group counts as one, matching the collapsed chips.
  const activeCount =
    selectedGroups.length + looseCatIds.length +
    filters.accountIds.length +
    (filters.datePreset !== 'all' ? 1 : 0) +
    (filters.amountMin || filters.amountMax ? 1 : 0);

  // Build active chips.
  type Chip = { key: string; label: string; clear: () => void; tone?: 'brand' | 'neutral' };
  const chips: Chip[] = [];

  if (filters.search) {
    chips.push({
      key: 'search',
      label: `"${filters.search}"`,
      clear: () => { setSearchInput(''); onChange({ ...filters, search: '' }); },
    });
  }
  // A fully-selected group is one chip; leftover loose categories get their own.
  // Brand-tone both so a drill-in from Spending reads as "you're scoped here",
  // distinct from search/account chips.
  for (const g of selectedGroups) {
    chips.push({
      key: `grp-${g.id}`,
      label: g.name,
      tone: 'brand',
      clear: () => onChange({ ...filters, categories: filters.categories.filter((c) => !g.childIds.includes(c)) }),
    });
  }
  for (const cat of looseCatIds) {
    chips.push({
      key: `cat-${cat}`,
      label: byId.get(cat)?.name ?? getCategoryDisplay(cat).label,
      tone: 'brand',
      clear: () => onChange({ ...filters, categories: filters.categories.filter((c) => c !== cat) }),
    });
  }
  for (const accId of filters.accountIds) {
    const acc = accounts.find((a) => a.id === accId);
    const ambiguous = acc && (nameCounts.get(acc.name) ?? 0) > 1;
    const label = acc
      ? ambiguous && acc.mask ? `${acc.name} ••${acc.mask}` : acc.name
      : accId;
    chips.push({
      key: `acc-${accId}`,
      label,
      clear: () => onChange({ ...filters, accountIds: filters.accountIds.filter((id) => id !== accId) }),
    });
  }
  if (filters.datePreset !== 'all') {
    const presetLabels: Record<string, string> = {
      'this-month': 'This month',
      'last-month': 'Last month',
      'last-3-months': 'Last 3 months',
      'ytd': 'Year to date',
      'custom': 'Custom dates',
    };
    chips.push({
      key: 'date',
      label: presetLabels[filters.datePreset] ?? filters.datePreset,
      clear: () => onChange({ ...filters, datePreset: 'all', customStart: '', customEnd: '' }),
    });
  }
  if (filters.amountMin || filters.amountMax) {
    const label = filters.amountMin && filters.amountMax
      ? `$${filters.amountMin} to $${filters.amountMax}`
      : filters.amountMin
        ? `≥$${filters.amountMin}`
        : `≤$${filters.amountMax}`;
    chips.push({
      key: 'amount',
      label,
      clear: () => onChange({ ...filters, amountMin: '', amountMax: '' }),
    });
  }

  const sectionLabel = 'mb-1.5 text-[12px] font-semibold text-content-secondary';

  return (
    <div className="space-y-2">
      {/* Toolbar row — also the popover anchor so the panel can go full-width
           under the toolbar on mobile. */}
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          {/* Debounced search */}
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              type="text"
              placeholder="Search merchants…"
              aria-label="Search merchants"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="ui-focus touch-target h-10 w-full rounded-ui-md border border-line bg-panel pl-9 pr-8 text-[13px] text-content shadow-ui-sm sm:w-[220px]"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); onChange({ ...filters, search: '' }); }}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 grid -translate-y-1/2 place-items-center text-content-muted hover:text-content"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filters popover trigger */}
          <button
            ref={filtersBtnRef}
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            aria-haspopup="true"
            className="ui-focus touch-target inline-flex h-10 shrink-0 items-center gap-2 rounded-ui-md border border-line bg-panel px-3 text-[13px] font-medium text-content shadow-ui-sm"
          >
            <SlidersHorizontal size={14} className="text-content-muted" aria-hidden />
            Filters
            {activeCount > 0 && <Badge tone="brand" size="sm">{activeCount}</Badge>}
          </button>

          {trailing}
        </div>

        {/* Filters panel — Category / Account / Date / Amount. */}
        {panelOpen && (
          <div
            ref={panelRef}
            className="absolute left-0 right-0 top-full z-50 mt-2 space-y-4 rounded-ui-md border border-line-strong bg-panel-raised p-4 shadow-ui-lg sm:right-auto sm:w-[380px]"
          >
            <div>
              <div className={sectionLabel}>Category</div>
              <MultiSelectDropdown
                label="All categories"
                pluralLabel="categories"
                options={categoryOptions}
                selected={filters.categories}
                onChange={(cats) => onChange({ ...filters, categories: cats })}
                groupChildren={categoryGroupChildren}
              />
            </div>

            {accounts.length > 0 && (
              <div>
                <div className={sectionLabel}>Account</div>
                <MultiSelectDropdown
                  label="All accounts"
                  pluralLabel="accounts"
                  options={accountOptions}
                  selected={filters.accountIds}
                  onChange={(ids) => onChange({ ...filters, accountIds: ids })}
                />
              </div>
            )}

            <div>
              <div className={sectionLabel}>Date</div>
              <div className="relative">
                <select
                  value={filters.datePreset}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      datePreset: e.target.value as TxnFilters['datePreset'],
                      customStart: '',
                      customEnd: '',
                    })
                  }
                  className="ui-focus touch-target h-11 min-h-touch w-full appearance-none rounded-ui-md border border-line-strong bg-panel pl-3 pr-9 text-[13px] font-medium text-content shadow-ui-sm"
                >
                  <option value="all">All time</option>
                  <option value="this-month">This month</option>
                  <option value="last-month">Last month</option>
                  <option value="last-3-months">Last 3 months</option>
                  <option value="ytd">Year to date</option>
                  <option value="custom">Custom…</option>
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" />
              </div>
              {filters.datePreset === 'custom' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    aria-label="Start date"
                    value={filters.customStart}
                    onChange={(e) => onChange({ ...filters, customStart: e.target.value })}
                    className="ui-focus touch-target h-10 w-full rounded-ui-md border border-line bg-panel px-3 text-[13px] text-content shadow-ui-sm"
                  />
                  <input
                    type="date"
                    aria-label="End date"
                    value={filters.customEnd}
                    onChange={(e) => onChange({ ...filters, customEnd: e.target.value })}
                    className="ui-focus touch-target h-10 w-full rounded-ui-md border border-line bg-panel px-3 text-[13px] text-content shadow-ui-sm"
                  />
                </div>
              )}
            </div>

            <div>
              <div className={sectionLabel}>Amount</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="$ min"
                  aria-label="Minimum amount"
                  value={filters.amountMin}
                  onChange={(e) => onChange({ ...filters, amountMin: e.target.value })}
                  min="0"
                  className="ui-focus touch-target h-10 w-full rounded-ui-md border border-line bg-panel px-3 text-[13px] text-content shadow-ui-sm"
                />
                <input
                  type="number"
                  placeholder="$ max"
                  aria-label="Maximum amount"
                  value={filters.amountMax}
                  onChange={(e) => onChange({ ...filters, amountMax: e.target.value })}
                  min="0"
                  className="ui-focus touch-target h-10 w-full rounded-ui-md border border-line bg-panel px-3 text-[13px] text-content shadow-ui-sm"
                />
              </div>
              {filters.amountMin !== '' && filters.amountMax !== '' && Number(filters.amountMin) > Number(filters.amountMax) && (
                <p className="mt-1.5 text-[12px] font-medium text-negative">Min is more than max.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <Badge key={chip.key} tone={chip.tone ?? 'neutral'} className="pr-1.5">
              {chip.label}
              <button
                type="button"
                onClick={chip.clear}
                aria-label={`Remove ${chip.label} filter`}
                className="grid place-items-center"
              >
                <X size={12} />
              </button>
            </Badge>
          ))}
          {chips.length >= 2 && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); onChange(EMPTY_FILTERS); }}
              className="text-[12.5px] font-semibold text-content-muted transition-colors hover:text-content"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
