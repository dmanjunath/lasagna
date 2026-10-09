import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { InstIcon } from './InstIcon';
import { ITEM_CLASS, PANEL_CLASS, TriggerInner, triggerClass } from './OptionMenu';

// ---------------------------------------------------------------------------
// AccountLinkPicker — choosing an account to link (property → mortgage,
// mortgage → property). The same trigger, panel, rows and phone bottom sheet
// as AccountPicker, plus an optional "Add" row at the bottom for creating the
// counterpart when none exists.
//
// The panel renders in <body>, fixed under the trigger, because one host is
// the add-account modal, whose body clips overflow. It opens upward when the
// trigger sits too close to the bottom of the window.
// ---------------------------------------------------------------------------

export interface AccountPickerOption {
  id: string;
  name: string;
  /** Institution display name, for the logo. */
  institution: string;
  /** Second line under the name (e.g. "Mortgage"). Falls back to the institution. */
  meta?: string;
  /** Account type. Options spanning more than one type sit under tinted bands. */
  type?: string;
  isManual?: boolean;
  mask?: string | null;
}

export interface AccountLinkPickerProps {
  options: AccountPickerOption[];
  /** Currently selected account id, or '' for none. */
  value: string;
  onChange: (id: string) => void;
  /** Placeholder shown on the trigger when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  /** Optional "+ Add …" action rendered as the last row (create counterpart). */
  addLabel?: string;
  onAdd?: () => void;
  /** The row that clears a choice. Defaults to the placeholder ("No property"). */
  noneLabel?: string;
  className?: string;
}

// The same bands, in the same order, as AccountPicker.
const TYPE_BANDS: Array<[string, string]> = [
  ['depository', 'Cash'],
  ['credit', 'Credit cards'],
  ['investment', 'Investments'],
  ['real_estate', 'Property'],
  ['alternative', 'Other assets'],
  ['loan', 'Loans'],
];
const bandRank = (type?: string) => {
  const i = TYPE_BANDS.findIndex(([t]) => t === type);
  return i === -1 ? TYPE_BANDS.length : i;
};
const bandLabel = (type?: string) => TYPE_BANDS.find(([t]) => t === type)?.[1] ?? 'Other';

const PANEL_MAX_H = 320;

