import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

/**
 * What a page hands the phone's top bar: its own back step, a title, and the
 * page's actions (create, filter, …). A native app puts these in the nav bar,
 * not in a second bar or a button row inside the page.
 *
 * Every field is optional. A page that sets nothing gets the shell defaults:
 * hamburger or back by route, and the title from page-titles.ts.
 */
export interface MobileHeaderConfig {
  /** Replaces the route title. */
  title?: string;
  /** Shows a back chevron that runs this instead of the shell default. */
  onBack?: () => void;
  /** Icon buttons on the trailing side, before the hide-amounts toggle. */
  actions?: ReactNode;
}

let current: { owner: symbol; config: MobileHeaderConfig } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const snapshot = () => current?.config ?? null;

export function useMobileHeaderConfig(): MobileHeaderConfig | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Sets the top bar for as long as the calling component is mounted. Re-applied
 * on every render, so handlers and actions never go stale.
 *
 * Owned by a token: during a route transition the outgoing page unmounts AFTER
 * the incoming one mounts, and its cleanup must not wipe the new page's bar.
 */
export function useMobileHeader(config: MobileHeaderConfig | null): void {
  const owner = useRef(Symbol('mobile-header')).current;
  useLayoutEffect(() => {
    if (config) current = { owner, config };
    else if (current?.owner === owner) current = null;
    else return;
    emit();
  });
  useLayoutEffect(() => () => {
    if (current?.owner === owner) { current = null; emit(); }
  }, [owner]);
}
