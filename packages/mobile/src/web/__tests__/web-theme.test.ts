import { getTheme } from "@lasagna/design";
import { designScript, fontsUrl, themeCss } from "../web-theme";

describe("web theme", () => {
  it("asks Google Fonts for each family once, at the weights the theme uses", () => {
    const url = fontsUrl(getTheme("noodle"));
    expect(url.startsWith("https://fonts.googleapis.com/css2?")).toBe(true);
    expect(url).toContain("family=Baloo+2:wght@");
    expect(url).toContain("family=DM+Sans:wght@");
    expect(url).toContain("family=Caveat:wght@700");
    expect(url.match(/family=Baloo\+2/g)).toHaveLength(1);
    expect(url.endsWith("&display=swap")).toBe(true);
  });

  it("raises the light block over theme.css's :root and keeps the dark one", () => {
    const css = themeCss(getTheme("noodle"));
    expect(css).toContain('html[data-design="noodle"] {');
    expect(css).toContain(':root.dark[data-design="noodle"]');
    expect(css).not.toMatch(/^\[data-design=/m);
    expect(css).toContain("--ui-canvas:");
    expect(css).toContain("var(--ui-font-body)");
  });

  it("sets the design, the scheme and the web's mode key", () => {
    const js = designScript(getTheme("classic"), "dark");
    expect(js).toContain('"id":"classic"');
    expect(js).toContain('"dark":true');
    expect(js).toContain("lf-ui-mode");
    // A script, not an expression that could throw on a missing head.
    expect(() => new Function(js)).not.toThrow();
  });

  it("names the assistant after the theme's mascot, and leaves the web's default otherwise", () => {
    expect(designScript(getTheme("noodle"), "light")).toContain('"assistant":"Lasagna"');
    expect(designScript(getTheme("classic"), "light")).toContain('"assistant":null');
  });

  it("restyles cards only where the skin differs from the web's own look", () => {
    expect(themeCss(getTheme("noodle"))).toContain("--ui-surface-muted))!important");
    expect(themeCss(getTheme("classic"))).not.toContain("article.g-rise>span");
  });
});
