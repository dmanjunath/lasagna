import { Search } from 'lucide-react';

// Small pieces every multi-select list shares (accounts, categories, merchants).

/** Select all / Select none for a multi-select list, over what the search left. */
export function SelectAllBar({ onAll, onNone, disabled }: { onAll: () => void; onNone: () => void; disabled?: boolean }) {
  const link = 'ui-focus touch-target-inline rounded-ui-xs text-[12.5px] font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline disabled:opacity-40 disabled:no-underline';
  return (
    <div className="flex shrink-0 items-center gap-4 px-2 py-1.5">
      <button type="button" className={link} onClick={onAll} disabled={disabled}>Select all</button>
      <button type="button" className={link} onClick={onNone} disabled={disabled}>Select none</button>
    </div>
  );
}

/** A search box for a picker list. */
export function PickerSearch({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="relative shrink-0">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-ui-md border border-line bg-panel pl-9 pr-3 text-[13px] text-content transition-[border-color,box-shadow] focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)] focus:outline-none"
      />
    </div>
  );
}

