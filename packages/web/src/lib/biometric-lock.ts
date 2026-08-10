/**
 * Face ID app-lock state. The preference is device-local (mirrors the native
 * token pattern in native.ts) — it gates pixels, not the session.
 */
const LOCK_KEY = "lasagna_biometric_lock";
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

/** backgroundedAt === null means cold start. */
export function shouldLock(opts: { enabled: boolean; backgroundedAt: number | null; now: number }): boolean {
  if (!opts.enabled) return false;
  if (opts.backgroundedAt === null) return true;
  // strict >: elapsed === LOCK_GRACE_MS stays unlocked (grace is inclusive at the boundary)
  return opts.now - opts.backgroundedAt > LOCK_GRACE_MS;
}
