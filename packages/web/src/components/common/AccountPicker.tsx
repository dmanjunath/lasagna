import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AccountIndexEntry } from '../../lib/use-accounts-index';
import { InstIcon } from './InstIcon';
import { Button } from '../uikit';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { ITEM_CLASS, PANEL_CLASS, TriggerInner, triggerClass, type ToolbarField } from './OptionMenu';

// ---------------------------------------------------------------------------
// AccountPicker — every account dropdown: accounts grouped by type under
// tinted bands, each row with its institution logo and "Chase ••1234", so
// several accounts named e.g. "CREDIT CARD" stay distinguishable. Multi mode
// is the transactions filter (checkboxes). Single mode picks one, with an
// optional "any" row on top (the category-rule form).
// ---------------------------------------------------------------------------

// Account types in the order a person reads their money: cash, then cards,
// then what they own, then what they owe.
const ACCOUNT_TYPE_GROUPS: Array<[string, string]> = [
  ['depository', 'Cash'],
  ['credit', 'Credit cards'],
  ['investment', 'Investments'],
  ['real_estate', 'Property'],
  ['alternative', 'Other assets'],
  ['loan', 'Loans'],
];
const accountTypeRank = (type: string) => {
  const i = ACCOUNT_TYPE_GROUPS.findIndex(([t]) => t === type);
  return i === -1 ? ACCOUNT_TYPE_GROUPS.length : i;
};
const accountTypeGroup = (type: string) => ACCOUNT_TYPE_GROUPS.find(([t]) => t === type)?.[1] ?? 'Other';

type Multi = { multiple: true; selected: string[]; onChange: (ids: string[]) => void };
type Single = { multiple?: false; value: string; onChange: (id: string) => void; anyLabel?: string };

