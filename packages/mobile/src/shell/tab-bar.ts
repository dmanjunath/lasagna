import { useSyncExternalStore } from "react";

// A screen can take the tab bar's place (a selection's toolbar), as Photos does.
let hidden = false;
const listeners = new Set<() => void>();

export function setTabBarHidden(next: boolean) {
  if (hidden === next) return;
  hidden = next;
  listeners.forEach((l) => l());
}

export function useTabBarHidden() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hidden,
  );
}
