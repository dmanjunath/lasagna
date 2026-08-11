import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useDragControls, type PanInfo } from 'framer-motion';
import { useLocation } from 'wouter';
import { Check, ChevronDown, Receipt, Search, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Skeleton } from '../uikit';
import { taxonomyIcon, usePickerGroups, useTaxonomy } from '../../lib/taxonomy';

// ---------------------------------------------------------------------------
// CategoryPicker - a rich dropdown for recategorizing a transaction. Follows
// AccountLinkPicker's panel/option/selected-check/footer-action idioms, plus a
// pinned search input on top and a "Manage categories" footer action.
//
// The panel portals to <body> and is fixed-positioned from the trigger rect so
// it can't be clipped by overflow-hidden ancestors (e.g. expanded groups on
// /transactions). On phones (≤639px) it renders as a bottom sheet copying the
// uikit Modal phone-tray idiom, stacked above the detail tray.
//
// Accessible: the search input is a role="combobox" whose aria-activedescendant
// tracks arrow-key navigation; the list is a role="listbox" of role="option"
// rows. Escape closes and refocuses the trigger (capture-phase, so a parent
// Modal's own Escape listener never fires while the picker is open).
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 280;

export function CategoryPicker({
  value,
  onChange,
  variant,
  currentLabel,
  onOpen,
  className,
}: {
  /** Category id (uuid) of the current selection, '' when unknown. */
  value: string;
  onChange: (categoryId: string) => void;
  /** inline = the row's category label button; field = a form-field trigger. */
  variant: 'inline' | 'field';
  /** Display label for a current value the picker can't offer (disabled/legacy). */
  currentLabel?: string;
  /** Fires when the panel opens (e.g. to dismiss a create-rule prompt). */
  onOpen?: () => void;
  className?: string;
}) {
  const pickerGroups = usePickerGroups();
  const { byId, loading, error, refresh } = useTaxonomy();
  const [, navigate] = useLocation();

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number }>({ left: 0, top: 0, maxHeight: 0 });
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Swipe-to-dismiss for the phone bottom sheet: drag starts only from the
  // grab handle (not the scrollable list) via dragControls, as in uikit Modal.
  const dragControls = useDragControls();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const listId = useId();
  const optId = (catId: string) => `${listId}-${catId}`;

  const isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

  const current = value ? byId.get(value) : undefined;
  const triggerLabel = current?.name ?? currentLabel ?? 'Other';

  // Filter: a category matches when its own name or its group's name matches.
  // Groups left with no matching categories are dropped, header included.
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

  const updatePos = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8));
    // Cap the panel to the space on its side of the trigger - the list shrinks
    // (search + footer stay pinned) instead of clipping past the viewport edge.
    if (window.innerHeight - rect.bottom < 380) {
      setPos({ left, bottom: window.innerHeight - rect.top + 6, maxHeight: rect.top - 14 });
    } else {
      setPos({ left, top: rect.bottom + 6, maxHeight: window.innerHeight - rect.bottom - 14 });
    }
  };

  const openPicker = () => {
    onOpen?.();
    setQuery('');
    if (!isPhone) updatePos();
    setOpen(true);
  };
  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };
  const pick = (id: string) => {
    if (id !== value) onChange(id);
    close(true);
  };

  // Keep the keyboard-active row on the best match: the first category whose
  // OWN name matches the query (exact name first), not a group-derived match -
  // typing an exact category name then Enter must pick that category, not the
  // first member of a group that happens to share the name.
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

  // On open: activate the selected option, focus search (desktop only - on a
  // phone autofocus would shove the keyboard over the sheet), scroll selection
  // into view.
  useEffect(() => {
    if (!open) return;
    const idx = flat.findIndex((c) => c.id === value);
    setActiveIdx(idx >= 0 ? idx : 0);
    if (!isPhone) searchRef.current?.focus();
    requestAnimationFrame(() => {
      listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Outside click closes; Escape closes and refocuses the trigger. Escape is
  // capture-phase so only the picker (the top layer) dismisses - a parent
  // Modal's document-level Escape listener never sees the event.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Desktop: reposition on any scroll/resize so the panel tracks the trigger.
  useEffect(() => {
    if (!open || isPhone) return;
    const onMove = () => updatePos();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPhone]);

  // Arrow keys move aria-activedescendant while the search input keeps focus;
  // Enter picks the active option.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      const next = e.key === 'ArrowDown' ? activeIdx + 1 : activeIdx - 1;
      const idx = (next + flat.length) % flat.length;
      setActiveIdx(idx);
      document.getElementById(optId(flat[idx].id))?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cat = flat[activeIdx];
      if (cat) pick(cat.id);
    }
  };

  const trigger =
    variant === 'inline' ? (
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Click to recategorize"
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else openPicker();
        }}
        className={cn(
          'ui-focus touch-target-inline rounded-ui-xs text-content-muted transition-colors hover:text-content hover:underline',
          className,
        )}
      >
        {triggerLabel}
      </button>
    ) : (
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else openPicker();
        }}
        className={cn(
          'flex h-11 min-h-touch w-full items-center gap-2.5 rounded-ui-md bg-panel pl-3 pr-3 text-left text-sm text-content',
          'border border-line-strong shadow-ui-sm transition-[border-color,box-shadow] duration-150 ease-ui',
          'focus:outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)]',
          className,
        )}
      >
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-ui-sm bg-canvas-sunken text-content-secondary">
          {current ? taxonomyIcon(current) : <Receipt size={15} />}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{triggerLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
      </button>
    );

  const panelBody = (
    <>
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
          className="ui-focus h-10 w-full rounded-ui-md border border-line bg-panel pl-9 pr-3 text-[13px] text-content"
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Category"
        id={listId}
        className={cn('mt-1 min-h-0 overflow-y-auto', isPhone ? 'flex-1' : 'max-h-[320px]')}
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
          visibleGroups.map(({ group, categories }) => (
            <div key={group.id}>
              <div className="px-3 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">
                {group.name}
              </div>
              {categories.map((cat) => {
                const idx = flatIdxById.get(cat.id) ?? 0;
                const isSel = cat.id === value;
                const isActive = idx === activeIdx;
                return (
                  <button
                    key={cat.id}
                    id={optId(cat.id)}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    tabIndex={-1}
                    onClick={() => pick(cat.id)}
                    // On touch, the tap-synthesized mousemove would leave a
                    // stray gray active row beside the green selected one.
                    onMouseMove={isPhone ? undefined : () => setActiveIdx(idx)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-ui-sm px-2 py-2 text-left transition-colors focus:outline-none max-sm:min-h-touch',
                      isSel ? 'bg-brand-softer' : isActive ? 'bg-canvas-sunken' : 'hover:bg-canvas-sunken',
                    )}
                  >
                    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-ui-sm bg-canvas-sunken text-content-secondary">
                      {taxonomyIcon(cat)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-content" title={cat.name}>
                      {cat.name}
                    </span>
                    {isSel && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="my-1 h-px shrink-0 bg-line" aria-hidden />
      <button
        type="button"
        onClick={() => {
          close();
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
    </>
  );

  return (
    <>
      {trigger}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          // Clicks inside the portal still bubble through the React tree to the
          // clickable transaction row, so stop them here.
          isPhone ? (
            <div className="fixed inset-0 z-[100]" onClick={(e) => e.stopPropagation()}>
              <div
                className="absolute inset-0 bg-black/45 backdrop-blur-[2px] [animation:ui-fade-in_160ms_ease-out]"
                onClick={() => close()}
                aria-hidden
              />
              <motion.div
                ref={panelRef}
                drag="y"
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.9 }}
                onDragEnd={(_e, info: PanInfo) => {
                  if (info.offset.y > 96 || info.velocity.y > 600) close();
                }}
                className="ui-root absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-ui-xl border-t border-line bg-panel-raised p-2 shadow-ui-xl [animation:ui-slide-up_220ms_cubic-bezier(0.22,1,0.36,1)]"
                // .ui-root paints the canvas background; keep the sheet raised.
                style={{ backgroundColor: 'rgb(var(--ui-panel-raised))' }}
                onKeyDown={onPanelKeyDown}
              >
                <div
                  className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5"
                  onPointerDown={(e) => dragControls.start(e)}
                >
                  <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
                </div>
                {panelBody}
              </motion.div>
            </div>
          ) : (
            <div
              ref={panelRef}
              style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                bottom: pos.bottom,
                width: PANEL_WIDTH,
                maxHeight: pos.maxHeight,
                // .ui-root paints the canvas background; keep the panel raised.
                backgroundColor: 'rgb(var(--ui-panel-raised))',
              }}
              className="ui-root z-[95] flex flex-col rounded-ui-md border border-line bg-panel-raised p-1 shadow-ui-lg"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={onPanelKeyDown}
            >
              {panelBody}
            </div>
          ),
          document.body,
        )}
    </>
  );
}
