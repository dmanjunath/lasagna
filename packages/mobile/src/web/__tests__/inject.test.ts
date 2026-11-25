import { amountsScript, authHintScript, cookieFor, injectedScript } from "../inject";

test("session cookie targets the API host", () => {
  expect(cookieFor("http://localhost:3000", "tok")).toEqual({ url: "http://localhost:3000", cookie: { name: "lasagna_session", value: "tok", path: "/", httpOnly: true, secure: false } });
  expect(cookieFor("https://api.example.test", "tok").cookie.secure).toBe(true);
});

test("injected script hides web chrome and reports navigation with its kind", () => {
  const s = injectedScript();
  expect(s).toContain("pushState");
  expect(s).toContain("ReactNativeWebView.postMessage");
  expect(s).toContain("createElement('style')");
  expect(s).toContain("report('load')");
  expect(s).toContain("['replaceState','replace']");
  // The web shell's document-level gestures (edge swipe, pull-to-refresh) never see a touch.
  expect(s).toContain("document.addEventListener('touchstart',function(e){e.stopImmediatePropagation();}");
  expect(s).toContain("type:'ready'");
});

test("onboarding keeps the web's own gestures", () => {
  expect(injectedScript({ hideChrome: false })).not.toContain("stopImmediatePropagation");
});

test("the web app starts signed in from the native session's hint", () => {
  const hint = { user: { id: "u1", email: "a@example.test", name: "O'Neil" }, tenant: null };
  const js = authHintScript(hint);
  expect(js).toContain("localStorage.setItem('lf_auth_hint',");
  // The hint survives the trip through a JS string literal.
  const stored: Record<string, string> = {};
  new Function("localStorage", js)({ setItem: (k: string, v: string) => (stored[k] = v) });
  expect(JSON.parse(stored.lf_auth_hint)).toEqual(hint);
  expect(authHintScript(null)).toBe("");
  expect(injectedScript({ authHint: hint })).toContain("lf_auth_hint");
});

test("onboarding keeps the web chrome", () => {
  expect(injectedScript({ hideChrome: false })).not.toContain("createElement('style')");
});

test("the web app's hide-amounts flag follows the native one", () => {
  expect(amountsScript(true)).toContain("localStorage.setItem('lf-hide-amounts','1')");
  expect(amountsScript(false)).toContain("localStorage.removeItem('lf-hide-amounts')");
  expect(injectedScript({ amountsHidden: true })).toContain("setItem('lf-hide-amounts','1')");
});

test("the page bounces at its ends like a native screen", () => {
  // The web sets overscroll-behavior:none for browsers. In the app the document is the screen's scroller.
  const js = injectedScript({ hideChrome: true, amountsHidden: false, authHint: null });
  expect(js).toContain("html,body{overscroll-behavior:auto!important}");
});
