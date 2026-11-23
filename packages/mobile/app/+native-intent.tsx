import * as WebBrowser from "expo-web-browser";
import { hrefForLink, isPlaidOAuthReturn, webPathFromUrl } from "@/lib/deep-links";

/**
 * Every incoming link (the lasagna:// scheme or a universal link for the web
 * host) names a web-app path. This maps it to the screen that shows it.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    // A bank's OAuth return: Plaid Link picks it up, the screen under it stays.
    // An empty path is ignored. At a cold start there is no Link to resume.
    if (isPlaidOAuthReturn(path)) return initial ? "/" : "";
    // The dev client's own launch links pass through untouched.
    if (path.includes("expo-development-client")) return path;
    // Stripe's return can land while its checkout sheet is still up.
    if (webPathFromUrl(path).startsWith("/billing/success")) void Promise.resolve(WebBrowser.dismissBrowser()).catch(() => {});
    return hrefForLink(path);
  } catch {
    return "/";
  }
}
