// Web paths that have a native screen pushed inside the current tab. Everything
// else opens in the web fallback. Each ported screen adds its path here. A tab
// root listed here (Spending) is also pushed natively when a link stays in its tab.
const NATIVE_PATHS = new Set(["/transactions", "/spending", "/insights", "/accounts", "/goals", "/chat", "/financial-level", "/profile", "/debt", "/portfolio", "/tax"]);

/**
 * Where a /profile link lands, by the section its hash names (the web's
 * /profile#household): that section's native screen, the Settings list for
 * no hash or one it does not know, or null for a section that is still the
 * web page's (Categories, Transaction rules), which opens the web fallback.
 */
export function profileRoute(hash: string): string | null {
  const id = hash.replace(/^#/, "");
  if (id === "categories" || id === "rules") return null;
  const section = PROFILE_HASH[id];
  return section ? `/profile/${section}` : "/profile";
}

/** A web fallback's title where the hash names the page (Settings' Categories and Transaction rules), else null. */
export function webSectionTitle(path: string): string | null {
  const { pathname, hash } = splitPath(path);
  if (pathname !== "/profile") return null;
  return WEB_SECTION_TITLE[hash.replace(/^#/, "")] ?? null;
}

const WEB_SECTION_TITLE: Record<string, string> = { categories: "Categories", rules: "Transaction rules" };

const PROFILE_HASH: Record<string, string> = {
  financial: "personal",
  personal: "personal",
  income: "income",
  household: "household",
  billing: "billing",
  security: "security",
  preferences: "preferences",
  display: "preferences",
  notifications: "preferences",
};

/**
 * Native screens with an id in the path: an account (/accounts/:id), and its
 * settings (/accounts/:id/edit), which open as a sheet over the account. A
 * goal (/goals/:id, and the older /plans/savings/:id it replaced), and New
 * goal (/goals/new?kind=), which is a sheet. Returns the app route and any
 * query the route adds.
 */
function nativeWithId(pathname: string): { route: string; query: string } | null {
  if (pathname === "/goals/new") return { route: "/goal-form", query: "" };
  const goal = /^\/(?:goals|plans\/savings)\/([^/]+)$/.exec(pathname);
  if (goal) return { route: `/goals/${goal[1]}`, query: "" };
  const m = /^\/accounts\/([^/]+)(\/edit)?$/.exec(pathname);
  if (!m) return null;
  return { route: `/accounts/${m[1]}`, query: m[2] ? "edit=1" : "" };
}

/** The tab bar, in the web's order. Each tab is its own stack (an app/(app) group). */
export const TABS = [
  { group: "(home)", path: "/", title: "Home" },
  { group: "(accounts)", path: "/accounts", title: "Accounts" },
  { group: "(spending)", path: "/spending", title: "Spending" },
  { group: "(goals)", path: "/goals", title: "Goals" },
  { group: "(chat)", path: "/chat", title: "Chat" },
] as const;

export type TabGroup = (typeof TABS)[number]["group"];

const TAB_BY_PATH = new Map<string, TabGroup>(TABS.map((t) => [t.path, t.group]));
const PATH_BY_TAB = new Map<string, string>(TABS.map((t) => [t.group, t.path]));

export function splitPath(path: string): { pathname: string; search: string; hash: string } {
  const [noHash, h] = path.split("#");
  const [p, q] = noHash.split("?");
  const pathname = p.startsWith("/") ? p : `/${p}`;
  return { pathname, search: q ? `?${q}` : "", hash: h ? `#${h}` : "" };
}

/** The tab a path is the root of, if any. */
export function tabForPath(path: string): TabGroup | null {
  return TAB_BY_PATH.get(splitPath(path).pathname) ?? null;
}

export function pathForTab(group: string): string | null {
  return PATH_BY_TAB.get(group) ?? null;
}

/** A path the web fallback must not keep: a native screen or a tab root. */
export function isNativeRoute(path: string): boolean {
  const { pathname, hash } = splitPath(path);
  if (pathname === "/profile") return profileRoute(hash) !== null;
  return NATIVE_PATHS.has(pathname) || TAB_BY_PATH.has(pathname) || nativeWithId(pathname) !== null;
}

/** A web page's query and hash, carried in __q and __h (the route's own params are the app's). */
const webParams = (search: string, hash = "") => {
  const parts = [search ? `__q=${encodeURIComponent(search.slice(1))}` : "", hash ? `__h=${encodeURIComponent(hash.slice(1))}` : ""].filter(Boolean);
  return parts.length ? `?${parts.join("&")}` : "";
};

/** The web path a fallback screen loads, from its route params. */
export function webStartPath(pathname: string, q?: string, h?: string): string {
  return `${pathname}${q ? `?${q}` : ""}${h ? `#${h}` : ""}`;
}

/**
 * The app href a web path opens from inside `tab`. A native screen is pushed
 * in the current tab with its query intact, so /transactions?categories=x
 * lands filtered. Everything else is the web fallback, pushed in the current
 * tab. A tab root's path switches to that tab (its query travels in __q, so
 * /spending?period=x lands on that period), unless `stay` is set: a link then
 * pushes the root's page in the current tab instead (its native screen, or the
 * web fallback), so Back returns to where the link was. Home's own root and the current tab's root are always the root.
 */
export function hrefFor(path: string, tab: TabGroup = "(home)", { stay = false }: { stay?: boolean } = {}): string {
  const { pathname, search, hash } = splitPath(path);
  const root = TAB_BY_PATH.get(pathname);
  if (root && (!stay || root === "(home)" || root === tab)) return `/${root}${root === "(home)" ? "" : webParams(search, hash)}`;
  // Settings lands on the section its hash names. A section still on the web keeps the fallback.
  const profile = pathname === "/profile" ? profileRoute(hash) : undefined;
  if (profile) return `/${tab}${profile}`;
  if (NATIVE_PATHS.has(pathname) && profile !== null) return `/${tab}${pathname}${search}`;
  const withId = nativeWithId(pathname);
  if (withId) {
    const query = [search.slice(1), withId.query].filter(Boolean).join("&");
    return `/${tab}${withId.route}${query ? `?${query}` : ""}`;
  }
  // The hash names a section of the web page (Profile's #household), so it travels too.
  return `/${tab}/web${pathname}${webParams(search, hash)}`;
}

/**
 * The web path a screen stands for, from expo-router's segments and params:
 * the tab root's path, a native screen's path, or the fallback's own path.
 */
export function webPathFor(segments: string[], webPath?: string | string[]): string {
  const [, tab, screen] = segments;
  if (!screen) return pathForTab(tab ?? "") ?? "/";
  if (screen === "web") {
    const parts = Array.isArray(webPath) ? webPath : webPath ? [webPath] : [];
    return `/${parts.join("/")}`;
  }
  return `/${screen}`;
}

/** The tab stacks' screens presented as sheets (the tab layout gives them the formSheet presentation). */
export const SHEET_ROUTES = [
  "transaction-filters",
  "transaction-rule",
  "pick-category",
  "add-account",
  "account-edit",
  "goal-form",
  "profile-edit",
  "set-password",
  "household-invite",
  "delete-account",
  "journey-why",
  "holding",
  "tax-add",
  "tax-document",
] as const;

/** Whether the screen on top (the route's segments) is a sheet: a sheet's own screen, or the transaction detail sheet. */
export function isSheetOnTop(segments: readonly string[]): boolean {
  const last = segments[segments.length - 1];
  const parent = segments[segments.length - 2];
  return (SHEET_ROUTES as readonly string[]).includes(last) || (parent === "transaction" && last === "[id]");
}

// The focused tab, kept by the tab layout so imperative navigation (openPath,
// the sheets) pushes inside it rather than jumping to another tab.
let currentTab: TabGroup = "(home)";
// Whether a sheet is on top, kept by the tab layout: navigating elsewhere closes it first, or the destination
// would be pushed inside the sheet (Home drawn in a sheet, with no tab bar).
let sheetOpen = false;
export function setSheetOpen(open: boolean) {
  sheetOpen = open;
}
export function isSheetOpen(): boolean {
  return sheetOpen;
}
export function setCurrentTab(tab: string | undefined) {
  if (tab && PATH_BY_TAB.has(tab)) currentTab = tab as TabGroup;
}
export function getCurrentTab(): TabGroup {
  return currentTab;
}

/**
 * What a web fallback page's own navigation does (WebScreen): `stay` in the
 * page (a query change on it, its first load, or a link the page keeps), or
 * `open` the path natively. The chat is a tab, and a page reaches it only to
 * ask (the web's openChat), so it switches to the chat tab as Home's Ask card
 * does, rather than pushing a chat inside this tab.
 */
export function webNavAction(
  path: string,
  kind: "load" | "push" | "replace" | "pop",
  { own, root }: { own: string; root: boolean },
): { action: "stay" } | { action: "open"; mode: "push" | "tab" } {
  const { pathname } = splitPath(path);
  if (pathname === own || kind === "load") return { action: "stay" };
  if (pathname === "/chat") return { action: "open", mode: "tab" };
  const leave = isNativeRoute(path) || (root && kind === "push");
  return leave ? { action: "open", mode: "push" } : { action: "stay" };
}