export function AccountPicker(props: (Multi | Single) & {
  accounts: AccountIndexEntry[];
  /** Toolbar trigger look (field name, tint, count). Omit for a form field. */
  toolbar?: ToolbarField;
  /** Render the panel in <body>, for hosts that clip overflow (a modal body). */
  portal?: boolean;
  className?: string;
}) {
  const { accounts, toolbar, portal, className } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [fixedPos, setFixedPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  const isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
  // The sheet floats over a document that still scrolls.
  useBodyScrollLock(open && isPhone);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    // Capture phase, stopped there: Escape closes this menu only, not a
    // modal or panel it sits in.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !portal) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      // Open upward when the space below can't hold the panel.
      if (r) setFixedPos({ left: r.left, width: r.width, ...(window.innerHeight - r.bottom < 340 && r.top > window.innerHeight - r.bottom ? { bottom: window.innerHeight - r.top } : { top: r.bottom }) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, portal]);

  const sorted = [...accounts].sort((a, b) => accountTypeRank(a.type) - accountTypeRank(b.type));
  const selected = props.multiple ? props.selected : props.value ? [props.value] : [];
  // Names shared by 2+ accounts get a ••mask suffix on the trigger.
  const nameOf = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    if (!a) return undefined;
    const dupes = accounts.filter((x) => x.name === a.name).length > 1;
    return dupes && a.mask ? `${a.name} ••${a.mask}` : a.name;
  };
  const anyLabel = props.multiple ? 'All accounts' : (props.anyLabel ?? 'Any account');
  const triggerLabel =
    selected.length === 0 ? anyLabel
      : selected.length === 1 ? (nameOf(selected[0]) ?? anyLabel)
        : `${selected.length} accounts`;

  const pick = (id: string) => {
    if (props.multiple) {
      props.onChange(props.selected.includes(id) ? props.selected.filter((v) => v !== id) : [...props.selected, id]);
      return;
    }
    props.onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const row = (a: AccountIndexEntry) => {
    const isSel = selected.includes(a.id);
    const body = (
      <>
        <InstIcon institution={a.institution} isManual={a.isManual} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-content">{a.name}</span>
          <span className="block truncate text-[11.5px] text-content-muted">{a.institution}{a.mask ? ` ••${a.mask}` : ''}</span>
        </span>
      </>
    );
    return props.multiple ? (
      <label key={a.id} className={cn(ITEM_CLASS, 'focus-within:bg-canvas-sunken')}>
        <input
          type="checkbox"
          checked={isSel}
          onChange={() => pick(a.id)}
          className="h-4 w-4 rounded border-line accent-[rgb(var(--ui-brand))]"
        />
        {body}
      </label>
    ) : (
      <button
        key={a.id}
        type="button"
        role="option"
        aria-selected={isSel}
        onClick={() => pick(a.id)}
        className={cn(ITEM_CLASS, isSel && 'bg-brand-softer hover:bg-brand-softer')}
      >
        {body}
        {isSel && <Check size={15} className="shrink-0 text-brand" aria-hidden />}
      </button>
    );
  };

  const options = (
    <>
      {!props.multiple && (
        <button
          type="button"
          role="option"
          aria-selected={selected.length === 0}
          onClick={() => pick('')}
          className={cn(ITEM_CLASS, selected.length === 0 && 'font-semibold text-[rgb(var(--ui-brand-ink))]')}
        >
          <span className="min-w-0 flex-1 truncate">{anyLabel}</span>
          {selected.length === 0 && <Check size={15} className="shrink-0 text-brand" aria-hidden />}
        </button>
      )}
      {sorted.map((a, i) => {
        const group = accountTypeGroup(a.type);
        const band = group !== (i > 0 ? accountTypeGroup(sorted[i - 1].type) : null);
        return (
          <React.Fragment key={a.id}>
            {band && (
              // The same tinted section band as the category menu.
              <div className="mt-0.5 rounded-ui-sm bg-canvas-sunken px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted first:mt-0">
                {group}
              </div>
            )}
            {row(a)}
          </React.Fragment>
        );
      })}
    </>
  );

  const panel = (
    <div
      ref={panelRef}
      data-sheet={portal || undefined}
      role={props.multiple ? undefined : 'listbox'}
      aria-label={props.multiple ? undefined : 'Account'}
      style={portal && fixedPos ? { position: 'fixed', left: fixedPos.left, top: fixedPos.top, bottom: fixedPos.bottom, width: Math.max(fixedPos.width, 280) } : undefined}
      className={cn(
        !portal && 'absolute left-0 top-full w-full min-w-[280px]',
        'max-h-[320px] overflow-y-auto',
        PANEL_CLASS,
        portal && 'z-[95]',
      )}
    >
      {options}
    </div>
  );

  // Phones: a bottom sheet, as CategoryPicker opens, so a long account list
  // never runs off the screen under its field.
  const sheet = (
    <div data-sheet className="fixed inset-0 z-[100]" onClick={(e) => e.stopPropagation()}>
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] [animation:ui-fade-in_160ms_ease-out]"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        ref={panelRef}
        role={props.multiple ? 'dialog' : 'listbox'}
        aria-label="Account"
        className="ui-root absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-ui-xl border-t border-line p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-ui-xl [animation:ui-slide-up_220ms_cubic-bezier(0.22,1,0.36,1)]"
        // .ui-root paints the canvas background; keep the sheet raised.
        style={{ backgroundColor: 'rgb(var(--ui-panel-raised))' }}
      >
        <div className="flex shrink-0 justify-center pb-1 pt-1.5" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{options}</div>
        {props.multiple && (
          <Button variant="secondary" size="sm" className="mt-2 w-full shrink-0" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>
            Done
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup={props.multiple ? 'true' : 'listbox'}
        className={cn('group/trigger', triggerClass(toolbar))}
      >
        <TriggerInner label={triggerLabel} toolbar={toolbar} />
      </button>
      {open && (isPhone
        ? (typeof document !== 'undefined' ? createPortal(sheet, document.body) : null)
        : portal
          ? (fixedPos && typeof document !== 'undefined' ? createPortal(panel, document.body) : null)
          : panel)}
    </div>
  );
}
