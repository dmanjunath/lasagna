import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  AuthorizationStatus,
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  hasPermission,
  isDeviceRegisteredForRemoteMessages,
  onNotificationOpenedApp,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
  requestPermission,
} from "@react-native-firebase/messaging";
import { pushApi } from "@/api/push";

// Push notifications through Firebase Cloud Messaging, ported from
// packages/web/src/lib/push.ts (the old app): the same tokens, API calls and
// rules, so the API sends to either app the same way.
//
// Only builds that bundled the Firebase config have push (app.config.ts sets
// extra.push). No Firebase call is made in a build without it.

/** Whether this build has push at all. */
export const pushAvailable = (): boolean => Platform.OS === "ios" && Constants.expoConfig?.extra?.push === true;

// The token this device last sent to the API, so sign-out can remove it.
const TOKEN_KEY = "lasagna_push_token";
// Set when the user turns push off in Settings, so launch doesn't re-register.
const OFF_KEY = "lasagna_push_off";

const isOptedOut = async () => (await AsyncStorage.getItem(OFF_KEY).catch(() => null)) === "1";
const setOptedOut = (on: boolean) => (on ? AsyncStorage.setItem(OFF_KEY, "1") : AsyncStorage.removeItem(OFF_KEY)).catch(() => {});

async function saveToken(token: string): Promise<void> {
  await pushApi.save(token, Platform.OS === "android" ? "android" : "ios");
  await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
}

const granted = (s: number) => s === AuthorizationStatus.AUTHORIZED || s === AuthorizationStatus.PROVISIONAL;

let registered = false;
let stopRefresh: (() => void) | null = null;

/**
 * Asks for permission the first time (iOS shows its own prompt once, then
 * answers from the saved choice) and sends this device's token to the API.
 * Runs on every sign-in and launch, because FCM can rotate the token.
 */
export async function registerPush(): Promise<void> {
  if (registered || !pushAvailable() || (await isOptedOut())) return;
  registered = true;
  try {
    const m = getMessaging();
    let status = await hasPermission(m);
    if (status === AuthorizationStatus.NOT_DETERMINED) status = await requestPermission(m);
    if (!granted(status)) {
      registered = false;
      return;
    }
    // FCM's token needs the APNs one, which comes from registering with iOS.
    if (!isDeviceRegisteredForRemoteMessages(m)) await registerDeviceForRemoteMessages(m);
    stopRefresh ??= onTokenRefresh(m, (token) => void saveToken(token).catch(() => {}));
    await saveToken(await getToken(m));
  } catch (e) {
    registered = false; // let the next launch or the Settings switch try again
    throw e;
  }
}

async function unregisterPush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  registered = false;
  stopRefresh?.();
  stopRefresh = null;
  // Forget the token only once the server has, so a failed call can be retried.
  if (token) await pushApi.remove(token);
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  // A new token next time, so the old one can never reach this device again.
  if (pushAvailable()) await deleteToken(getMessaging()).catch(() => {});
}

/** Sign-out: this device stops getting the last account's notifications, and
 * the next account starts from push on rather than inheriting a Settings choice. */
export async function signOutPush(): Promise<void> {
  await setOptedOut(false);
  if (!pushAvailable()) return;
  await unregisterPush();
}

/**
 * What the Settings switch shows. `blocked` means iOS has notifications off for
 * the app: it never shows the prompt twice, so only iOS Settings can undo it.
 */
export type PushState = "on" | "off" | "blocked";

export async function getPushState(): Promise<PushState> {
  const status = await hasPermission(getMessaging());
  if (status === AuthorizationStatus.DENIED) return "blocked";
  return granted(status) && !(await isOptedOut()) ? "on" : "off";
}

export async function setPushEnabled(on: boolean): Promise<PushState> {
  if (on) {
    await setOptedOut(false);
    try {
      await registerPush();
    } catch (e) {
      await setOptedOut(true); // still off, so launch must not quietly turn it on
      throw e;
    }
  } else {
    await unregisterPush();
    await setOptedOut(true);
  }
  return getPushState();
}

/** The in-app path a notification names (`data.path`), if it is one. */
export function notificationPath(message: { data?: Record<string, unknown> } | null | undefined): string | null {
  const path = message?.data?.path;
  return typeof path === "string" && path.startsWith("/") ? path : null;
}

/**
 * A tapped notification opens the page it names: while the app runs, and
 * when the tap is what launched it. Returns the unsubscribe.
 */
export function listenForNotificationTaps(open: (path: string) => void): () => void {
  if (!pushAvailable()) return () => {};
  const m = getMessaging();
  getInitialNotification(m)
    .then((msg) => {
      const path = notificationPath(msg);
      if (path) open(path);
    })
    .catch(() => {});
  return onNotificationOpenedApp(m, (msg) => {
    const path = notificationPath(msg);
    if (path) open(path);
  });
}
