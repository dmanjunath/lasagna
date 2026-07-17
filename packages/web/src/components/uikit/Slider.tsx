import {
  forwardRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  /** Signal tone — 'caution' recolours the fill + thumb (e.g. allocation > 100%). */
  tone?: 'brand' | 'caution';
  /** Formats the value shown in the drag/focus bubble. Omit to disable the bubble. */
  formatBubble?: (value: number) => ReactNode;
}

/**
 * Slider — a themed native range input for the 2026 design system.
 *
 * Filled/unfilled track is driven by a `--slider-fill` percentage so the fill
 * tracks the value live; the thumb carries the "you are here" signal. Hover /
 * active / focus-visible are all styled (see `.ui-slider` in theme.css), and a
 * value bubble surfaces the current value on the thumb while dragging or when
 * keyboard-focused so it's readable without glancing at a companion input.
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { value, min, max, step, onValueChange, tone = 'brand', formatBubble, className, ...props },
  ref,
) {
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);

  const range = max - min;
  const pct = range > 0 ? ((value - min) / range) * 100 : 0;
  const clampedPct = Math.max(0, Math.min(100, pct));
  const showBubble = Boolean(formatBubble) && (active || focused);

  return (
    <div
      className={cn('ui-slider', tone === 'caution' && 'ui-slider--caution', className)}
      style={{ ['--slider-p' as string]: clampedPct }}
    >
      {formatBubble && (
        <div
          className={cn('ui-slider__bubble', showBubble && 'is-visible')}
          aria-hidden="true"
        >
          {formatBubble(value)}
        </div>
      )}
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        onPointerDown={() => setActive(true)}
        onPointerUp={() => setActive(false)}
        onPointerCancel={() => setActive(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setActive(false);
        }}
        className="ui-slider__input"
        {...props}
      />
    </div>
  );
});
