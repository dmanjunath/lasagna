import { useState, type CSSProperties } from 'react';
import { HIDDEN_AMOUNT, useAmountsHidden } from '../../lib/hide-amounts';

/**
 * The mask's own typography, applied wherever the mask is painted — the span
 * below, and the money form fields that show it in place of their value.
 *
 * All four properties are load-bearing:
 * - `fontFamily` and `fontWeight`, because the mask must NOT inherit the
 *   editorial display face. Bricolage draws U+2022 as a squashed ellipse next
 *   to a tall `$`, which passes at 13-24px and reads as broken text at the
 *   54-68px hero sizes. Pinning the body face at 700 keeps the bullets round at
 *   every size, and keeps the mask one constant width per font-size.
 * - `letterSpacing`, because the site's own tracking still applies: the display
 *   headings carry tight negative tracking that jams the bullets together, and
 *   a positive value to beat it spaced them out as far again once the face was
 *   pinned. `normal` is the face's own fit, so the `$` and the five bullets read
 *   as one mark at 13px and at 68px alike.
 * - `color`, because the mask must absorb the value's tone. A child's own color
 *   beats an inherited `text-negative` / `ds-pos` AND a parent's inline style,
 *   so red/green disappears without editing dozens of call-site classNames.
 */
export const MASK_TEXT_STYLE: CSSProperties = {
  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
  fontWeight: 700,
  letterSpacing: 'normal',
  color: 'rgb(var(--ui-content-secondary))',
};

/**
 * The privacy mask, rendered in place of a dollar figure. A plain inline span,
 * so it inherits font-size and scales from an 11px table cell to a 68px hero
 * without any per-site sizing.
 */
export function HiddenAmount({ className }: { className?: string }) {
  return (
    <span className={className} role="img" aria-label="Amount hidden">
      <span aria-hidden="true" style={MASK_TEXT_STYLE}>
        {HIDDEN_AMOUNT}
      </span>
    </span>
  );
}

/**
 * Reveal-on-focus for a form field holding a real amount.
 *
 * Form fields normally stay real and editable, because you cannot edit what you
 * cannot see. That holds for the field you are typing in, but not for one
 * sitting at rest: a resting field is just a number on the screen, and a number
 * on a masked screen is the leak the mode exists to prevent — `$5,700` beside a
 * masked `$•••••/yr` hands over both.
 *
 * So while the screen is masked the field shows the mask and reveals its real
 * value the moment it takes focus, which is the password-reveal idiom, and
 * hides it again on blur. The masked field is `readOnly` rather than
 * `disabled`, so it still takes focus from a click or a Tab and the reveal is
 * one interaction away.
 *
 * Call sites pair this with `value={masked ? HIDDEN_AMOUNT : real}`,
 * `type={masked ? 'text' : 'number'}` and `style={masked ? MASK_TEXT_STYLE :
 * undefined}` — spelled out rather than spread, because most of these fields
 * already carry their own `onBlur`, `type` and `style`.
 */
export function useRevealOnFocus() {
  const hidden = useAmountsHidden();
  const [focused, setFocused] = useState(false);
  return {
    masked: hidden && !focused,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
