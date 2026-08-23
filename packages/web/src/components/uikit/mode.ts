import { useCallback, useEffect, useState } from 'react';

/**
 * Light/dark mode for the DS v3 system. Mode is expressed as a `.dark` class on
 * <html> (light is the default, no class).
 *
 * First paint is owned by the inline script in index.html, not by this module —
 * the stylesheet is a blocking <link> whose `:root` block is the light palette,
 * so applying `.dark` from React would flash white on a dark device. That
 * script sets the class from the stored choice, falling back to the OS
 * preference, before the CSS lands.
 *
 * Persistence is therefore deliberate rather than automatic: writing the
 * OS-derived value back to storage would freeze it, and the app would ignore
 * the system from then on. Only an explicit toggle persists.
 *
 * This is intentionally independent of the legacy `data-theme` accent themes —
 * toggling `.dark` only affects the new `--ui-*` tokens.
 */
const STORAGE_KEY = 'lf-ui-mode';

export type UiMode = 'light' | 'dark';

function systemMode(): UiMode {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function getStoredMode(): UiMode {
  if (typeof document === 'undefined') return 'light';
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // private mode / storage disabled
  }
  if (stored === 'dark' || stored === 'light') return stored;
  // The inline script already resolved this; read it back so we agree with
  // whatever is on screen rather than recomputing and risking a mismatch.
  if (document.documentElement.classList.contains('dark')) return 'dark';
  return systemMode();
}

export function applyMode(mode: UiMode, { persist = true }: { persist?: boolean } = {}) {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage unavailable — the class still applied, it just won't survive
  }
}

export function useUiMode() {
  const [mode, setMode] = useState<UiMode>(getStoredMode);

  // Syncing only. Persisting here would capture the OS default as an explicit
  // choice the first time any screen using this hook mounts.
  useEffect(() => {
    applyMode(mode, { persist: false });
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => {
      const next: UiMode = m === 'dark' ? 'light' : 'dark';
      applyMode(next); // an explicit choice — this one sticks
      return next;
    });
  }, []);

  return { mode, setMode, toggle };
}
