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
// Set when the user turns push off in Settings, so launch doesn't re-register.
const OFF_KEY = 'lasagna_push_off';

function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}

function setOptedOut(on: boolean): void {
  try {
    if (on) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // storage unavailable: push comes back on at next launch
  }
}

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
  if (registered || !available() || isOptedOut()) return;
  registered = true;

  let { receive } = await FirebaseMessaging.checkPermissions();
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    ({ receive } = await FirebaseMessaging.requestPermissions());
  }
  if (receive !== 'granted') return;

  try {
    tokenListener ??= await FirebaseMessaging.addListener('tokenReceived', ({ token }) => {
      saveToken(token).catch(() => {});
    });
    const { token } = await FirebaseMessaging.getToken();
    await saveToken(token);
  } catch (e) {
    registered = false; // let the next launch or the Settings switch try again
    throw e;
  }
}

async function unregisterPush(): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
  registered = false;
  await tokenListener?.remove();
  tokenListener = null;
  // Forget the token only once the server has, so a failed call can be retried.
  if (token) await api.deletePushToken({ token });
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

/** Sign-out: this device stops getting the last account's notifications, and
 * the next account starts from push on rather than inheriting a Settings choice. */
export async function signOutPush(): Promise<void> {
  setOptedOut(false);
  await unregisterPush();
}

/**
 * What the Settings switch shows. `blocked` means iOS has notifications off for
 * the app: it never shows the prompt twice, so only iOS Settings can undo it.
 */
export type PushState = 'on' | 'off' | 'blocked';

export async function getPushState(): Promise<PushState> {
  const { receive } = await FirebaseMessaging.checkPermissions();
  if (receive === 'denied') return 'blocked';
  return receive === 'granted' && !isOptedOut() ? 'on' : 'off';
}

export async function setPushEnabled(on: boolean): Promise<PushState> {
  if (on) {
    setOptedOut(false);
    try {
      await registerPush();
    } catch (e) {
      setOptedOut(true); // still off, so launch must not quietly turn it on
      throw e;
    }
  } else {
    await unregisterPush();
    setOptedOut(true);
  }
  return getPushState();
}

/** A tapped notification opens the page it names. */
export function listenForNotificationTaps(navigate: (to: string) => void): void {
  if (!available()) return;
  FirebaseMessaging.addListener('notificationActionPerformed', ({ notification }) => {
    const path = (notification.data as { path?: unknown } | undefined)?.path;
    if (typeof path === 'string' && path.startsWith('/')) navigate(path);
  }).catch(() => {});
}
