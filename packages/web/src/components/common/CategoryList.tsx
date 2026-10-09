import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Check, Search, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Skeleton } from '../uikit';
import { categoryOptionLabel, taxonomyIcon, usePickerGroups, useTaxonomy } from '../../lib/taxonomy';

// ---------------------------------------------------------------------------
// CategoryList — the body of every category dropdown: a pinned search, the
// groups as tinted section bands, icon rows, and a Manage categories footer.
// Single mode picks one category. Multi mode toggles rows, and each band
// carries an All/Clear for its group. The hosts (CategoryPicker, the filter
// CategoryMultiSelect) own the trigger and the popover or sheet around it.
//
// Keyboard: the search input keeps focus. Arrows move aria-activedescendant,
// and Enter picks (single) or toggles (multi) the active row.
// ---------------------------------------------------------------------------

export function CategoryList({
  mode,
  selected,
  onPick,
  onSetSelected,
  onManage,
  autoFocus,
  scrollerClassName,
  excludeIds,
  anyLabel,
  showManage = true,
}: {
  /** Categories never to offer (e.g. the one being deleted). */
  excludeIds?: string[];
  /** Single mode: a top row that picks "no category" (''), e.g. "Any category". */
  anyLabel?: string;
  /** The Manage categories footer. Off inside forms and on the categories page itself. */
  showManage?: boolean;
  mode: 'single' | 'multi';
  /** Selected category ids. Single mode reads the first. */
  selected: string[];
  /** Single mode: the picked id. */
  onPick?: (id: string) => void;
  /** Multi mode: the next selection. */
  onSetSelected?: (ids: string[]) => void;
  /** Called before navigating to category settings, so the host can close. */
  onManage?: () => void;
  autoFocus?: boolean;
  /** Bounds the scrolling list (a max height, or flex-1 inside a sheet). */
  scrollerClassName?: string;
}) {
  const allGroups = usePickerGroups();
  const excludeKey = (excludeIds ?? []).join(',');
  const pickerGroups = useMemo(
    () => (excludeKey === ''
      ? allGroups
      : allGroups
          .map(({ group, categories }) => ({ group, categories: categories.filter((c) => !excludeKey.split(',').includes(c.id)) }))
          .filter((g) => g.categories.length > 0)),
    [allGroups, excludeKey],
  );
  const { loading, error, refresh } = useTaxonomy();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  // The active-row fill shows only while the keyboard is in use. At rest it
  // read as a second, unlabelled section band.
  const [showActive, setShowActive] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optId = (catId: string) => `${listId}-${catId}`;

  // A category matches on its own name or its group's. A group left with no
  // match drops out, band included.
  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      q === ''
        ? pickerGroups
        : pickerGroups
            .map(({ group, categories }) => ({
              group,
              categories: group.name.toLowerCase().includes(q)
                ? categories
                : categories.filter((c) => c.name.toLowerCase().includes(q)),
            }))
            .filter((g) => g.categories.length > 0),
    [pickerGroups, q],
  );
  const flat = useMemo(() => visibleGroups.flatMap((g) => g.categories), [visibleGroups]);
  const flatIdxById = useMemo(() => new Map(flat.map((c, i) => [c.id, i])), [flat]);

  // The active row follows the best match: the first category whose OWN name
  // matches (exact first), so typing a name then Enter picks that category,
  // not the first member of a group sharing the name.
  useEffect(() => {
    let idx = 0;
    if (q !== '') {
      const exact = flat.findIndex((c) => c.name.toLowerCase() === q);
      const named = exact >= 0 ? exact : flat.findIndex((c) => c.name.toLowerCase().includes(q));
      if (named >= 0) idx = named;
    }
    setActiveIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // On mount: activate and reveal the (first) selection, focus the search.
  useEffect(() => {
    const idx = flat.findIndex((c) => selected.includes(c.id));
    setActiveIdx(idx >= 0 ? idx : 0);
    if (autoFocus) searchRef.current?.focus();
    requestAnimationFrame(() => {
      listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activate = (id: string) => {
    if (mode === 'single') {
      onPick?.(id);
      return;
    }
    onSetSelected?.(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setShowActive(true);
      if (flat.length === 0) return;
      const next = e.key === 'ArrowDown' ? activeIdx + 1 : activeIdx - 1;
      const idx = (next + flat.length) % flat.length;
      setActiveIdx(idx);
      document.getElementById(optId(flat[idx].id))?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cat = flat[activeIdx];
      if (cat) activate(cat.id);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="relative shrink-0">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
        <input
          ref={searchRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={flat[activeIdx] ? optId(flat[activeIdx].id) : undefined}
          aria-autocomplete="list"
          placeholder="Search categories"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 w-full rounded-ui-md border border-line bg-panel pl-9 pr-3 text-[13px] text-content transition-[border-color,box-shadow] focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)] focus:outline-none"
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Categories"
        aria-multiselectable={mode === 'multi' || undefined}
        id={listId}
        // The hover fill follows the pointer only while it's over the list.
        onPointerLeave={(e) => { if (e.pointerType !== 'touch') setShowActive(false); }}
        // Room on the right for the scrollbar: an overlay one (macOS) drew over
        // the bands' All link and the row checks.
        className={cn('mt-1 min-h-0 overflow-y-auto overscroll-contain pr-2 [scrollbar-gutter:stable]', scrollerClassName ?? 'max-h-[320px]')}
      >
        {loading && pickerGroups.length === 0 ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5 px-2 py-2">
              <Skeleton className="h-[26px] w-[26px] rounded-ui-sm" />
              <Skeleton className="h-3.5 flex-1" />
            </div>
          ))
        ) : error && pickerGroups.length === 0 ? (
          <div className="px-3 py-3 text-[13px] text-content-muted">
            Categories failed to load.{' '}
            <button
              type="button"
              onClick={() => void refresh()}
              className="font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
            >
              Try again
            </button>
          </div>
        ) : flat.length === 0 ? (
          <div className="px-3 py-3 text-[13px] text-content-muted">No categories match</div>
        ) : (
          <>
          {mode === 'single' && anyLabel && q === '' && (
            <button
              type="button"
              role="option"
              aria-selected={selected.length === 0}
              tabIndex={-1}
              onClick={() => onPick?.('')}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2.5 rounded-ui-sm px-2 py-2 text-left transition-colors focus:outline-none max-sm:min-h-touch',
                selected.length === 0 ? 'bg-brand-softer' : 'hover:bg-canvas-sunken',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-content">{anyLabel}</span>
              {selected.length === 0 && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
            </button>
          )}
          {visibleGroups.map(({ group, categories }) => {
            const childIds = categories.map((c) => c.id);
            const allSelected = childIds.every((v) => selected.includes(v));
            return (
              <div key={group.id}>
                {/* A tinted band per group divides the list into sections, and
                     stays pinned while its rows scroll past. */}
                <div className="sticky top-0 z-[1] flex items-center justify-between rounded-ui-sm bg-canvas-sunken px-2 py-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">{group.name}</span>
                  {mode === 'multi' && (
                    <button
                      type="button"
                      onClick={() => onSetSelected?.(allSelected
                        ? selected.filter((v) => !childIds.includes(v))
                        : Array.from(new Set([...selected, ...childIds])))}
                      aria-label={`${allSelected ? 'Clear' : 'Select all'} ${group.name}`}
                      className="ui-focus touch-target-inline rounded-ui-xs text-[11.5px] font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
                    >
                      {allSelected ? 'Clear' : 'All'}
                    </button>
                  )}
                </div>
                <div className="py-0.5">
                  {categories.map((cat) => {
                    const idx = flatIdxById.get(cat.id) ?? 0;
                    const isSel = selected.includes(cat.id);
                    const isActive = showActive && idx === activeIdx;
                    return (
                      <button
                        key={cat.id}
                        id={optId(cat.id)}
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        tabIndex={-1}
                        onClick={() => activate(cat.id)}
                        // On touch, the tap-synthesized mousemove would leave a
                        // stray gray active row beside the green selected one.
                        // The pointer shows its place with CSS hover alone. A JS active row
                        // as well went stale on scroll, leaving two rows lit.
                        onPointerMove={(e) => { if (e.pointerType !== 'touch') setShowActive(false); }}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-ui-sm px-2 py-2 text-left transition-colors focus:outline-none max-sm:min-h-touch',
                          isSel ? 'bg-brand-softer' : isActive ? 'bg-canvas-sunken' : 'hover:bg-canvas-sunken',
                        )}
                      >
                        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-ui-sm bg-canvas-sunken text-content-secondary">
                          {taxonomyIcon(cat)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-content" title={cat.name}>
                          {categoryOptionLabel(cat)}
                        </span>
                        {isSel && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </>
        )}
      </div>
      {showManage && <div className="my-1 h-px shrink-0 bg-line" aria-hidden />}
      {showManage && (
      <button
        type="button"
        onClick={() => {
          onManage?.();
          navigate('/profile#categories');
        }}
        className={cn(
          'flex w-full shrink-0 items-center gap-2.5 rounded-ui-sm px-2 py-2 text-left text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] transition-colors max-sm:min-h-touch',
          'hover:bg-brand-softer focus:bg-brand-softer focus:outline-none',
        )}
      >
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-ui-sm bg-brand-soft text-brand">
          <Settings className="h-4 w-4" />
        </span>
        Manage categories
      </button>
      )}
    </div>
  );
}
