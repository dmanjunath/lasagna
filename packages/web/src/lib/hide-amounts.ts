import { useSyncExternalStore } from 'react';

/**
 * Hide-amounts (privacy) mode — every dollar figure in the app is replaced by a
 * fixed mask so a person next to you, or on a share, learns nothing.
 *
 * The preference is device-local, like the Face ID lock in biometric-lock.ts:
 * it gates pixels on this screen, not the account, so it is never synced and
 * never cleared on sign-out.
 *
 * The flag is resolved at module import so `isAmountsHidden()` can be read
 * synchronously from module-level formatters, during the very first render.
 * Reading it from an effect (or from a context that starts `false` and flips)
 * would paint the real balances for one frame on every load, which is the one
 * thing this feature exists to prevent. No inline script in index.html is
 * needed the way dark mode needs one: there is no SSR and no persisted query
 * cache, so every money string is produced by React after JS is running.
 */
const STORAGE_KEY = 'lf-hide-amounts';

/**
 * The mask. A CONSTANT: never derived from the value's length, sign or
 * magnitude, so "$3.40", "$340", "$3,400,000" and "$0.00" are all identical.
 * That anti-inference property is the entire point — substituting digits
 * (`formatted.replace(/\d/g, '•')`) would leak magnitude perfectly.
 */
export const HIDDEN_AMOUNT = '$•••••';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // private mode / storage disabled
  }
}

let hidden = readStored();
const subs = new Set<() => void>();

export function isAmountsHidden(): boolean {
  return hidden;
}

export function setAmountsHidden(on: boolean): void {
  if (on === hidden) return;
  hidden = on;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — the mode still applies, it just won't persist
  }
  subs.forEach((f) => f());
}

export function toggleAmountsHidden(): void {
  setAmountsHidden(!hidden);
}

export function subscribeAmountsHidden(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** Subscribes a component to the flag. Most code does NOT need this: the whole
 *  authenticated tree re-renders from the single subscription in AppRoutes, so
 *  a plain `isAmountsHidden()` read is enough inside it. */
export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribeAmountsHidden, isAmountsHidden, () => false);
}

/** Swap an already-formatted money string for the mask. Pass-through when the
 *  mode is off, so a formatter can simply return `maskAmount(...)`. */
export function maskAmount(formatted: string): string {
  return hidden ? HIDDEN_AMOUNT : formatted;
}

/**
 * Whether a formatted string has already been replaced by the mask. Lets a
 * primitive that is handed a pre-formatted value (`Stat`'s `delta`, `KPI`'s
 * `value`) drop the sign glyph and tone that would otherwise render beside the
 * bullets, without having to know whether the value was money or a percentage.
 */
export function isMasked(value: unknown): boolean {
  return typeof value === 'string' && value.includes(HIDDEN_AMOUNT);
}

/**
 * Every currency-looking run in free text. Anchored on a currency sigil ($ or
 * USD) and NEVER on a bare number, so a year ("2045", "since 1928"), a step
 * ("Step 10"), a percentage ("24.99%"), an age ("age 65") and a count
 * ("6 accounts") are all left alone. A leading sign is consumed with the
 * amount, so "-$340" cannot leak its sign, and a magnitude word or suffix is
 * eaten with it, so "$5 million" does not become "$••••• million".
 */
const CURRENCY_IN_TEXT =
  /(?:[-−–+]\s?)?(?:US\$|\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[KkMmBbTt]|thousand|million|billion|trillion)\b)?|(?:[-−–+]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:[KkMmBbTt]|thousand|million|billion|trillion))?\s?USD\b/g;

/**
 * Mask the money inside an already-formatted STRING — insight, action and
 * path-step copy composed on the server, and the model's chat markdown. These
 * never pass through a number formatter, so `maskAmount` can never see them.
 *
 * Unlike the formatter-based masking, which is exact because it wraps the
 * value itself, this path is HEURISTIC: it pattern-matches text. It is biased
 * toward over-matching on purpose — masking a generic figure in advice copy
 * ("put $0 down") is harmless, while missing a format and painting a real
 * balance is the one failure this feature exists to prevent.
 *
 * Pass-through when the mode is off.
 */
export function maskCurrencyInText(text: string): string {
  return hidden ? text.replace(CURRENCY_IN_TEXT, HIDDEN_AMOUNT) : text;
}
