import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Covers loadAnalytics itself, which the sibling file cannot: it reads the
 * build-time website id and touches window/document, so each case stubs the
 * globals and re-imports the module.
 *
 * The iOS cases are the point of the file. The tracker used to be skipped in
 * the native shell, and nothing else here would notice if that gate came back.
 */
const HOOK = "__lasagnaUmamiBeforeSend";
const UUID = "00000000-0000-0000-0000-000000000000";

/** Returns the window stub and the list of scripts appended to <head>. */
function stubDom(nativePlatform: boolean) {
  const head: Array<{ src: string }> = [];
  const win: Record<string, unknown> = {
    Capacitor: { isNativePlatform: () => nativePlatform },
  };
  (globalThis as unknown as Record<string, unknown>).window = win;
  Object.defineProperty(globalThis, "navigator", {
    value: { doNotTrack: null },
    configurable: true,
    writable: true,
  });
  (globalThis as unknown as Record<string, unknown>).document = {
    head: { appendChild: (node: { src: string }) => head.push(node) },
    createElement: () => ({ src: "", defer: false, setAttribute: () => {} }),
  };
  return { win, head };
}

async function load(websiteId: string, nativePlatform: boolean) {
  vi.stubEnv("VITE_UMAMI_WEBSITE_ID", websiteId);
  const dom = stubDom(nativePlatform);
  const { loadAnalytics } = await import("../analytics.js");
  loadAnalytics();
  return dom;
}

describe("loadAnalytics", () => {
  beforeEach(() => vi.resetModules());

  it("loads the tracker inside the native shell", async () => {
    const { win, head } = await load("test-website-id", true);
    expect(head).toHaveLength(1);
    expect(head[0].src).toBe("https://cloud.umami.is/script.js");
    expect(typeof win[HOOK]).toBe("function");
  });

  // capacitor://localhost would otherwise report as the hostname "localhost".
  it("relabels the hostname and still scrubs ids on iOS", async () => {
    const { win } = await load("test-website-id", true);
    const hook = win[HOOK] as (t: string, p: object) => object;
    expect(hook("event", { url: `/accounts/${UUID}`, hostname: "localhost" })).toEqual({
      url: "/accounts/:id",
      hostname: "ios.lasagnafi.com",
    });
  });

  it("leaves the hostname alone on the web", async () => {
    const { win } = await load("test-website-id", false);
    const hook = win[HOOK] as (t: string, p: object) => object;
    expect(hook("event", { url: "/money", hostname: "app.lasagnafi.com" })).toEqual({
      url: "/money",
      hostname: "app.lasagnafi.com",
    });
  });

  it("loads nothing when the website id is blank, which is the self-hosted case", async () => {
    const { head } = await load("", true);
    expect(head).toHaveLength(0);
  });

  it("loads nothing on iOS under Global Privacy Control", async () => {
    vi.stubEnv("VITE_UMAMI_WEBSITE_ID", "test-website-id");
    const { head } = stubDom(true);
    (globalThis.navigator as unknown as Record<string, unknown>).globalPrivacyControl = true;
    const { loadAnalytics } = await import("../analytics.js");
    loadAnalytics();
    expect(head).toHaveLength(0);
  });
});
