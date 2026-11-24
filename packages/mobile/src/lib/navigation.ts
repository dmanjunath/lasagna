import { router } from "expo-router";
import { getCurrentTab, homeTabFor, hrefFor, isSheetOpen, setSheetOpen, tabForPath } from "./routes";

/**
 * Opens a web-app path. Every link to an app route goes through here.
 *
 * A link ("push", the default) stays in the current tab: a native screen or
 * the web fallback is pushed, so Back returns to the link. That includes a
 * link to another tab's root (Home's "View all" to Spending pushes the
 * Spending page in Home). Tabs are switched only by the tab bar, and by "tab":
 * the drawer, and a destination the app chose itself (onboarding's hand-off),
 * which open the page in the tab it belongs to (homeTabFor: Transactions in
 * Spending, Debt in Accounts), so that tab lights up and Back returns to it.
 */
export function openPath(path: string, mode: "push" | "replace" | "tab" = "push") {
  closeSheet();
  if (mode === "tab") {
    router.navigate(hrefFor(path, homeTabFor(path)) as never);
    return;
  }
  const tab = getCurrentTab();
  const href = hrefFor(path, tab, { stay: true });
  const root = tabForPath(path);
  if (root && (root === "(home)" || root === tab)) router.navigate(href as never);
  else if (mode === "replace") router.replace(href as never);
  else router.push(href as never);
}

/**
 * Closes the sheet on top, if any, before going somewhere else: a destination
 * pushed while a sheet is up lands inside the sheet. It pops just the sheet
 * (back), never dismiss(), which can pop the page under it too, so the
 * destination lands on the page the sheet came from and Back returns there.
 */
export function closeSheet() {
  if (!isSheetOpen()) return;
  setSheetOpen(false);
  if (router.canGoBack()) router.back();
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
