/**
 * Native-shell (Capacitor) helpers.
 *
 * Detection reads the runtime-injected global rather than importing
 * @capacitor/core, so the web bundle stays unchanged and tests can stub
 * `window.Capacitor`.
 *
 * Inside the shell the WebView origin is capacitor://localhost, where the
 * httpOnly session cookie doesn't survive cross-origin API calls — so native
 * logins store the session token and api.ts sends it as an Authorization
 * header (requireAuth already accepts Bearer tokens).
 */
const TOKEN_KEY = 'lasagna_native_token';

export function isNativeApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** False on the web, and on an installed shell built before the plugin was added. */
export function hasNativePlugin(name: string): boolean {
  const cap = (window as { Capacitor?: { isPluginAvailable?: (name: string) => boolean } }).Capacitor;
  return isNativeApp() && !!cap?.isPluginAvailable?.(name);
}

export function getNativeToken(): string | null {
  if (!isNativeApp()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setNativeToken(token: string | null): void {
  if (!isNativeApp()) return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable — session just won't persist
  }
}