export function AccountLinkPicker({
  options,
  value,
  onChange,
  placeholder = 'Choose an account',
  disabled,
  addLabel,
  onAdd,
  noneLabel,
  className,
}: AccountLinkPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
  // The sheet floats over a document that still scrolls.
  useBodyScrollLock(open && isPhone);

  const selected = options.find((o) => o.id === value) ?? null;

  const close = (returnFocus = false) => {
    setOpen(false);
    setPos(null);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    }
    // Capture phase, stopped there: Escape closes this menu only, not a
    // modal or panel it sits in.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(true);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  // Under the trigger, or over it when the list's height doesn't fit below.
  // Before the panel has rendered its height is unknown, so the cap stands in,
  // and the layout effect below places it again once it can be measured.
  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const h = Math.min(PANEL_MAX_H, panelRef.current?.scrollHeight ?? PANEL_MAX_H);
    const up = window.innerHeight - r.bottom < h + 12 && r.top > window.innerHeight - r.bottom;
    const next = up
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6 }
      : { left: r.left, width: r.width, top: r.bottom };
    setPos((prev) =>
      prev && prev.left === next.left && prev.width === next.width && prev.top === next.top && prev.bottom === next.bottom
        ? prev
        : next);
  };
  useEffect(() => {
    if (!open || isPhone) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPhone]);
  // Measured, before paint: the first open no longer flips up on the cap.
  useLayoutEffect(() => {
    if (open && !isPhone && pos) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPhone, pos]);

  // Opening moves focus to the selected (or first) row. Arrows, Home and End
  // walk the rows and the Add row, and Tab out of the list closes it.
  useEffect(() => {
    if (!open || (!isPhone && !pos)) return;
    const rows = panelRef.current?.querySelectorAll<HTMLElement>('[role="option"], [data-add]');
    const sel = panelRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    (sel ?? rows?.[0])?.focus();
    // Only on open: re-placing the panel on scroll must not steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPhone, pos === null]);
  const onListKey = (e: React.KeyboardEvent) => {
    const rows = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="option"], [data-add]') ?? []);
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); rows[(n + rows.length) % rows.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'Tab') close();
  };

  const pick = (id: string) => { onChange(id); close(true); };

  const sorted = [...options].sort((a, b) => bandRank(a.type) - bandRank(b.type));
  const banded = new Set(options.map((o) => o.type)).size > 1;

  const rows = (
    <>
      {options.length === 0 && !onAdd && (
        <div className="px-2 py-2.5 text-[13px] text-content-muted">No accounts to link yet.</div>
      )}
      {/* Clears the choice, as AccountPicker's "any" row does. Only once
          something is chosen: before that it would say what the trigger says. */}
      {value !== '' && (
        <button
          type="button"
          role="option"
          aria-selected={false}
          tabIndex={-1}
          onClick={() => pick('')}
          className={cn(ITEM_CLASS, 'text-content-secondary')}
        >
          <span className="min-w-0 flex-1 truncate">{noneLabel ?? placeholder}</span>
        </button>
      )}
      {sorted.map((o, i) => {
        const isSel = o.id === value;
        const band = banded && bandLabel(o.type) !== (i > 0 ? bandLabel(sorted[i - 1].type) : null);
        return (
          <React.Fragment key={o.id}>
            {band && (
              // The same tinted section band as the account and category menus.
              <div className="mt-0.5 rounded-ui-sm bg-canvas-sunken px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted first:mt-0">
                {bandLabel(o.type)}
              </div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={isSel}
              tabIndex={-1}
              onClick={() => pick(o.id)}
              className={cn(ITEM_CLASS, isSel && 'bg-brand-softer hover:bg-brand-softer')}
            >
              <InstIcon institution={o.institution} isManual={!!o.isManual} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-content">{o.name}</span>
                <span className="block truncate text-[11.5px] text-content-muted">
                  {o.meta ?? o.institution}{o.mask ? ` ••${o.mask}` : ''}
                </span>
              </span>
              {isSel && <Check size={15} className="shrink-0 text-brand" aria-hidden />}
            </button>
          </React.Fragment>
        );
      })}
      {onAdd && addLabel && (
        <>
          {options.length > 0 && <div className="mx-1 my-1 h-px bg-line" aria-hidden />}
          <button
            type="button"
            data-add
            tabIndex={-1}
            onClick={() => { close(); onAdd(); }}
            className={cn(ITEM_CLASS, 'font-semibold text-[rgb(var(--ui-brand-ink))]')}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-ui-sm bg-brand-soft text-brand">
              <Plus size={14} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate">{addLabel}</span>
          </button>
        </>
      )}
    </>
  );

  const panel = pos && (
    <div
      ref={panelRef}
      data-sheet
      role="listbox"
      aria-label={placeholder}
      onKeyDown={onListKey}
      style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: Math.max(pos.width, 280), maxHeight: PANEL_MAX_H }}
      className={cn('overflow-y-auto', PANEL_CLASS, 'z-[95]', pos.bottom !== undefined && 'mt-0 origin-bottom')}
    >
      {rows}
    </div>
  );

  // Phones: a bottom sheet, as AccountPicker opens, so the list never runs off
  // the screen under its field.
  const sheet = (
    <div data-sheet className="fixed inset-0 z-[100]" onClick={(e) => e.stopPropagation()}>
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] [animation:ui-fade-in_160ms_ease-out]"
        onClick={() => close()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="listbox"
        aria-label={placeholder}
        onKeyDown={onListKey}
        className="ui-root absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-ui-xl border-t border-line p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-ui-xl [animation:ui-slide-up_220ms_cubic-bezier(0.22,1,0.36,1)]"
        // .ui-root paints the canvas background; keep the sheet raised.
        style={{ backgroundColor: 'rgb(var(--ui-panel-raised))' }}
      >
        <div className="flex shrink-0 justify-center pb-1 pt-1.5" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{rows}</div>
      </div>
    </div>
  );

  return (
    <div className={cn('relative', className)} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'group/trigger disabled:cursor-not-allowed disabled:opacity-60',
          triggerClass(undefined),
          !selected && 'text-content-muted',
        )}
      >
        <TriggerInner label={selected?.name ?? placeholder} />
      </button>
      {open && typeof document !== 'undefined' && createPortal(isPhone ? sheet : panel, document.body)}
    </div>
  );
}
