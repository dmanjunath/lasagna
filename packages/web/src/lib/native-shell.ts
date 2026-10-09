/**
 * Native-shell bootstrap. Dynamically imported from App.tsx when running
 * inside Capacitor (isNativeApp()), so none of this ships in the web bundle.
 */
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { PrivacyScreen } from '@capacitor/privacy-screen';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { checkForOtaUpdate } from './ota';

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

/** Space kept between a focused field and the top of the keyboard. */
const KEYBOARD_GAP = 16;

/**
 * The keyboard slides over the app, as it does in a native app.
 *
 * The plugin's default ("native") shrinks the whole WebView to the space above
 * the keyboard, so every fixed element and every dvh layout reflowed: the tab
 * bar rode up on top of the keyboard and the page jumped. With resize off the
 * layout stays put, and the app does the two jobs the shrink used to do:
 * `--kb` on <html> lets surfaces that must stay above the
 * keyboard (the chat composer, bottom sheets) lift themselves, and a field the
 * keyboard would cover is scrolled into the space above it.
 *
 * The accessory bar is on so every field gets a Done button. Hiding it left no
 * way to put the keyboard away from a number field.
 */
function initKeyboard(): void {
  Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {});
  Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => {});

  const root = document.documentElement;
  let height = 0;

  const reveal = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!height || !el || !el.matches('input, textarea, select, [contenteditable="true"]')) return;
    const r = el.getBoundingClientRect();
    const limit = window.innerHeight - height - KEYBOARD_GAP;
    if (r.bottom <= limit) return;
    // The nearest scroller that can move, so a field inside a sheet or the chat
    // pane scrolls there rather than moving the page behind it.
    let box: HTMLElement | null = el.parentElement;
    while (box && box !== document.body) {
      const oy = getComputedStyle(box).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight) break;
      box = box.parentElement;
    }
    const by = r.bottom - limit;
    if (box && box !== document.body) box.scrollBy({ top: by, behavior: 'smooth' });
    else window.scrollBy({ top: by, behavior: 'smooth' });
  };

  Keyboard.addListener('keyboardWillShow', ({ keyboardHeight }) => {
    height = keyboardHeight;
    root.style.setProperty('--kb', `${keyboardHeight}px`);
    // After the padding that makes room has applied.
    requestAnimationFrame(reveal);
  }).catch(() => {});
  Keyboard.addListener('keyboardWillHide', () => {
    height = 0;
    root.style.setProperty('--kb', '0px');
  }).catch(() => {});
  // Moving between fields with the keyboard already up fires no show event.
  document.addEventListener('focusin', () => requestAnimationFrame(reveal));
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
    // Being offline is normal, so a failed check is logged rather than thrown.
    if (isActive) checkForOtaUpdate().catch((e) => console.info('[ota] check failed:', e?.message ?? e));
  });

  checkForOtaUpdate().catch((e) => console.info('[ota] check failed:', e?.message ?? e));

  // The in-app browser sheet (Stripe Checkout / portal) does NOT resign the app's
  // active state, so appStateChange never fires when it closes. browserFinished
  // is the signal that the user dismissed the sheet — refresh the plan then.
  Browser.addListener('browserFinished', () => {
    window.dispatchEvent(new Event('native:browser-closed'));
  }).catch(() => {});

  syncStatusBar();
  new MutationObserver(syncStatusBar).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  initKeyboard();
  PrivacyScreen.enable().catch(() => {});
  SplashScreen.hide().catch(() => {});
}
