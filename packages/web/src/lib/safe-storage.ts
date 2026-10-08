/**
 * localStorage that never throws. Reading `window.localStorage` or calling
 * getItem/setItem throws where storage is blocked (private mode, "Block All
 * Cookies", some WebViews), and an uncaught throw on the render path
 * white-screens the app. Reads fall back to null, writes become no-ops.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // storage unavailable: the value just won't persist
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // storage unavailable
    }
  },
};
