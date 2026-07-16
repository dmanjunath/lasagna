/**
 * Tiny shared store connecting the pull-to-refresh gesture (PullToRefresh,
 * wraps the page) to the top-nav brand mark (AppHeader). It lets the *actual*
 * nav logo get yanked down with the pull and spring back on refresh, instead of
 * a second logo appearing. Only the subscribed NavBrandMark re-renders per
 * frame, not the whole shell.
 */
export type PullPhase = 'idle' | 'pulling' | 'refreshing' | 'returning';

let state: { pull: number; phase: PullPhase } = { pull: 0, phase: 'idle' };
const subs = new Set<() => void>();

export function getPullState() {
  return state;
}

export function setPullState(next: { pull: number; phase: PullPhase }) {
  if (next.pull === state.pull && next.phase === state.phase) return;
  state = next;
  subs.forEach((f) => f());
}

export function subscribePull(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
