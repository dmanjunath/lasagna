import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAmountsHidden, toggleAmountsHidden } from '../../lib/hide-amounts';
import { Tooltip } from './Tooltip';

/**
 * PrivacyToggle — replaces every dollar figure with a fixed mask on this
 * device.
 *
 * Icon shows the ACTION, tint shows the STATE, which is how the light/dark
 * buttons beside it already work: eye-off means "tap to hide", and once hidden
 * the button takes a brand tint so the mode is never invisible.
 *
 * `size` picks the chrome slot it is dropped into: 36 is the desktop sidebar
 * footer (bordered, and tooltipped, since there is a pointer there), 44 is the
 * mobile header (borderless, no tooltip — touch has no hover).
 */
export function PrivacyToggle({ size = 36, className }: { size?: 36 | 44; className?: string }) {
  const hidden = useAmountsHidden();
  const Icon = hidden ? Eye : EyeOff;
  const sidebar = size === 36;

  const button = (
    <button
      type="button"
      onClick={toggleAmountsHidden}
      role="switch"
      aria-checked={hidden}
      aria-label="Hide amounts"
      className={cn(
        'ui-focus group shrink-0 grid place-items-center rounded-[10px]',
        sidebar ? 'w-9 h-9 border border-line bg-panel active:translate-y-px' : 'w-11 h-11 -mr-2',
        className,
      )}
    >
      {/* The button is the TOUCH TARGET, the span is the paint. A 44px tint in
          a 49px mobile header leaves 2-3px of clearance and reads as a filled
          slab rather than a button, so the mobile size keeps its 44px target
          and tints a 32px square inside it. The bordered sidebar slot is
          already button-shaped, so there the span fills it. */}
      <span
        className={cn(
          'grid place-items-center rounded-[10px] transition-[background-color,color,box-shadow] duration-150 ease-ui',
          sidebar ? 'h-full w-full' : 'h-8 w-8',
          // ON hovers ADDITIVELY, the way a primary Button does (Button.tsx):
          // it keeps its brand-soft fill and gains a brand ring. Dimming the
          // tint instead (brand-soft → brand-softer) made hovering an active
          // control read as switching it off, while OFF gains contrast on hover.
          hidden
            ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))] group-hover:ring-1 group-hover:ring-[var(--ui-brand-ring)]'
            : 'text-content-secondary group-hover:bg-canvas-sunken group-hover:text-content',
        )}
      >
        <Icon size={18} />
      </span>
    </button>
  );

  if (!sidebar) return button;
  return <Tooltip content={hidden ? 'Show amounts' : 'Hide amounts'}>{button}</Tooltip>;
}
