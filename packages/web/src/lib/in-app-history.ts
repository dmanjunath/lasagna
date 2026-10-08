/**
 * How many in-app routes sit behind the current one in this tab, as Shell's
 * nav stack counts them. A page with a Cancel uses it to go back only when
 * "back" stays inside the app: opened from a link in a new tab, the entry
 * behind it is another site (or nothing).
 */
let depth = 0;

export function setInAppDepth(n: number) {
  depth = n;
}

/** True when the history entry behind this one is a page of this app. */
export function canGoBackInApp(): boolean {
  return depth > 0;
}
