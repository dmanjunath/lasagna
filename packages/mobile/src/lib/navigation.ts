import { router } from "expo-router";
import { getCurrentTab, hrefFor, tabForPath } from "./routes";

/**
 * Opens a web-app path. Every link to an app route goes through here.
 *
 * A link ("push", the default) stays in the current tab: a native screen or
 * the web fallback is pushed, so Back returns to the link. That includes a
 * link to another tab's root (Home's "View all" to Spending pushes the
 * Spending page in Home). Tabs are switched only by the tab bar, and by "tab":
 * the drawer, and a destination the app chose itself (onboarding's hand-off),
 * which go to the tab when the path is a tab's root and push otherwise.
 */
export function openPath(path: string, mode: "push" | "replace" | "tab" = "push") {
  const tab = getCurrentTab();
  const href = hrefFor(path, tab, { stay: mode !== "tab" });
  const root = tabForPath(path);
  if (root && (mode === "tab" || root === "(home)" || root === tab)) router.navigate(href as never);
  else if (mode === "replace") router.replace(href as never);
  else router.push(href as never);
}

/** Pushes one of the shared screens (a sheet, a detail) inside the current tab. */
export function pushInTab(route: string) {
  router.push(`/${getCurrentTab()}${route}` as never);
}

// A path to open once the signed-in app is showing (onboarding hands off to
// /accounts?autoLink=true, which only exists past the gate).
let pendingPath: string | null = null;
export function setPendingPath(path: string | null) {
  pendingPath = path;
}
export function takePendingPath(): string | null {
  const p = pendingPath;
  pendingPath = null;
  return p;
}
