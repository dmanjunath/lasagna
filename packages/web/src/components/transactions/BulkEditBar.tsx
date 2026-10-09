import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Field, Modal, Textarea } from '../uikit';
import { CategoryPicker } from '../common/CategoryPicker';
import { ITEM_CLASS, PANEL_CLASS } from '../common/OptionMenu';
import { cn } from '../../lib/utils';
import { MerchantNameInput } from './MerchantNameInput';

/** merchantName null clears a rename (only Undo sends it). */
export type BulkEdit = { category?: string; merchantName?: string | null; notes?: string; excluded?: boolean };

// ---------------------------------------------------------------------------
// BulkEditBar — floats over the bottom of the list while transactions are
// selected. Every action applies one value to the whole selection.
// ---------------------------------------------------------------------------

export function BulkEditBar({
  count,
  shownCount,
  allShownSelected,
  anyIncluded,
  anyExcluded,
  busy,
  onSelectAll,
  onClear,
  onApply,
  variant,
}: {
  /** floating = the phone bar over the list. toolbar = in place of the page's sticky toolbar (sm+). */
  variant: 'floating' | 'toolbar';
  count: number;
  /** Rows loaded on the page. "Select all" can only reach these. */
  shownCount: number;
  allShownSelected: boolean;
  anyIncluded: boolean;
  anyExcluded: boolean;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onApply: (edit: BulkEdit) => Promise<boolean>;
}) {
  const [dialog, setDialog] = useState<'rename' | 'note' | null>(null);
  const [text, setText] = useState('');

  const openDialog = (kind: 'rename' | 'note') => {
    setText('');
    setDialog(kind);
  };
  const submitDialog = async () => {
    const edit = dialog === 'rename' ? { merchantName: text.trim() } : { notes: text };
    if (await onApply(edit)) setDialog(null);
  };
  const clearNotes = async () => {
    if (await onApply({ notes: '' })) setDialog(null);
  };
  const plural = count === 1 ? 'transaction' : 'transactions';

  // The phone bar sits where toasts stack, so while it shows, toasts lift by
  // its height (--ui-toast-lift, read by the toast container) to stay clear.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (variant !== 'floating' || !el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--ui-toast-lift', el.offsetHeight > 0 ? `${el.offsetHeight + 8}px` : '0px');
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--ui-toast-lift'); };
  }, [variant]);
  const actions: BulkAction[] = [
    ...(anyIncluded ? [{ key: 'exclude', label: 'Exclude', run: () => onApply({ excluded: true }) }] : []),
    ...(anyExcluded ? [{ key: 'include', label: 'Include', run: () => onApply({ excluded: false }) }] : []),
    { key: 'rename', label: 'Rename', run: () => openDialog('rename') },
    { key: 'note', label: 'Note', run: () => openDialog('note') },
  ];

  return (
    <>
      <div
        ref={barRef}
        role="toolbar"
        aria-label="Edit selected transactions"
        className={variant === 'floating'
          // Phones: above the bottom tab bar, which is fixed under it until md.
          ? 'fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),0.5rem)+4.5rem)] z-40 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-ui-xl border border-line-strong bg-panel-raised px-3 py-2.5 shadow-ui-lg sm:flex-nowrap sm:gap-4 sm:px-4 md:bottom-4'
          : 'flex min-h-10 items-center gap-4'}
      >
        {/* Phones: the count on the first row, actions on the second. The list
             header's Done ends selection there. Toolbar: one row, Done last. */}
        <div className="order-1 flex min-w-0 flex-1 items-center gap-3 sm:flex-none sm:shrink-0">
          <span className="whitespace-nowrap text-[13px] font-bold text-content" aria-live="polite">
            {count === 0 ? (variant === 'floating' ? 'Tap transactions to select' : 'Select transactions') : `${count} selected`}
          </span>
          {!allShownSelected && (
            <button
              type="button"
              onClick={onSelectAll}
              className="ui-focus touch-target-inline whitespace-nowrap rounded-ui-xs text-[13px] font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
            >
              Select all {shownCount} shown
            </button>
          )}
        </div>
{variant === 'toolbar' ? (
          <Button variant="secondary" size="sm" className="order-3 ml-auto shrink-0" onClick={onClear}>Done</Button>
        ) : null}
        {count > 0 && (variant === 'floating' ? (
          // One row on phones: it scrolls sideways rather than wrapping.
          <div className="order-3 -mx-3 flex w-[calc(100%+1.5rem)] items-center gap-2 overflow-x-auto px-3 sm:order-2 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0 [&>*]:shrink-0">
            <CategoryPicker variant="action" value="" currentLabel="Category" onChange={(id) => onApply({ category: id })} />
            {actions.map((a) => (
              <Button key={a.key} variant="secondary" size="sm" disabled={busy} onClick={a.run}>{a.label}</Button>
            ))}
          </div>
        ) : (
          // Toolbar: one line. Actions that don't fit go under More, the same
          // way the filter row overflows.
          <ToolbarActions busy={busy} actions={actions} onCategory={(id) => onApply({ category: id })} />
        ))}
      </div>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'rename' ? `Rename ${count} ${plural}` : `Note on ${count} ${plural}`}
        footer={
          <>
            {/* Clearing is its own deliberate action, never what an empty
                 field's Enter or Apply does. */}
            {dialog === 'note' && (
              <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => clearNotes()}>Clear notes</Button>
            )}
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={text.trim() === ''}
              onClick={submitDialog}
            >
              Apply
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim() !== '') submitDialog(); }}>
          {dialog === 'rename' ? (
            <Field label="Merchant name" htmlFor="bulk-merchant">
              <MerchantNameInput id="bulk-merchant" autoFocus value={text} onChange={setText} />
            </Field>
          ) : (
            <Field label="Note" htmlFor="bulk-note" hint="Replaces any note already on these transactions.">
              <Textarea id="bulk-note" autoFocus rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          )}
        </form>
      </Modal>
    </>
  );
}

