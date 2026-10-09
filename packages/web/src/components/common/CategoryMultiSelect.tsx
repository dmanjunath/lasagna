import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useDragControls, type PanInfo } from 'framer-motion';
import { SlidersHorizontal } from 'lucide-react';
import { Badge, Button, SegmentedControl } from '../uikit';
import { cn } from '../../lib/utils';
import { type ToolbarField } from './OptionMenu';
import { CategoryList } from './CategoryList';
import { CategoryPicker } from './CategoryPicker';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { getCategoryDisplay } from '../../lib/categories';
import { CATEGORY_ID_RE } from '../../lib/spending-filters';
import { usePickerGroups, useTaxonomy } from '../../lib/taxonomy';

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
        // see in the breakdown has to be removable from the scope. `byId`
        // carries disabled categories, so a name is missing only for an id
        // this tenant never had, and printing the raw 36 characters named
        // nothing. A legacy system key cannot match the uuid shape, so its
        // display is untouched.
        key: `cat-${id}`,
        label:
          byId.get(id)?.name ??
          (CATEGORY_ID_RE.test(id) ? 'Unavailable category' : getCategoryDisplay(id).label),
        remove: () => onChange(selected.filter((c) => c !== id)),
      });
    }
    return { chips, count: chips.length };
  }, [pickerGroups, byId, selected, onChange]);
}

/**
 * The words one scope chip wears, written once: a drill from /spending has to
 * land on chips saying the same thing about the same scope, and /transactions
 * used to render an include scope as a bare name. The prefix is also what
 * separates an include scope from the neutral date chip beside it, and each
 * chip carries its own because a single lead word ahead of the run does not
 * survive the wrap. The remove label names the plain category, not the prefix.
 */
export function scopeChipProps(
  mode: 'include' | 'exclude',
  chip: CategoryChip,
): { label: string; tone: 'brand' | 'neutral'; removeLabel: string } {
  return mode === 'exclude'
    ? { label: `Except ${chip.label}`, tone: 'neutral', removeLabel: `Stop excluding ${chip.label}` }
    : { label: `Only ${chip.label}`, tone: 'brand', removeLabel: `Remove ${chip.label} filter` };
}

// ---------------------------------------------------------------------------

export function CategoryMultiSelect({
  selected,
  onChange,
  variant,
  mode,
  describedBy,
  className,
  toolbar,
}: {
  /** On the wide transactions toolbar: name the field, tint and count while set. */
  toolbar?: ToolbarField;
  /** Category ids. */
  selected: string[];
  onChange: (ids: string[]) => void;
  variant: 'field' | 'filters';
  /** Only/Except segments above the list. Omit for a plain picker. */
  mode?: { value: 'include' | 'exclude'; onChange: (m: 'include' | 'exclude') => void };
  /**
   * Id of an element qualifying the trigger, e.g. the caption naming the
   * categories an arrived scope excludes. Without it a screen reader hears
   * "All categories" and nothing about the exclusion.
   */
  describedBy?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
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

  const panelBody = (
      <>
        {/* "Only"/"Except" — the words the chips this switch produces use.
             Labelling the switch Include/Exclude put two vocabularies for one
             concept on screen at once, both visible together. */}
        {mode && (
          <SegmentedControl
            aria-label="Keep only or leave out the chosen categories"
            value={mode.value}
            onChange={mode.onChange}
            options={[
              { value: 'include' as const, label: 'Only' },
              { value: 'exclude' as const, label: 'Except' },
            ]}
          />
        )}
        <div className={cn('flex min-h-0 flex-1 flex-col', mode && 'mt-3')}>
          <CategoryList
            mode="multi"
            selected={draft}
            onSetSelected={setDraft}
            onManage={() => setOpen(false)}
            autoFocus={!isPhone}
            scrollerClassName={isPhone ? 'flex-1' : 'max-h-[320px]'}
          />
        </div>
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

  // The field idiom is the shared category dropdown in multi mode, the same
  // list as the row's recategorize menu.
  if (variant === 'field') {
    return (
      <div className={cn('relative', className)}>
        <CategoryPicker
          multiple
          variant="select"
          values={draft}
          onChangeMany={setDraft}
          currentLabel={triggerLabel}
          toolbar={toolbar}
          describedBy={describedBy}
          className="w-full"
        />
      </div>
    );
  }

  const trigger = (
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
            <div data-sheet className="fixed inset-0 z-[100]">
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
              </motion.div>
            </div>,
            document.body,
          )
        : open && (
            <div
              ref={panelRef}
              role={variant === 'filters' ? 'dialog' : undefined}
              aria-label={variant === 'filters' ? 'Filter by category' : undefined}
              className="absolute left-0 top-full z-50 mt-2 flex w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-ui-md border border-line-strong bg-panel-raised p-4 shadow-ui-lg"
            >
              {panelBody}
            </div>
          )}
    </div>
  );
}
