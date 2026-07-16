/**
 * Haptic feedback helpers for the native (Capacitor) shell.
 *
 * Every call is gated on isNativeApp() so the plugin never fires in the
 * browser — on web these are no-ops (no navigator.vibrate fallback), and
 * failures inside the shell are swallowed since haptics are best-effort.
 *
 * Unlike the other Capacitor plugins (dynamically imported), this one is
 * imported statically: it's tiny (<1 KB chunk) and used from main-bundle
 * components like pull-to-refresh.
 */
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativeApp } from './native';

export function hapticLight(): void {
  if (isNativeApp()) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export function hapticMedium(): void {
  if (isNativeApp()) Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

export function hapticWarning(): void {
  if (isNativeApp()) Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
}

export function hapticSuccess(): void {
  if (isNativeApp()) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}
