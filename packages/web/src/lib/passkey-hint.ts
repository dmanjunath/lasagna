/**
 * Device-local hint that a passkey usable on THIS device exists, so the native
 * login screen only offers "Sign in with Face ID" once it can actually succeed.
 * Set after a successful passkey registration or passkey login; cleared when the
 * account is found to have no passkeys left. Purely a UI gate — the real check
 * is the WebAuthn ceremony itself.
 */
const KEY = "lasagna_passkey_registered";

export function hasRegisteredPasskey(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setPasskeyRegistered(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable — the button just won't be offered
  }
}
