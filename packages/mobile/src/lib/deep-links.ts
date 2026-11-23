import { hrefFor, splitPath } from "./routes";

/**
 * The web-app path an incoming link names. Universal links carry it as the
 * URL's path (https://host/reset-password?token=x). The app scheme carries it
 * from the host on (lasagna://reset-password?token=x).
 */
export function webPathFromUrl(url: string): string {
  if (url.startsWith("/")) return url;
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(url);
  if (!m) return "/";
  const [, scheme, host, rest] = m;
  if (/^https?$/i.test(scheme)) return rest || "/";
  return host ? `/${host}${rest}` : rest || "/";
}

/**
 * Plaid's OAuth redirect URI: https://<web host>/plaid-oauth, a universal link.
 * A bank hands the person back to the app on it, and Plaid Link (still on
 * screen) resumes by itself, so the app does not navigate for it.
 */
export const PLAID_OAUTH_PATH = "/plaid-oauth";

export function isPlaidOAuthReturn(url: string): boolean {
  return splitPath(webPathFromUrl(url)).pathname === PLAID_OAUTH_PATH;
}

// Screens of the root stack that a link opens as they are.
const ROOT_SCREENS = new Set(["/reset-password", "/accept-invite", "/billing/success", "/forgot-password", "/onboarding"]);

/** The app href for an incoming link: an auth screen, a tab, a native screen, or the web fallback in the home tab. */
export function hrefForLink(url: string): string {
  const path = webPathFromUrl(url);
  const { pathname, search } = splitPath(path);
  if (ROOT_SCREENS.has(pathname)) return `${pathname}${search}`;
  if (pathname === "/signup") return "/sign-in?mode=signup";
  if (pathname === "/login" || pathname === "/verify-email") return "/sign-in";
  return hrefFor(path, "(home)");
}
