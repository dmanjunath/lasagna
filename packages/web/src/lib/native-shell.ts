/**
 * Native-shell bootstrap. Dynamically imported from App.tsx when running
 * inside Capacitor (isNativeApp()), so none of this ships in the web bundle.
 */
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Keyboard } from '@capacitor/keyboard';
import { PrivacyScreen } from '@capacitor/privacy-screen';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

let initialized = false;

export function pathFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

function isDarkTheme(): boolean {
  // Dark mode is the `.dark` class from components/uikit/mode.ts. The
  // `data-theme` attribute only carries accent theme ids (minty, rocket, …),
  // never "dark".
  return document.documentElement.classList.contains('dark');
}

function syncStatusBar(): void {
  // Style.Dark = light text (for dark backgrounds), Style.Light = dark text.
  StatusBar.setStyle({ style: isDarkTheme() ? Style.Dark : Style.Light }).catch(() => {});
}

export async function initNativeShell(navigate: (to: string) => void): Promise<void> {
  if (initialized) return;
  initialized = true;

  CapApp.addListener('appUrlOpen', ({ url }) => {
    const path = pathFromUrl(url);
    if (!path) return;
    Browser.close().catch(() => {}); // universal link fired while checkout sheet is up
    navigate(path);
  });

  CapApp.addListener('appStateChange', ({ isActive }) => {
    window.dispatchEvent(new Event(isActive ? 'native:resume' : 'native:background'));
  });

  syncStatusBar();
  new MutationObserver(syncStatusBar).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {}); // iOS-only
  PrivacyScreen.enable().catch(() => {});
  SplashScreen.hide().catch(() => {});
}
