import { cn } from '../../lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * SegmentedControl — a compact single-select toggle (ranges, views, tabs).
 * Keyboard + screen-reader friendly via radiogroup semantics.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  tone = 'neutral',
  stretch = true,
  className,
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  size?: 'sm' | 'md';
  /** Active-segment treatment. 'brand' uses a brand tint for clearer selection. */
  tone?: 'neutral' | 'brand';
  /** Full-width on phones (segments share the row evenly); intrinsic from sm: up.
   * Pass false when the control sits in a horizontal scroller or inline row. */
  stretch?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'items-center gap-0.5 rounded-ui-md border border-line bg-canvas-sunken p-0.5',
        stretch ? 'flex w-full sm:inline-flex sm:w-auto' : 'inline-flex w-max',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'ui-focus touch-target rounded-[calc(var(--ui-r-md)-3px)] font-medium transition-all duration-150 ease-ui',
              stretch && 'flex-1 sm:flex-none',
              size === 'sm' ? 'px-3 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]',
              active
                ? tone === 'brand'
                  ? 'bg-brand-soft text-brand shadow-ui-sm'
                  : 'bg-panel text-content shadow-ui-sm'
                : 'text-content-muted hover:text-content',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
