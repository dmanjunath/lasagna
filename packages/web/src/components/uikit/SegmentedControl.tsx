import type { KeyboardEvent } from 'react';
import { cn } from '../../lib/utils';
import { hapticLight } from '../../lib/haptics';

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
  // Radio-group keyboard model: one Tab stop (the checked segment), arrows move
  // the selection and the focus together.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = (i + step + options.length) % options.length;
    hapticLight();
    onChange(options[next].value);
    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  };
  const hasChecked = options.some((o) => o.value === value);
  return (
    <div
      onKeyDown={onKeyDown}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'items-center gap-0.5 rounded-ui-md border border-line bg-canvas-sunken p-0.5',
        stretch ? 'flex w-full sm:inline-flex sm:w-auto' : 'inline-flex w-max',
        className,
      )}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (!hasChecked && i === 0) ? 0 : -1}
            onClick={() => { if (!active) hapticLight(); onChange(opt.value); }}
            className={cn(
              'ui-focus rounded-[calc(var(--ui-r-md)-3px)] font-medium transition-all duration-150 ease-ui',
              // One height for every toggle in the app, whatever its size: the
              // size changes text and padding only. On a touch screen the hit
              // area still reaches 44px, through an invisible extension above
              // and below, so the control does not have to be drawn 44px tall.
              "relative inline-flex h-[30px] items-center whitespace-nowrap justify-center [@media(pointer:coarse)]:min-w-[44px] after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
              stretch && 'flex-1 sm:flex-none',
              size === 'sm' ? 'px-3 text-[12px]' : 'px-3.5 text-[13px]',
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
