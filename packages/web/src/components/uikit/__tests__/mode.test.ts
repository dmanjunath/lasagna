import { describe, it, expect } from "vitest";
// ?raw so this stays typecheck-clean without pulling node types into the package.
import html from "../../../../index.html?raw";

/**
 * The light/dark decision is deliberately duplicated: index.html has to make it
 * in an inline script, before the blocking stylesheet paints, which is earlier
 * than any module can run. Nothing else binds the two copies together, and if
 * they drift the symptom is a white flash on every launch — easy to ship and
 * easy to miss. These assert the contract they share.
 */
describe("first-paint theme script", () => {
  it("uses the same storage key as mode.ts", () => {
    expect(html).toContain("'lf-ui-mode'");
  });

  it("falls back to the OS preference when nothing is stored", () => {
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("resolves the OS fallback even when localStorage throws", () => {
    // Regression: the read and the fallback were both inside one try, so a
    // storage exception skipped the fallback and left the page light while
    // mode.ts resolved dark. The catch must not swallow the fallback.
    const script = html.slice(html.indexOf("var m = null"), html.indexOf("classList.add('dark')"));
    const catchEnd = script.indexOf("}", script.indexOf("catch"));
    const afterCatch = script.slice(catchEnd);
    expect(afterCatch).toContain("prefers-color-scheme: dark");
  });

  it("sets colorScheme from the resolved mode rather than a static meta", () => {
    // A static <meta name="color-scheme" content="light dark"> paints the UA
    // canvas black on a dark OS even for someone who forced the app light.
    expect(html).toContain("style.colorScheme");
    expect(html).not.toMatch(/<meta[^>]+name="color-scheme"/);
  });
});
