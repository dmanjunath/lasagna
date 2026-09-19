import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useDragControls, type PanInfo } from 'framer-motion';
import { ChevronDown, Layers, Search, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, SegmentedControl, Skeleton } from '../uikit';
import { cn } from '../../lib/utils';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { getCategoryDisplay } from '../../lib/categories';
import { categoryOptionLabel, taxonomyIcon, usePickerGroups, useTaxonomy } from '../../lib/taxonomy';

// ---------------------------------------------------------------------------
// CategoryMultiSelect — the ONE grouped category picker: a tri-state group row
// that selects all its children, indented category rows, and a fully-selected
// group collapsed back into a single named chip.
//
// Selection is stored as CATEGORY IDS ONLY. A group is a selection shortcut,
// never a stored value — categories.groupId is a NOT NULL column, so "the
// categories in that group" is a lossless restatement of "that group", and the
// collapse back to a group name is derived (see useCategoryChips).
//
// Group contract, the shipped Finder/Gmail/GitHub one: checked when EVERY child
// is selected, indeterminate when only some are, and clicking a partially
// selected group selects ALL of it (partial → all → none → all).
//
// Two idioms, because two pages ask a different question with it:
//   'field'   — /transactions' Category slot inside its Filters panel: a
//               select-style trigger naming the selection, over a bare list.
//   'filters' — /spending's scope row: a Filters button with a count badge,
//               over a panel that also carries the include/exclude switch, a
//               search input, category glyphs and a Done footer.
//
// On phones (≤639px) both render as a bottom sheet copying CategoryPicker's
// tray idiom. As a nested popover the list used to escape its parent panel and
// cover the page with no reachable way back.
// ---------------------------------------------------------------------------

export interface CategoryChip {
  key: string;
  label: string;
  remove: () => void;
}

/**
 * The selection as the user reads it: a fully-selected group is ONE chip named
 * after the group, and anything left over is its own chip. The count the
 * trigger badge shows is this list's length, so the badge, the trigger label
 * and the chips can never disagree about how a group is counted.
 */
export function useCategoryChips(
  selected: string[],
  onChange: (ids: string[]) => void,
): { chips: CategoryChip[]; count: number } {
  const pickerGroups = usePickerGroups();
  const { byId } = useTaxonomy();

  return useMemo(() => {
    const consumed = new Set<string>();
    const chips: CategoryChip[] = [];
    for (const { group, categories } of pickerGroups) {
      const childIds = categories.map((c) => c.id);
      if (childIds.length > 0 && childIds.every((id) => selected.includes(id))) {
        childIds.forEach((id) => consumed.add(id));
        chips.push({
          key: `grp-${group.id}`,
          label: group.name,
          remove: () => onChange(selected.filter((id) => !childIds.includes(id))),
        });
      }
    }
    for (const id of selected) {
      if (consumed.has(id)) continue;
      chips.push({
        // A disabled or cross-tenant id still gets a chip — a row the user can
        // see in the breakdown has to be removable from the scope.
        key: `cat-${id}`,
        label: byId.get(id)?.name ?? getCategoryDisplay(id).label,
        remove: () => onChange(selected.filter((c) => c !== id)),
      });
    }
    return { chips, count: chips.length };
  }, [pickerGroups, byId, selected, onChange]);
}

// ---------------------------------------------------------------------------

