import { webSectionTitle } from "../routes";
import { hrefFor, isNativeRoute, webNavAction, splitPath, tabForPath, webPathFor, webStartPath } from "../routes";

test("native routes and tab roots ignore query and hash", () => {
  expect(isNativeRoute("/")).toBe(true);
  expect(isNativeRoute("/transactions?categories=food")).toBe(true);
  expect(isNativeRoute("/transactions#x")).toBe(true);
  expect(isNativeRoute("/spending?period=2026-11")).toBe(true);
});

test("unported routes are not native", () => {
  expect(isNativeRoute("/retirement")).toBe(false);
  expect(isNativeRoute("/transactions/extra")).toBe(false);
  expect(isNativeRoute("/accounts/123/history")).toBe(false);
});

test("splitPath separates pathname and search", () => {
  expect(splitPath("/transactions?a=1#h")).toEqual({ pathname: "/transactions", search: "?a=1", hash: "#h" });
  expect(splitPath("spending")).toEqual({ pathname: "/spending", search: "", hash: "" });
});

test("a native screen is pushed in the current tab with its query", () => {
  expect(hrefFor("/transactions?categories=c1,c2&startDate=2026-11-01")).toBe("/(home)/transactions?categories=c1,c2&startDate=2026-11-01");
  expect(hrefFor("/transactions", "(accounts)")).toBe("/(accounts)/transactions");
});

test("a tab root switches tabs and carries its query for the web page", () => {
  expect(hrefFor("/", "(goals)")).toBe("/(home)");
  expect(hrefFor("/spending?period=2026-11", "(home)")).toBe("/(spending)?__q=period%3D2026-11");
  expect(hrefFor("/accounts")).toBe("/(accounts)");
  expect(hrefFor("/chat?prompt=Hi there")).toBe("/(chat)?__q=prompt%3DHi%20there");
  expect(tabForPath("/goals?x=1")).toBe("(goals)");
  expect(tabForPath("/goals/new")).toBeNull();
});

test("a link to another tab's root stays in the current tab", () => {
  // Spending is native, so it is pushed natively with its query as params.
  expect(hrefFor("/spending?period=2026-11", "(home)", { stay: true })).toBe("/(home)/spending?period=2026-11");
  expect(hrefFor("/accounts", "(home)", { stay: true })).toBe("/(home)/accounts");
  expect(hrefFor("/accounts?autoLink=true", "(spending)", { stay: true })).toBe("/(spending)/accounts?autoLink=true");
  expect(hrefFor("/chat?prompt=Hi", "(spending)", { stay: true })).toBe("/(spending)/chat?prompt=Hi");
  // Home's root, and the tab's own root, are still the root.
  expect(hrefFor("/", "(goals)", { stay: true })).toBe("/(home)");
  expect(hrefFor("/goals?x=1", "(goals)", { stay: true })).toBe("/(goals)?__q=x%3D1");
});

test("everything else is the web fallback in the current tab", () => {
  expect(hrefFor("/insights", "(spending)")).toBe("/(spending)/insights");
  expect(hrefFor("/retirement", "(spending)")).toBe("/(spending)/web/retirement");
});

test("an account and its settings are native, the settings as a sheet over the account", () => {
  expect(isNativeRoute("/accounts/123")).toBe(true);
  expect(hrefFor("/accounts/123", "(accounts)")).toBe("/(accounts)/accounts/123");
  expect(hrefFor("/accounts/123/edit")).toBe("/(home)/accounts/123?edit=1");
  expect(hrefFor("/accounts/123/edit?x=1", "(goals)")).toBe("/(goals)/accounts/123?x=1&edit=1");
});

test("the financial journey is native, with its ?step= link", () => {
  expect(isNativeRoute("/financial-level")).toBe(true);
  expect(hrefFor("/financial-level", "(spending)")).toBe("/(spending)/financial-level");
  expect(hrefFor("/financial-level?step=debt:a1", "(home)")).toBe("/(home)/financial-level?step=debt:a1");
});

test("Settings is native and a section hash lands on that section (M-2)", () => {
  expect(isNativeRoute("/profile")).toBe(true);
  expect(hrefFor("/profile")).toBe("/(home)/profile");
  expect(hrefFor("/profile#household")).toBe("/(home)/profile/household");
  expect(hrefFor("/profile#financial", "(goals)")).toBe("/(goals)/profile/personal");
  expect(hrefFor("/profile#billing")).toBe("/(home)/profile/billing");
  expect(hrefFor("/profile#display")).toBe("/(home)/profile/preferences");
  // An unknown section, or Delete account, lands on the list rather than a destructive flow.
  expect(hrefFor("/profile#delete")).toBe("/(home)/profile");
  expect(hrefFor("/profile#nope")).toBe("/(home)/profile");
});

