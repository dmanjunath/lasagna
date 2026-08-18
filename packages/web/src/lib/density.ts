/**
 * Action-card density — a tiny app-wide preference driving how compact the
 * action/insight cards render. Dependency-free store (same shape as
 * pull-store.ts) so any card or the sidebar toggle can read/set it without a
 * provider. Persisted to localStorage.
 *
 *   comfortable — the full card (default, unchanged look)
 *   compact     — the same card, tightened: 1-line description, smaller type
 *   dense       — a single scannable list row per action
 *   accordion   — a dense row that expands to reveal the details (compact body)
 */
import { useSyncExternalStore } from 'react';

export type Density = 'comfortable' | 'compact' | 'dense' | 'accordion';

const STORAGE_KEY = 'lasagna-action-density';
const DEFAULT: Density = 'comfortable';

function read(): Density {
  if (typeof window === 'undefined') return DEFAULT;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'comfortable' || v === 'compact' || v === 'dense' || v === 'accordion' ? v : DEFAULT;
}

let density: Density = read();
const subs = new Set<() => void>();

export function getDensity(): Density {
  return density;
}

export function setDensity(next: Density): void {
  if (next === density) return;
  density = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore (private mode, quota)
  }
  subs.forEach((f) => f());
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function useDensity(): Density {
  return useSyncExternalStore(subscribe, getDensity, () => DEFAULT);
}
