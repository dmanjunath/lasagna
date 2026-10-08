import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { safeStorage } from "../safe-storage.js";
import { ThemeProvider, useTheme } from "../theme.js";

/**
 * Where storage is blocked (private mode, "Block All Cookies", some WebViews)
 * even reading `window.localStorage` throws. An uncaught throw on the render
 * path used to white-screen every route.
 */
const g = globalThis as { window?: unknown };

function boom(): never {
  throw new DOMException("The operation is insecure.", "SecurityError");
}

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

afterEach(() => {
  delete g.window;
});

describe("safeStorage", () => {
  it("reads, writes and removes when storage works", () => {
    g.window = { localStorage: memoryStorage() };
    expect(safeStorage.get("k")).toBeNull();
    safeStorage.set("k", "v");
    expect(safeStorage.get("k")).toBe("v");
    safeStorage.remove("k");
    expect(safeStorage.get("k")).toBeNull();
  });

  it("returns null and does not throw when the localStorage getter throws", () => {
    g.window = Object.defineProperty({}, "localStorage", { get: boom });
    expect(safeStorage.get("k")).toBeNull();
    expect(() => safeStorage.set("k", "v")).not.toThrow();
    expect(() => safeStorage.remove("k")).not.toThrow();
  });

  it("returns null and does not throw when the storage methods throw", () => {
    g.window = { localStorage: { getItem: boom, setItem: boom, removeItem: boom } };
    expect(safeStorage.get("k")).toBeNull();
    expect(() => safeStorage.set("k", "v")).not.toThrow();
    expect(() => safeStorage.remove("k")).not.toThrow();
  });
});

describe("ThemeProvider with blocked storage", () => {
  function Probe() {
    const { theme, customAccent } = useTheme();
    return createElement("span", null, `${theme} ${customAccent}`);
  }

  it("renders with the default theme instead of throwing", () => {
    g.window = Object.defineProperty({}, "localStorage", { get: boom });
    const html = renderToStaticMarkup(createElement(ThemeProvider, null, createElement(Probe)));
    expect(html).toMatch(/^<span>minty #/);
  });
});
