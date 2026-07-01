import { useCallback, useEffect, useState } from 'react';

/**
 * Light/dark mode for the DS v3 system. Mode is expressed as a `.dark` class on
 * <html> (light is the default, no class). Persisted to localStorage so the
 * styleguide / future app remembers the choice.
 *
 * This is intentionally independent of the legacy `data-theme` accent themes —
 * toggling `.dark` only affects the new `--ui-*` tokens.
 */
const STORAGE_KEY = 'lf-ui-mode';

export type UiMode = 'light' | 'dark';

export function getStoredMode(): UiMode {
  if (typeof document === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyMode(mode: UiMode) {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  localStorage.setItem(STORAGE_KEY, mode);
}

export function useUiMode() {
  const [mode, setMode] = useState<UiMode>(getStoredMode);

  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => (m === 'dark' ? 'light' : 'dark'));
  }, []);

  return { mode, setMode, toggle };
}
