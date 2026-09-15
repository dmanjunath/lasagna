import { Fragment } from 'react';
import { HIDDEN_AMOUNT, maskCurrencyInText } from '../../lib/hide-amounts';
import { HiddenAmount } from './HiddenAmount';

/**
 * A string whose money is masked, with every mask drawn by the HiddenAmount
 * primitive. Any site that would otherwise render a masked string directly goes
 * through here, because the mask has to be ONE mark: the plain string
 * `maskCurrencyInText` (or a money formatter) returns draws U+2022 in whatever
 * face the site inherits, which is a squashed ellipse jammed against an
 * oversized `$` in the editorial face and a different shape again in the body
 * one. The same title can sit in a 15.5px list row and a 22px focus card on one
 * screen, so two renderings of it read as two different things.
 *
 * Splitting on the mask lets each amount render as HiddenAmount — body face,
 * round bullets, the same mark the rest of the app shows — while the words
 * around it keep the site's own type and the sentence reads as one line.
 *
 * Accepts an already-formatted money string too: when the mode is off
 * `maskCurrencyInText` is a pass-through and the output is the untouched
 * string, and when it is on an already-masked value contains no digits for the
 * sigil-anchored rule to match. So `<MaskedText text={formatMoney(x)} />` is
 * exactly `formatMoney(x)` unmasked, and the primitive when masked.
 *
 * The split parts are held together by ONE span, because the pieces are only a
 * sentence while they share an inline formatting context. Dropped bare into a
 * flex or grid container, each run of text becomes an anonymous item of its own
 * and the item's leading and trailing white space is dropped with it, so
 * "$14,047 spike" in an `inline-flex` chip painted `$•••••spike` with a measured
 * 0.0px gap. Unmasked the same string is one uninterrupted text run and keeps
 * its space, so the bug appears only once the mask splits it — which is why the
 * wrapper belongs here rather than in each caller's container.
 *
 * A string with no mask in it returns as bare text, exactly as before, so
 * nothing about unmasked rendering changes.
 */
export function MaskedText({ text }: { text: string }) {
  const parts = maskCurrencyInText(text).split(HIDDEN_AMOUNT);
  if (parts.length === 1) return <>{parts[0]}</>;
  return (
    <span>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <HiddenAmount />}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
