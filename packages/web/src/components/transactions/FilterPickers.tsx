import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Button, SegmentedControl } from '../uikit';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { useSheetDrag } from '../../lib/hooks/use-sheet-drag';
import { PickerSearch, SelectAllBar } from '../common/PickerBits';
import { ITEM_CLASS, PANEL_CLASS, TriggerInner, triggerClass, type ToolbarField } from '../common/OptionMenu';
import { EMPTY_FILTERS, STATUS_FIELDS, filtersToSearchParams, filtersFromQuery, type TxnFilters } from './TransactionFilters';

// ---------------------------------------------------------------------------
// The universal filter's own pickers (owner decision 2026-11-23): Merchant,
// Status and saved Views. Each opens the same panel the Account and Category
// pickers open (a popover, a bottom sheet on phones).
// ---------------------------------------------------------------------------

/** The trigger plus its popover (a sheet on phones), as AccountPicker opens. */
function PickerShell({
  label,
  toolbar,
  title,
  children,
  className,
  panelClassName,
}: {
  label: string;
  toolbar?: ToolbarField;
  title: string;
  children: (close: () => void) => React.ReactNode;
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
  useBodyScrollLock(open && isPhone);
  const sheetY = useSheetDrag({ enabled: open && isPhone, onClose: () => setOpen(false), rootRef: sheetRef, panelRef });
  // Focus goes back to the trigger after a close, in an effect: render never reads the ref.
  const [refocus, setRefocus] = useState(false);
  const close = () => { setOpen(false); setRefocus(true); };
  useEffect(() => {
    if (!refocus) return;
    triggerRef.current?.focus();
    setRefocus(false);
  }, [refocus]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      className={cn('absolute left-0 top-full flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-1.5 p-2', PANEL_CLASS, panelClassName)}
    >
      {children(close)}
    </div>
  );

  const sheet = (
    <div ref={sheetRef} data-sheet className="fixed inset-0 z-[100]" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px] [animation:ui-fade-in_160ms_ease-out]" onClick={() => setOpen(false)} aria-hidden />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        className="ui-root absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col gap-1.5 rounded-t-ui-xl border-t border-line p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-ui-xl [animation:ui-slide-up_220ms_cubic-bezier(0.22,1,0.36,1)]"
        style={{ backgroundColor: 'rgb(var(--ui-panel-raised))', y: sheetY }}
      >
        <div className="flex shrink-0 justify-center pb-1" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>
        {children(close)}
        <Button variant="neutral" size="sm" className="mt-1 w-full shrink-0" onClick={close}>Done</Button>
      </motion.div>
    </div>
  );

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn('group/trigger', triggerClass(toolbar))}
      >
        <TriggerInner label={label} toolbar={toolbar} />
      </button>
      {open && (isPhone ? (typeof document !== 'undefined' ? createPortal(sheet, document.body) : null) : panel)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MerchantPicker — the merchants in the data with their counts, searchable,
// several at a time. Exact names, so a pick matches what the rows show.
// ---------------------------------------------------------------------------

export function MerchantPicker({
  selected,
  onChange,
  toolbar,
}: {
  selected: string[];
  onChange: (names: string[]) => void;
  toolbar?: ToolbarField;
}) {
  const label = selected.length === 0 ? 'All merchants' : selected.length === 1 ? selected[0] : `${selected.length} merchants`;
  return (
    <PickerShell label={label} toolbar={toolbar} title="Merchant">
      {() => <MerchantList selected={selected} onChange={onChange} />}
    </PickerShell>
  );
}

function MerchantList({ selected, onChange }: { selected: string[]; onChange: (names: string[]) => void }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Array<{ name: string; count: number }> | null>(null);
  const [failed, setFailed] = useState(false);

  // The server narrows by name, so a long merchant list stays one request per pause in typing.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.getMerchantCounts(query.trim() || undefined)
        .then((r) => { if (live) { setRows(r.counts ?? r.merchants.map((name) => ({ name, count: 0 }))); setFailed(false); } })
        .catch(() => { if (live) setFailed(true); });
    }, query ? 200 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  // Picked merchants stay listed even when the search hides them, so they can be unticked.
  const visible = rows ?? [];
  const names = visible.map((r) => r.name);
  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);

  return (
    <>
      {/* Focus the search only with a mouse: on a phone the keyboard would cover the list. */}
      <PickerSearch value={query} onChange={setQuery} placeholder="Search merchants" autoFocus={finePointer()} />
      <SelectAllBar
        disabled={names.length === 0}
        onAll={() => onChange([...new Set([...selected, ...names])])}
        onNone={() => onChange(query ? selected.filter((n) => !names.includes(n)) : [])}
      />
      <div className="max-h-[300px] min-h-0 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
        {failed ? (
          <div className="px-2 py-3 text-[13px] text-content-muted">Merchants failed to load.</div>
        ) : rows === null ? (
          <div className="px-2 py-3 text-[13px] text-content-muted">Loading merchants</div>
        ) : visible.length === 0 ? (
          <div className="px-2 py-3 text-[13px] text-content-muted">No merchants match</div>
        ) : (
          visible.map((r) => (
            <label key={r.name} className={cn(ITEM_CLASS, 'focus-within:bg-canvas-sunken')}>
              <input
                type="checkbox"
                checked={selected.includes(r.name)}
                onChange={() => toggle(r.name)}
                className="h-4 w-4 rounded border-line accent-[rgb(var(--ui-brand))]"
              />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {r.count > 0 && <span className="shrink-0 text-[12px] tabular-nums text-content-muted">{r.count}</span>}
            </label>
          ))
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// StatusFields — pending, excluded, recurring, added by. One choice each.
// ---------------------------------------------------------------------------

export function StatusFields({ filters, onChange }: { filters: TxnFilters; onChange: (f: TxnFilters) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {STATUS_FIELDS.map((s) => (
        <div key={s.key}>
          <div className="mb-1 text-[12px] font-medium text-content-muted">{s.label}</div>
          <SegmentedControl
            aria-label={s.label}
            value={filters[s.key]}
            onChange={(v) => onChange({ ...filters, [s.key]: v })}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'only', label: 'Only' },
              { value: 'hide', label: 'Hide' },
            ]}
          />
        </div>
      ))}
      <div>
        <div className="mb-1 text-[12px] font-medium text-content-muted">Added by</div>
        <SegmentedControl
          aria-label="Added by"
          value={filters.source}
          onChange={(source) => onChange({ ...filters, source })}
          options={[
            { value: 'any', label: 'Any' },
            { value: 'bank', label: 'Bank' },
            { value: 'manual', label: 'You' },
          ]}
        />
      </div>
    </div>
  );
}

