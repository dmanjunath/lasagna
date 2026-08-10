import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { faviconUrl, institutionDomainFor } from '../ds/institutions';
import { Favicon } from '../ds/AccountRow';

// ---------------------------------------------------------------------------
// AccountLinkPicker — a rich dropdown for choosing an account to link
// (property → mortgage, mortgage → property). Each option is an account row
// showing the institution favicon + account name + institution/type meta,
// matching the look of <AccountRow>. Replaces the bare native <Select> so the
// link pickers read like the rest of the account UI.
//
// Accessible: the trigger is a button (aria-haspopup="listbox"); the popover is
// a role="listbox" whose items are role="option". Escape / outside-click close
// it and return focus to the trigger. An optional "+ Add" action sits at the
// bottom for creating the counterpart when none exists.
// ---------------------------------------------------------------------------

export interface AccountPickerOption {
  id: string;
  name: string;
  /** Institution display name — drives the favicon + meta line. */
  institution: string;
  /** Right-hand meta shown under the name (e.g. "Chase · Mortgage"). */
  meta?: string;
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
  className?: string;
}

export function AccountLinkPicker({
  options,
  value,
  onChange,
  placeholder = 'Choose an account…',
  disabled,
  addLabel,
  onAdd,
  className,
}: AccountLinkPickerProps) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setDropUp(window.innerHeight - rect.bottom < 280);
    setOpen(true);
  };
  const closeMenu = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // On open, move focus to the selected (or first) option; wire outside-click
  // + Escape to close.
  useEffect(() => {
    if (!open) return;
    const items = popRef.current?.querySelectorAll<HTMLElement>('[role="option"], [data-add]');
    const active = popRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? items?.[0];
    active?.focus();
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(true); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Roving arrow-key navigation across the options + the add action.
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      popRef.current?.querySelectorAll<HTMLElement>('[role="option"], [data-add]') ?? [],
    );
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  const pick = (id: string) => { onChange(id); closeMenu(true); };

  return (
    <div className={cn('relative', className)} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        className={cn(
          'flex h-11 min-h-touch w-full items-center gap-2.5 rounded-ui-md bg-panel pl-3 pr-3 text-left text-sm text-content',
          'border border-line-strong shadow-ui-sm transition-[border-color,box-shadow] duration-150 ease-ui',
          'focus:outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        {selected ? (
          <>
            <AccountFavicon institution={selected.institution} size={22} />
            <span className="min-w-0 flex-1 truncate font-semibold">{selected.name}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-content-muted">{placeholder}</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
      </button>

      {open && (
        <div
          ref={popRef}
          role="listbox"
          aria-label={placeholder}
          onKeyDown={onListKeyDown}
          className={cn(
            'ui-root absolute left-0 z-[95] max-h-[280px] w-full min-w-[240px] overflow-auto rounded-ui-md border border-line bg-panel-raised p-1 shadow-ui-lg',
            dropUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
          )}
        >
          {options.length === 0 && !onAdd && (
            <div className="px-3 py-3 text-[13px] text-content-muted">No accounts available.</div>
          )}
          {options.map((o) => {
            const isSel = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={isSel}
                tabIndex={-1}
                onClick={() => pick(o.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(o.id); } }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-ui-sm px-2 py-2 text-left transition-colors',
                  'hover:bg-canvas-sunken focus:bg-canvas-sunken focus:outline-none',
                  isSel && 'bg-brand-softer',
                )}
              >
                <AccountFavicon institution={o.institution} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-content">{o.name}</span>
                  {o.meta && (
                    <span className="mt-0.5 block truncate text-[12px] text-content-muted">{o.meta}</span>
                  )}
                </span>
                {isSel && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
              </button>
            );
          })}

          {onAdd && addLabel && (
            <>
              {options.length > 0 && <div className="my-1 h-px bg-line" aria-hidden />}
              <button
                type="button"
                data-add
                tabIndex={-1}
                onClick={() => { closeMenu(); onAdd(); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeMenu(); onAdd(); } }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-ui-sm px-2 py-2 text-left text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] transition-colors',
                  'hover:bg-brand-softer focus:bg-brand-softer focus:outline-none',
                )}
              >
                <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-ui-sm bg-brand-soft text-brand">
                  <Plus className="h-4 w-4" />
                </span>
                {addLabel}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Institution favicon with monogram fallback, reusing the shared <Favicon>. */
function AccountFavicon({ institution, size }: { institution: string; size: number }) {
  const domain = institutionDomainFor(institution);
  const icon = faviconUrl(domain, 64);
  const monogram = (institution || '?').trim().charAt(0).toUpperCase();
  return <Favicon icon={icon} monogram={monogram} alt={institution} size={size} />;
}
