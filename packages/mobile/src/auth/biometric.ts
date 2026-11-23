import * as SecureStore from "expo-secure-store";

// Face ID app-lock state, as packages/web/src/lib/biometric-lock.ts keeps it.
// Device-local, in the Keychain. It gates pixels, not the session.
const LOCK_KEY = "lasagna_biometric_lock";
const PROMPTED_KEY = "lasagna_faceid_prompted";
export const LOCK_GRACE_MS = 60_000;

const opts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

function read(key: string, fallback: boolean): boolean {
  try {
    return SecureStore.getItem(key, opts) === "1";
  } catch {
    return fallback;
  }
}

function write(key: string, on: boolean) {
  try {
    if (on) SecureStore.setItem(key, "1", opts);
    else void SecureStore.deleteItemAsync(key, opts);
  } catch {
    // Keychain unavailable: the setting just won't persist.
  }
}

export const isLockEnabled = () => read(LOCK_KEY, false);
export const setLockEnabled = (on: boolean) => write(LOCK_KEY, on);
/** Whether the one-time "Turn on Face ID?" offer has been shown. Unreadable counts as shown, so it never nags. */
export const isSetupPrompted = () => read(PROMPTED_KEY, true);
export const setSetupPrompted = (on: boolean) => write(PROMPTED_KEY, on);

/**
 * Sign-out turns the lock off and re-arms the one-time offer, so the next
 * sign-in is asked again. The passkey hint is left alone: that passkey still
 * works, and it is how the user gets back in.
 */
export function clearFaceIdOnSignOut() {
  setLockEnabled(false);
  setSetupPrompted(false);
}

/**
 * backgroundedAt === null means cold start. Signed out, nothing is behind the
 * lock but the sign-in screen, and a cancelled Face ID would strand the user.
 */
export function shouldLock(o: { enabled: boolean; signedIn: boolean; backgroundedAt: number | null; now: number }): boolean {
  if (!o.enabled || !o.signedIn) return false;
  if (o.backgroundedAt === null) return true;
  // Strictly greater: exactly the grace period stays unlocked.
  return o.now - o.backgroundedAt > LOCK_GRACE_MS;
}
