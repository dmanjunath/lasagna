/**
 * Face ID app-lock state. The preference is device-local (mirrors the native
 * token pattern in native.ts) — it gates pixels, not the session.
 */
const LOCK_KEY = "lasagna_biometric_lock";
const PROMPTED_KEY = "lasagna_faceid_prompted";
export const LOCK_GRACE_MS = 60_000;

export function isLockEnabled(): boolean {
  try {
    return localStorage.getItem(LOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLockEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(LOCK_KEY, "1");
    else localStorage.removeItem(LOCK_KEY);
  } catch {
    // storage unavailable — lock just won't persist
  }
}

/** Whether the one-time "Turn on Face ID?" offer has already been shown. */
export function isSetupPrompted(): boolean {
  try {
    return localStorage.getItem(PROMPTED_KEY) === "1";
  } catch {
    return true; // storage unavailable — don't re-offer on every launch
  }
}

export function setSetupPrompted(on: boolean): void {
  try {
    if (on) localStorage.setItem(PROMPTED_KEY, "1");
    else localStorage.removeItem(PROMPTED_KEY);
  } catch {
    // storage unavailable
  }
}

/**
 * Sign-out resets this device's Face ID state: the lock goes off, and the
 * one-time setup offer is re-armed so the next sign-in (a different account, or
 * the same one) is asked again instead of having to dig through Settings.
 * The passkey hint is deliberately left alone — that passkey still works, and
 * "Sign in with Face ID" is how the user gets back in.
 */
export function clearFaceIdOnSignOut(): void {
  setLockEnabled(false);
  setSetupPrompted(false);
}

/**
 * backgroundedAt === null means cold start.
 *
 * signedIn gates everything: with no session the only thing behind the lock is
 * the login screen, so a cancelled Face ID would strand the user with no way in.
 */
export function shouldLock(opts: {
  enabled: boolean;
  signedIn: boolean;
  backgroundedAt: number | null;
  now: number;
}): boolean {
  if (!opts.enabled || !opts.signedIn) return false;
  if (opts.backgroundedAt === null) return true;
  // strict >: elapsed === LOCK_GRACE_MS stays unlocked (grace is inclusive at the boundary)
  return opts.now - opts.backgroundedAt > LOCK_GRACE_MS;
}
