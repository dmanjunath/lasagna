// When the user actually sees the app open: a cold start, or a return from the
// background, counted once the launch screen has gone and nothing covers the
// app (the Face ID lock or the app-switcher cover). Home's mascot waves hello
// on each one (owner, 2026-11-24), never on a tab switch.

export type OpenState = {
  /** The launch screen has faded. */
  splashHidden: boolean;
  /** The Face ID lock or the app-switcher cover is up. */
  covered: boolean;
  /** An open is due: the app started, or came back from the background, and has not been seen yet. */
  pending: boolean;
};

export type OpenEvent = { type: "splashHidden" } | { type: "covered"; covered: boolean } | { type: "background" };

export const INITIAL_OPEN: OpenState = { splashHidden: false, covered: false, pending: true };

/** The next state, and whether this event is the moment the user sees the app open. */
export function nextOpen(s: OpenState, e: OpenEvent): { state: OpenState; opened: boolean } {
  const next: OpenState =
    e.type === "splashHidden" ? { ...s, splashHidden: true } : e.type === "covered" ? { ...s, covered: e.covered } : { ...s, pending: true };
  if (next.pending && next.splashHidden && !next.covered) return { state: { ...next, pending: false }, opened: true };
  return { state: next, opened: false };
}

let state = INITIAL_OPEN;
let opens = 0;
const listeners = new Set<() => void>();

export function reportOpen(e: OpenEvent) {
  const r = nextOpen(state, e);
  state = r.state;
  if (r.opened) {
    opens += 1;
    listeners.forEach((l) => l());
  }
}

/** How many opens the user has seen this session. */
export function openCount(): number {
  return opens;
}

export function subscribeOpens(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** For tests. */
export function resetOpens() {
  state = INITIAL_OPEN;
  opens = 0;
}
