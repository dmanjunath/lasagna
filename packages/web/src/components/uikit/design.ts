import { useCallback, useEffect, useState } from 'react';
import { themes, type Theme } from '@lasagna/design';
import { designIcons, fontsUrl, themeColors } from '@lasagna/design/build/webCss';

/**
 * The design system the app is drawn in: Classic (the web's own look in
 * theme.css, the default) or another design from packages/design, expressed as
 * data-design="<id>" on <html>. Every design's stylesheet ships with the app
 * (vite.config.ts), so switching only flips the attribute and loads its fonts.
 *
 * First paint is owned by the inline script in index.html, as for light/dark
 * (mode.ts): it reads the same key and sets the attribute before the CSS lands.
 * Inside the iOS app the native shell sets the design itself and this stays out
 * of its way.
 */
export const DESIGN_STORAGE_KEY = 'lf-ui-design';
export const CLASSIC = 'classic';

/** The designs the web offers, Classic first. */
export const WEB_DESIGNS: ReadonlyArray<{ id: string; name: string }> = [
  { id: CLASSIC, name: 'Classic' },
  ...themes.filter((t) => t.meta.id !== CLASSIC).map((t) => ({ id: t.meta.id, name: t.meta.name })),
];

const byId = (id: string): Theme | undefined => themes.find((t) => t.meta.id === id && id !== CLASSIC);

/** Inside the iOS app the native shell owns the design. */
export function nativeShellDesign(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-shell') === 'native';
}

/** The design on screen: whatever the first-paint script (or the native shell) set. */
export function currentDesign(): string {
  if (typeof document === 'undefined') return CLASSIC;
  const id = document.documentElement.getAttribute('data-design');
  return id && byId(id) ? id : CLASSIC;
}

/** The theme behind the design on screen, or null for Classic. */
export function currentTheme(): Theme | null {
  return byId(currentDesign()) ?? null;
}

/** The favicon and home-screen icon links index.html declares (and its first-paint script swaps). */
export const ICON_LINK_IDS = { svg: 'lf-favicon', touch: 'lf-touch-icon' } as const;
const CLASSIC_ICONS = { svg: '/favicon.svg', touch: '/icons/apple-touch-icon.png' };

/** The theme-color metas index.html declares (and its first-paint script sets). */
export const THEME_COLOR_IDS = { light: 'lf-theme-light', dark: 'lf-theme-dark' } as const;
const CLASSIC_THEME_COLOR = { light: '#F7F9FC', dark: '#0D1117' };

/** The browser chrome in the design's page color, or back to Classic's. */
function applyThemeColor(theme: Theme | undefined) {
  const colors = theme ? themeColors(theme) : CLASSIC_THEME_COLOR;
  for (const key of ['light', 'dark'] as const) {
    const meta = document.getElementById(THEME_COLOR_IDS[key]);
    if (meta && meta.getAttribute('content') !== colors[key]) meta.setAttribute('content', colors[key]);
  }
}

/** Points the tab and home-screen icons at the design's tile, or back at Classic's waves. */
function applyIcons(theme: Theme | undefined) {
  const icons = (theme && designIcons(theme)) ?? CLASSIC_ICONS;
  for (const key of ['svg', 'touch'] as const) {
    const link = document.getElementById(ICON_LINK_IDS[key]);
    if (link && link.getAttribute('href') !== icons[key]) link.setAttribute('href', icons[key]);
  }
}

export function applyDesign(id: string) {
  const h = document.documentElement;
  const theme = byId(id);
  applyIcons(theme);
  applyThemeColor(theme);
  if (!theme) {
    h.removeAttribute('data-design');
    h.removeAttribute('data-assistant');
  } else {
    h.setAttribute('data-design', theme.meta.id);
    if (theme.mascot) h.setAttribute('data-assistant', theme.mascot.name);
    else h.removeAttribute('data-assistant');
    let link = document.getElementById('lf-design-fonts') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = 'lf-design-fonts';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    const href = fontsUrl(theme);
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }
  try {
    if (theme) localStorage.setItem(DESIGN_STORAGE_KEY, theme.meta.id);
    else localStorage.removeItem(DESIGN_STORAGE_KEY);
  } catch {
    // storage unavailable: it applies now, it just won't survive a reload
  }
  window.dispatchEvent(new Event('lf-design-change'));
}

export function useDesign() {
  const [design, setDesignState] = useState<string>(currentDesign);
  const setDesign = useCallback((id: string) => {
    applyDesign(id);
    setDesignState(currentDesign());
  }, []);
  return { design, setDesign, native: nativeShellDesign() };
}

/** The theme on screen (null for Classic), re-read when the design switches. */
export function useActiveTheme(): Theme | null {
  const [theme, setTheme] = useState<Theme | null>(currentTheme);
  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    window.addEventListener('lf-design-change', sync);
    return () => window.removeEventListener('lf-design-change', sync);
  }, []);
  return theme;
}