export function CategoryMultiSelect({
  selected,
  onChange,
  variant,
  mode,
  className,
}: {
  /** Category ids. */
  selected: string[];
  onChange: (ids: string[]) => void;
  variant: 'field' | 'filters';
  /** Include/exclude segments above the list. Omit for a plain picker. */
  mode?: { value: 'include' | 'exclude'; onChange: (m: 'include' | 'exclude') => void };
  className?: string;
}) {
  const pickerGroups = usePickerGroups();
  const { loading, error, refresh } = useTaxonomy();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dragControls = useDragControls();

  const isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
  // The sheet floats over a document that still scrolls, so a drag on a short
  // list would slide the page underneath instead.
  useBodyScrollLock(open && isPhone);

  // Applies live, debounced: the checkboxes answer instantly while the page
  // behind them refetches once, after the user stops clicking.
  const [draft, setDraft] = useState(selected);
  const emittedRef = useRef(selected.join(','));
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const selectedKey = selected.join(',');
  useEffect(() => {
    // An external change (a chip's ×, Clear all, a URL hydrate) replaces the
    // draft; our own pending emit coming back does not.
    if (selectedKey === emittedRef.current) return;
    emittedRef.current = selectedKey;
    setDraft(selectedKey === '' ? [] : selectedKey.split(','));
  }, [selectedKey]);

  useEffect(() => {
    const key = draft.join(',');
    if (key === emittedRef.current) return;
    const timer = setTimeout(() => {
      emittedRef.current = key;
      onChangeRef.current(draft);
    }, 250);
    return () => clearTimeout(timer);
  }, [draft]);

  const { chips } = useCategoryChips(draft, setDraft);
  const count = chips.length;

  // Outside click closes; Escape closes and refocuses the trigger.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || wrapRef.current?.contains(t)) return;
      setOpen(false);
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

  // Search (filters variant only): a category matches on its own name or its
  // group's, and a group left with no match drops out, header included.
  const q = variant === 'filters' ? query.trim().toLowerCase() : '';
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

  const toggleCategory = (id: string) => {
    setDraft((cur) => (cur.includes(id) ? cur.filter((v) => v !== id) : [...cur, id]));
  };

  const withIcons = variant === 'filters';

  const list = (
    <div
      className={cn(
        isPhone
          // A hairline for the scrolled list to run under. Without it the rows
          // pass straight into the pinned search input and read as its content.
          ? 'mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line'
          : variant === 'filters'
            ? 'mt-2 max-h-[320px] overflow-y-auto overscroll-contain rounded-ui-sm border border-line'
            // The field popover IS the scroller, so its own max-height bounds
            // the list — as it did before the lift, to the pixel.
            : '',
      )}
    >
      {loading && pickerGroups.length === 0 ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2">
            <Skeleton className="h-4 w-4 rounded-ui-xs" />
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
      ) : visibleGroups.length === 0 ? (
        <div className="px-3 py-3 text-[13px] text-content-muted">No categories match</div>
      ) : (
        visibleGroups.map(({ group, categories }) => {
          const childIds = categories.map((c) => c.id);
          const allSelected = childIds.every((v) => draft.includes(v));
          const someSelected = childIds.some((v) => draft.includes(v));
          return (
            <React.Fragment key={group.id}>
              {/* Selectable group header: a shaded "select all in group" row
                   that reads as a section — a Layers glyph + bold dark label
                   mark it as the parent; children render indented beneath. */}
              <label className={cn(
                'flex min-h-touch cursor-pointer items-center gap-2.5 border-y border-line bg-canvas-sunken px-3 py-2 first:border-t-0 hover:bg-line/70',
                // 48 rows, 7 visible: the section a row belongs to has to stay
                // on screen while you scroll past it. Only the filters panel —
                // sticky promotes the row, and the transactions field popover
                // is held pixel-identical to what it rendered before the lift.
                variant === 'filters' && 'sticky top-0 z-[1]',
              )}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={() => {
                    setDraft((cur) =>
                      allSelected
                        ? cur.filter((v) => !childIds.includes(v))
                        : Array.from(new Set([...cur, ...childIds])),
                    );
                  }}
                  className="h-4 w-4 rounded border-line accent-[rgb(var(--ui-brand))]"
                />
                <Layers size={13} className="shrink-0 text-content-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-content" title={group.name}>
                  {group.name}
                </span>
              </label>
              {categories.map((cat) => (
                <label
                  key={cat.id}
                  className="flex min-h-touch cursor-pointer items-center gap-2.5 py-2 pl-9 pr-3 hover:bg-canvas-sunken"
                >
                  <input
                    type="checkbox"
                    checked={draft.includes(cat.id)}
                    onChange={() => toggleCategory(cat.id)}
                    className="h-4 w-4 rounded border-line accent-[rgb(var(--ui-brand))]"
                  />
                  {withIcons && (
                    <span
                      className="grid h-5 w-5 shrink-0 place-items-center text-content-muted [&>svg]:h-[15px] [&>svg]:w-[15px]"
                      aria-hidden
                    >
                      {taxonomyIcon(cat)}
                    </span>
                  )}
                  <span
                    className="min-w-0 flex-1 truncate text-[13px] font-medium text-content"
                    title={cat.name}
                  >
                    {categoryOptionLabel(cat)}
                  </span>
                </label>
              ))}
            </React.Fragment>
          );
        })
      )}
    </div>
  );

  const panelBody =
    variant === 'field' ? (
      list
    ) : (
      <>
        {mode && (
          <SegmentedControl
            aria-label="Include or exclude categories"
            value={mode.value}
            onChange={mode.onChange}
            options={[
              { value: 'include' as const, label: 'Include' },
              { value: 'exclude' as const, label: 'Exclude' },
            ]}
          />
        )}
        <div className={cn('relative shrink-0', mode && 'mt-3')}>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
          <input
            type="text"
            placeholder="Search categories"
            aria-label="Search categories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ui-focus h-10 w-full rounded-ui-md border border-line bg-panel pl-9 pr-3 text-[13px] text-content"
          />
        </div>
        {list}
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full shrink-0"
          onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
        >
          Done
        </Button>
      </>
    );

  // Collapse fully-selected groups into the trigger label too, so it agrees
  // with the chips (a whole group counts as one, shown by name).
  const triggerLabel =
    count === 0 ? 'All categories' : count === 1 ? chips[0].label : `${count} categories`;

  const trigger =
    variant === 'field' ? (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="ui-focus touch-target relative h-10 w-full appearance-none truncate rounded-ui-md border border-line bg-panel pl-3 pr-9 text-left text-[13px] font-medium text-content shadow-ui-sm"
      >
        {triggerLabel}
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" />
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="ui-focus touch-target inline-flex h-10 shrink-0 items-center gap-2 rounded-ui-md border border-line bg-panel px-3 text-[13px] font-medium text-content shadow-ui-sm transition-colors hover:bg-canvas-sunken"
      >
        <SlidersHorizontal size={14} className="text-content-muted" aria-hidden />
        Filters
        {count > 0 && <Badge tone="brand" size="sm">{count}</Badge>}
      </button>
    );

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      {trigger}
      {open && isPhone && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[100]">
              <div
                className="absolute inset-0 bg-black/45 backdrop-blur-[2px] [animation:ui-fade-in_160ms_ease-out]"
                onClick={() => setOpen(false)}
                aria-hidden
              />
              <motion.div
                ref={panelRef}
                role={variant === 'filters' ? 'dialog' : undefined}
                aria-label={variant === 'filters' ? 'Filter by category' : undefined}
                drag="y"
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.9 }}
                onDragEnd={(_e, info: PanInfo) => {
                  if (info.offset.y > 96 || info.velocity.y > 600) setOpen(false);
                }}
                className="ui-root absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-ui-xl border-t border-line bg-panel-raised px-3 pb-3 shadow-ui-xl [animation:ui-slide-up_220ms_cubic-bezier(0.22,1,0.36,1)]"
                // .ui-root paints the canvas background; keep the sheet raised.
                style={{ backgroundColor: 'rgb(var(--ui-panel-raised))' }}
              >
                <div
                  className="flex shrink-0 cursor-grab touch-none justify-center pb-2 pt-2.5"
                  onPointerDown={(e) => dragControls.start(e)}
                >
                  <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
                </div>
                {panelBody}
                {/* The field variant has no footer on desktop; on a sheet the
                     list fills the tray, so it needs a way back that isn't a
                     blind tap on the scrim. */}
                {variant === 'field' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3 w-full shrink-0"
                    onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
                  >
                    Done
                  </Button>
                )}
              </motion.div>
            </div>,
            document.body,
          )
        : open && (
            <div
              ref={panelRef}
              role={variant === 'filters' ? 'dialog' : undefined}
              aria-label={variant === 'filters' ? 'Filter by category' : undefined}
              className={cn(
                'absolute left-0 top-full z-50 rounded-ui-md border border-line-strong bg-panel-raised shadow-ui-lg',
                variant === 'field'
                  ? 'mt-1 max-h-[320px] w-full min-w-[200px] overflow-y-auto'
                  : 'mt-2 w-[min(380px,calc(100vw-2rem))] overflow-hidden p-4',
              )}
            >
              {panelBody}
            </div>
          )}
    </div>
  );
}