test("a Settings section still on the web keeps the fallback with its hash (M-3)", () => {
  expect(isNativeRoute("/profile#rules")).toBe(false);
  expect(hrefFor("/profile#categories")).toBe("/(home)/web/profile?__h=categories");
  expect(hrefFor("/profile?x=1#rules", "(goals)")).toBe("/(goals)/web/profile?__q=x%3D1&__h=rules");
  expect(webStartPath("/profile", undefined, "household")).toBe("/profile#household");
  expect(webStartPath("/chat", "prompt=Hi")).toBe("/chat?prompt=Hi");
});

test("webPathFor names the web page a screen stands for", () => {
  expect(webPathFor(["(app)", "(home)"])).toBe("/");
  expect(webPathFor(["(app)", "(spending)"])).toBe("/spending");
  expect(webPathFor(["(app)", "(home)", "transactions"])).toBe("/transactions");
  expect(webPathFor(["(app)", "(home)", "web", "[...path]"], ["plans", "savings", "g1"])).toBe("/plans/savings/g1");
});

test("goals are native: the list, a goal (and its older /plans/savings path), and New goal as a sheet", () => {
  expect(isNativeRoute("/goals/g1")).toBe(true);
  expect(isNativeRoute("/plans/savings/g1")).toBe(true);
  expect(hrefFor("/goals/g1", "(goals)")).toBe("/(goals)/goals/g1");
  expect(hrefFor("/plans/savings/g1?edit=1", "(home)")).toBe("/(home)/goals/g1?edit=1");
  expect(hrefFor("/goals/new?kind=car", "(goals)")).toBe("/(goals)/goal-form?kind=car");
  expect(hrefFor("/goals/new")).toBe("/(home)/goal-form");
  // Home's "See all" pushes the native list in Home, Back returns to the card.
  expect(hrefFor("/goals", "(home)", { stay: true })).toBe("/(home)/goals");
  expect(isNativeRoute("/goals/g1/history")).toBe(false);
});

test("a web page's Ask switches to the chat tab, whatever tab the page is in", () => {
  const page = { own: "/retirement", root: false };
  expect(webNavAction("/chat?prompt=Am%20I%20on%20track&at=1&title=Retirement", "push", page)).toEqual({ action: "open", mode: "tab" });
  expect(webNavAction("/chat", "replace", page)).toEqual({ action: "open", mode: "tab" });
  // Other native screens still push in the current tab, and the page's own links stay in it.
  expect(webNavAction("/transactions?categories=x", "push", page)).toEqual({ action: "open", mode: "push" });
  expect(webNavAction("/financial-level", "push", page)).toEqual({ action: "open", mode: "push" });
  expect(webNavAction("/retirement?tab=plans", "replace", page)).toEqual({ action: "stay" });
  expect(webNavAction("/debt", "push", page)).toEqual({ action: "open", mode: "push" });
  // The rules page's own section changes stay on the page.
  expect(webNavAction("/profile", "replace", { own: "/profile", root: false })).toEqual({ action: "stay" });
  expect(webNavAction("/retirement?tab=plans", "push", page)).toEqual({ action: "stay" });
  expect(webNavAction("/chat", "load", page)).toEqual({ action: "stay" });
});

test("a Settings section on the web is titled by its section, other pages by their own title", () => {
  expect(webSectionTitle("/profile#rules")).toBe("Transaction rules");
  expect(webSectionTitle("/profile#categories")).toBe("Categories");
  expect(webSectionTitle("/profile")).toBeNull();
  expect(webSectionTitle("/debt#rules")).toBeNull();
});

test("Debt, Portfolio and Tax are native, pushed in the current tab", () => {
  for (const p of ["/debt", "/portfolio", "/tax"]) expect(isNativeRoute(p)).toBe(true);
  expect(hrefFor("/debt", "(home)")).toBe("/(home)/debt");
  expect(hrefFor("/portfolio", "(accounts)")).toBe("/(accounts)/portfolio");
  expect(hrefFor("/tax?x=1", "(goals)")).toBe("/(goals)/tax?x=1");
});

describe("isSheetOnTop", () => {
  const { isSheetOnTop } = require("../routes");
  test("a sheet's own screen, or the transaction detail sheet, is a sheet on top", () => {
    expect(isSheetOnTop(["(app)", "(spending)", "transactions", "transaction-filters"])).toBe(true);
    expect(isSheetOnTop(["(app)", "(home)", "transaction", "[id]"])).toBe(true);
    expect(isSheetOnTop(["(app)", "(accounts)", "account-edit"])).toBe(true);
  });
  test("a pushed page or a tab's root is not", () => {
    expect(isSheetOnTop(["(app)", "(home)"])).toBe(false);
    expect(isSheetOnTop(["(app)", "(spending)", "transactions"])).toBe(false);
    expect(isSheetOnTop(["(app)", "(accounts)", "accounts", "[id]"])).toBe(false);
  });
});
