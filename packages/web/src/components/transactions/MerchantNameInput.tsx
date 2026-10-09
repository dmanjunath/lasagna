import { useEffect, useId, useState } from 'react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Input } from '../uikit';

// One fetch per page load: the list only grows by a rename, and a name the
// user just typed is already in their hands.
let merchantsPromise: Promise<string[]> | null = null;
function loadMerchants(): Promise<string[]> {
  merchantsPromise ??= api.getMerchants().then((r) => r.merchants).catch(() => {
    merchantsPromise = null;
    return [];
  });
  return merchantsPromise;
}

const MAX_SUGGESTIONS = 8;

// ---------------------------------------------------------------------------
// MerchantNameInput — a text input that suggests the merchant names already in
// use, so a rename can merge into an existing merchant without retyping it.
// ---------------------------------------------------------------------------

export function MerchantNameInput({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
  ariaLabel,
  inputClassName,
  floating,
  onCommit,
  onCancel,
  exclude,
}: {
  /** A name never to suggest, e.g. the one being renamed. */
  exclude?: string;
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  inputClassName?: string;
  /** Float the suggestions over what follows, for hosts that don't clip (a list row). */
  floating?: boolean;
  /**
   * Inline editing: Enter, a picked suggestion, or leaving the field saves,
   * and Escape cancels. Without it the field behaves as a plain form input.
   */
  onCommit?: (value: string) => void;
  onCancel?: () => void;
}) {
  const [merchants, setMerchants] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  useEffect(() => {
    let live = true;
    loadMerchants().then((m) => { if (live) setMerchants(m); });
    return () => { live = false; };
  }, []);

  const q = value.trim().toLowerCase();
  const matches = q === ''
    ? []
    : merchants
        .filter((m) => m.toLowerCase().includes(q) && m.toLowerCase() !== q && m !== exclude)
        // Names starting with what was typed first. The sort is stable, so
        // each half keeps the most-used-first order the API sent.
        .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
        .slice(0, MAX_SUGGESTIONS);
  const showList = open && matches.length > 0;

  const pick = (m: string) => {
    onChange(m);
    setOpen(false);
    setActive(-1);
    onCommit?.(m);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        maxLength={255}
        autoComplete="off"
        aria-label={ariaLabel}
        className={inputClassName}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); onCommit?.(value); }}
        onKeyDown={(e) => {
          if (onCommit && !(showList && active >= 0) && e.key === 'Enter') { e.preventDefault(); onCommit(value); return; }
          if (onCancel && !showList && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
          if (!showList) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(matches.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(matches[active]); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
      />
      {/* In the flow by default: the modal hosts clip overflow, so a floating
           list was cut off under the footer. */}
      {showList && (
        <div
          id={listId}
          role="listbox"
          className={cn(
            'mt-1 max-h-[264px] overflow-y-auto rounded-ui-md border bg-panel-raised py-1',
            floating ? 'absolute left-0 right-0 top-full z-50 min-w-[220px] border-line-strong shadow-ui-lg' : 'border-line shadow-ui-sm',
          )}
        >
          {matches.map((m, i) => (
            <div
              key={m}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex min-h-touch cursor-pointer items-center truncate px-3 text-[13px] font-medium text-content sm:min-h-0 sm:py-2',
                i === active && 'bg-canvas-sunken',
              )}
            >
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
