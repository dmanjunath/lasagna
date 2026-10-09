import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge, button } from '../uikit';

// Shared dropdown idiom. Two trigger looks:
// - field: a form-field select, full width, inside a stacked panel.
// - toolbar: the app's small secondary button, the same as the bulk-edit
//   bar's actions, so the toolbar reads as one set at rest and while selecting.
//   A set filter takes the brand tint (the primary button's look).
// A toolbar filter names its field ("Account"). The chip row below names the
// value, so the two never say the same thing.
export const TRIGGER_CLASS =
  // The same box as uikit Input (height, border, text size), so a menu and a
  // text field side by side in a form line up.
  'ui-focus relative h-11 min-h-touch w-full appearance-none truncate whitespace-nowrap rounded-ui-md border border-line-strong bg-panel pl-3.5 pr-9 text-left text-sm font-medium text-content shadow-ui-sm transition-[border-color,box-shadow] aria-expanded:border-brand [@media(hover:none)_and_(pointer:coarse)]:text-[16px]';
export type ToolbarField = { name?: string; count: number; badge?: boolean };

export function triggerClass(toolbar: ToolbarField | undefined): string {
  if (!toolbar) return TRIGGER_CLASS;
  return cn(button({ variant: toolbar.count > 0 ? 'primary' : 'secondary', size: 'sm' }), 'gap-1.5 pl-3 pr-2.5 aria-expanded:border-line-strong');
}

// Label plus chevron. The chevron turns over while the menu is open.
export function TriggerInner({ label, toolbar, prefix }: { label: React.ReactNode; toolbar?: ToolbarField; prefix?: string }) {
  const chevron = (
    <ChevronDown
      size={15}
      aria-hidden
      className={cn(
        'shrink-0 text-content-muted transition-transform duration-150 group-aria-expanded/trigger:rotate-180',
        !toolbar && 'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2',
        toolbar && toolbar.count > 0 && 'text-current opacity-70',
      )}
    />
  );
  if (!toolbar) return <>{label}{chevron}</>;
  return (
    <>
      {prefix && <span className="font-semibold text-content-muted">{prefix}</span>}
      <span className="truncate">{toolbar.name ?? label}</span>
      {toolbar.count > 0 && toolbar.badge !== false && <Badge tone="brand" size="sm">{toolbar.count}</Badge>}
      {chevron}
    </>
  );
}

// The open panel and its rows, shared by every dropdown on the page. Matched
// to CategoryPicker's panel (radius, padding, row shape).
export const PANEL_CLASS =
  'z-50 mt-1.5 rounded-ui-md border border-line bg-panel-raised p-1 shadow-ui-lg origin-top [animation:ui-pop-in_140ms_cubic-bezier(0.22,1,0.36,1)]';
export const ITEM_CLASS =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-ui-sm px-2 py-2 text-left text-[13px] font-medium text-content outline-none transition-colors hover:bg-canvas-sunken focus-visible:bg-canvas-sunken min-h-touch sm:min-h-0';

// ---------------------------------------------------------------------------
// OptionMenu — a single-select dropdown with the same trigger and panel as the
// Account and Category pickers, for menus that used to open the browser's
// native list (sort, date preset). Outside click and Escape close it.
// ---------------------------------------------------------------------------

export function OptionMenu<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  triggerLabel,
  keepOpen,
  children,
  className,
  panelClassName,
  toolbar,
  prefix,
  portal,
}: {
  value: T;
  /** Options sharing a `group` sit under one tinted band (pass them in order). */
  options: Array<{ value: T; label: string; group?: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Overrides the selected option's label on the trigger. */
  triggerLabel?: string;
  /** True for options whose pick leaves the panel open, because they reveal more input below. */
  keepOpen?: (value: T) => boolean;
  /** Rendered under the options inside the panel. */
  children?: React.ReactNode;
  className?: string;
  panelClassName?: string;
  toolbar?: ToolbarField;
  /** Muted text before the value on a toolbar trigger, e.g. "Sorted by". */
  prefix?: string;
  /**
   * Render the panel in <body>, fixed under the trigger, for hosts that clip
   * overflow (a modal body). Marked data-sheet like the category picker's.
   */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // An in-place panel opens upward when the space below can't hold it.
  const [dropUp, setDropUp] = useState(false);
  const toggle = () => {
    if (!open && !portal) {
      const r = triggerRef.current?.getBoundingClientRect();
      const need = Math.min(340, options.length * 40 + 16);
      setDropUp(!!r && window.innerHeight - r.bottom < need && r.top > window.innerHeight - r.bottom);
    }
    setOpen((v) => !v);
  };
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [fixedPos, setFixedPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
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
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  // Opening moves focus to the selected option. Arrows, Home and End walk the
  // list (roving focus), and Tab out of it closes the menu.
  const listRef = useRef<HTMLDivElement>(null);
  // A portaled panel mounts a render later (once its position is known), so
  // focus waits for it.
  const panelMounted = open && (!portal || fixedPos !== null);
  useEffect(() => {
    if (!panelMounted) return;
    const opts = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    const sel = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    (sel ?? opts?.[0])?.focus();
  }, [panelMounted]);
  const onListKey = (e: React.KeyboardEvent) => {
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const i = opts.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); opts[(n + opts.length) % opts.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(opts.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  const wrapPortal = (node: React.ReactNode) =>
    portal && typeof document !== 'undefined' ? createPortal(node, document.body) : node;

  const label = triggerLabel ?? options.find((o) => o.value === value)?.label ?? '';

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={`${ariaLabel}: ${label}`}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); toggle(); }
        }}
        className={cn('group/trigger', triggerClass(toolbar))}
      >
        <TriggerInner label={label} toolbar={toolbar} prefix={prefix} />
      </button>
      {open && (!portal || fixedPos) && wrapPortal(
        <div
          ref={panelRef}
          data-sheet={portal || undefined}
          style={portal && fixedPos ? { position: 'fixed', left: fixedPos.left, top: fixedPos.top, bottom: fixedPos.bottom, minWidth: Math.max(fixedPos.width, 180) } : undefined}
          className={cn(!portal && 'absolute left-0 top-full min-w-[max(100%,180px)]', PANEL_CLASS, !portal && dropUp && 'bottom-full top-auto mb-1.5 mt-0', portal && 'z-[95]', panelClassName)}
        >
          <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} onKeyDown={onListKey} className="max-h-[320px] overflow-y-auto">
            {options.map((opt, i) => {
              const selected = opt.value === value;
              const band = opt.group && opt.group !== options[i - 1]?.group;
              return (
                <React.Fragment key={opt.value}>
                {band && (
                  // The same tinted section band as the category and account menus.
                  <div className="mt-0.5 rounded-ui-sm bg-canvas-sunken px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted first:mt-0">
                    {opt.group}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => {
                    onChange(opt.value);
                    if (!keepOpen?.(opt.value)) {
                      setOpen(false);
                      triggerRef.current?.focus();
                    }
                  }}
                  className={cn(ITEM_CLASS, selected && 'font-semibold text-[rgb(var(--ui-brand-ink))]')}
                >
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {selected && <Check size={15} className="shrink-0 text-[rgb(var(--ui-brand-ink))]" aria-hidden />}
                </button>
                </React.Fragment>
              );
            })}
          </div>
          {children}
        </div>,
      )}
    </div>
  );
}
