/**
 * Push notifications (native shell only). Dynamically imported, so the
 * Firebase plugin never ships in the web bundle.
 *
 * Every entry point checks isPluginAvailable first: an OTA bundle can land on
 * an installed shell built before this plugin existed, and calling a missing
 * plugin throws.
 */
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { api } from './api';

// The token this device last sent to the API, so sign-out can remove it.
const TOKEN_KEY = 'lasagna_push_token';

const available = () => Capacitor.isPluginAvailable('FirebaseMessaging');

async function saveToken(token: string): Promise<void> {
  await api.savePushToken({ token, platform: Capacitor.getPlatform() });
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage unavailable: sign-out just can't remove this token
  }
}

let registered = false;
let tokenListener: PluginListenerHandle | null = null;

/**
 * Asks for permission the first time (iOS shows its own prompt once, then
 * answers from the saved choice) and sends this device's token to the API.
 * Runs on every launch, because FCM can rotate the token.
 */
export async function registerPush(): Promise<void> {
  if (registered || !available()) return;
  registered = true;

  let { receive } = await FirebaseMessaging.checkPermissions();
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    ({ receive } = await FirebaseMessaging.requestPermissions());
  }
  if (receive !== 'granted') return;

  tokenListener = await FirebaseMessaging.addListener('tokenReceived', ({ token }) => {
    saveToken(token).catch(() => {});
  });
  const { token } = await FirebaseMessaging.getToken();
  await saveToken(token);
}

/** Sign-out: this device stops getting the last account's notifications. */
export async function unregisterPush(): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
  registered = false;
  await tokenListener?.remove();
  tokenListener = null;
  if (token) await api.deletePushToken({ token });
}

/** A tapped notification opens the page it names. */
export function listenForNotificationTaps(navigate: (to: string) => void): void {
  if (!available()) return;
  FirebaseMessaging.addListener('notificationActionPerformed', ({ notification }) => {
    const path = (notification.data as { path?: unknown } | undefined)?.path;
    if (typeof path === 'string' && path.startsWith('/')) navigate(path);
  }).catch(() => {});
}