type BulkAction = { key: string; label: string; run: () => void };

function ToolbarActions({ actions, busy, onCategory }: {
  actions: BulkAction[];
  busy: boolean;
  onCategory: (categoryId: string) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(actions.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const area = areaRef.current;
    const measure = measureRef.current;
    if (!area || !measure) return;
    const GAP = 8;
    const run = () => {
      // Children: Category, each action, then More.
      const w = (Array.from(measure.children) as HTMLElement[]).map((k) => k.offsetWidth);
      const more = w[w.length - 1];
      const widths = w.slice(1, -1);
      const avail = area.clientWidth - w[0];
      const all = widths.reduce((a, x) => a + GAP + x, 0);
      if (all <= avail) { setFit(widths.length); return; }
      let used = GAP + more;
      let n = 0;
      for (const x of widths) {
        if (used + GAP + x > avail) break;
        used += GAP + x;
        n++;
      }
      setFit(n);
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(area);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [actions.length]);

  const moreRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    // Capture phase, and stopped there: Escape closes this menu only, never
    // the page's selection mode behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMenuOpen(false);
      moreRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [menuOpen]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') setMenuOpen(false);
  };

  const shown = actions.slice(0, fit);
  const rest = actions.slice(fit);
  const moreButton = (live: boolean) => (
    <Button
      ref={live ? moreRef : undefined}
      variant="secondary"
      size="sm"
      disabled={live && busy}
      tabIndex={live ? undefined : -1}
      aria-haspopup={live ? 'menu' : undefined}
      aria-expanded={live ? menuOpen : undefined}
      onClick={live ? () => setMenuOpen((v) => !v) : undefined}
    >
      More <ChevronDown size={15} className={cn('text-content-muted transition-transform duration-150', live && menuOpen && 'rotate-180')} aria-hidden />
    </Button>
  );

  return (
    <div ref={areaRef} className="relative order-2 min-w-0 flex-1">
      <div className="flex items-center gap-2 [&>*]:shrink-0">
        <CategoryPicker variant="action" value="" currentLabel="Category" onChange={onCategory} />
        {shown.map((a) => (
          <Button key={a.key} variant="secondary" size="sm" disabled={busy} onClick={a.run}>{a.label}</Button>
        ))}
        {rest.length > 0 && (
          <div ref={menuRef} className="relative">
            {moreButton(true)}
            {menuOpen && (
              <div ref={listRef} role="menu" onKeyDown={onMenuKey} className={cn('absolute left-0 top-full min-w-[160px]', PANEL_CLASS)}>
                {rest.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={busy}
                    onClick={() => { setMenuOpen(false); a.run(); }}
                    className={ITEM_CLASS}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <div ref={measureRef} inert className="absolute left-0 top-0 flex w-max items-center gap-2">
          <CategoryPicker variant="action" value="" currentLabel="Category" onChange={() => {}} />
          {actions.map((a) => <Button key={a.key} variant="secondary" size="sm">{a.label}</Button>)}
          {moreButton(false)}
        </div>
      </div>
    </div>
  );
}