export function StatusPicker({ filters, onChange, toolbar }: { filters: TxnFilters; onChange: (f: TxnFilters) => void; toolbar?: ToolbarField }) {
  const set = STATUS_FIELDS.filter((s) => filters[s.key] !== 'any').length + (filters.source !== 'any' ? 1 : 0);
  return (
    <PickerShell label={set === 0 ? 'Any status' : `${set} set`} toolbar={toolbar} title="Status" panelClassName="p-3">
      {() => <StatusFields filters={filters} onChange={onChange} />}
    </PickerShell>
  );
}

// ---------------------------------------------------------------------------
// Saved views — a named set of filters, kept on this device (owner decision:
// stored on the client). The search term is part of a view.
// ---------------------------------------------------------------------------

export const VIEWS_STORAGE_KEY = 'lf-txn-views';
export type SavedView = { name: string; query: string };

export function readViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.name === 'string' && typeof v.query === 'string') : [];
  } catch {
    return [];
  }
}

const VIEWS_EVENT = 'lf-txn-views-change';

function writeViews(views: SavedView[]) {
  try {
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // storage unavailable: the view lasts until the page closes
  }
  // Every views picker on the page (inline, under More, the phone panel) shows the same list.
  window.dispatchEvent(new Event(VIEWS_EVENT));
}

/** The saved views, kept in step across every picker and other tabs. */
function useSavedViews(): SavedView[] {
  const [views, setViews] = useState<SavedView[]>(readViews);
  useEffect(() => {
    const sync = () => setViews(readViews());
    sync();
    window.addEventListener(VIEWS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(VIEWS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return views;
}

/** The saved view these filters match exactly, if any. */
export function matchingView(views: SavedView[], f: TxnFilters): SavedView | undefined {
  const q = filtersToSearchParams(f);
  return q ? views.find((v) => v.query === q) : undefined;
}

export function ViewsPicker({ filters, onChange, toolbar, onApplied }: { filters: TxnFilters; onChange: (f: TxnFilters) => void; toolbar?: ToolbarField; /** After a view is applied, so the panel holding the picker can close. */ onApplied?: () => void }) {
  const views = useSavedViews();
  const [name, setName] = useState('');
  const current = matchingView(views, filters);
  const canSave = filtersToSearchParams(filters) !== '' && !current;

  const save = () => {
    const n = name.trim();
    if (!n) return;
    writeViews([...views.filter((v) => v.name !== n), { name: n, query: filtersToSearchParams(filters) }]);
    setName('');
  };
  const remove = (n: string) => {
    writeViews(views.filter((v) => v.name !== n));
  };

  return (
    <PickerShell label={current ? current.name : views.length > 0 ? 'Choose a view' : 'No saved views'} toolbar={toolbar ? { ...toolbar, count: current ? 1 : 0, badge: false } : undefined} title="Saved views">
      {(close) => (
        <>
          {views.length === 0 ? (
            <div className="px-2 py-2 text-[13px] text-content-muted">No saved views yet.</div>
          ) : (
            <div className="max-h-[240px] overflow-y-auto">
              {views.map((v) => (
                <div key={v.name} className={cn(ITEM_CLASS, 'cursor-default gap-1 p-0', current?.name === v.name && 'bg-brand-softer')}>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate px-2 py-2 text-left"
                    onClick={() => { onChange({ ...EMPTY_FILTERS, ...filtersFromQuery(`?${v.query}`) }); close(); onApplied?.(); }}
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${v.name}`}
                    onClick={() => remove(v.name)}
                    className="ui-focus mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-content-muted hover:bg-content/10 hover:text-content"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {canSave && (
            <form
              className="flex items-center gap-2 border-t border-line px-1 pt-2"
              onSubmit={(e) => { e.preventDefault(); save(); }}
            >
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name this view"
                aria-label="View name"
                maxLength={40}
                className="h-9 min-w-0 flex-1 rounded-ui-md border border-line bg-panel px-3 text-[13px] text-content focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)] focus:outline-none"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={!name.trim()}>Save view</Button>
            </form>
          )}
        </>
      )}
    </PickerShell>
  );
}

/** A mouse or trackpad: where focusing a field on open helps instead of raising a keyboard. */
function finePointer(): boolean {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}
