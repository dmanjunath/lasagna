import { describe, it, expect } from "vitest";
// ?raw so this stays typecheck-clean without pulling node types into the package.
import html from "../../../../index.html?raw";
import { themes } from "@lasagna/design";
import { themeCss, designBoot, designIcons, iconTileSvg } from "@lasagna/design/build/webCss";
import { DESIGN_STORAGE_KEY, WEB_DESIGNS, CLASSIC, ICON_LINK_IDS, THEME_COLOR_IDS } from "../design";
// The generated icon tiles, read raw so a stale asset fails here.
const iconFiles = import.meta.glob("../../../../public/icons/*-favicon.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * The design choice is made twice, like light/dark (mode.test.ts): index.html
 * sets data-design before the stylesheet paints, and design.ts switches it
 * later. If the two drift, a reload flashes Classic before the chosen design.
 */
describe("first-paint design script", () => {
  it("reads the same storage key as design.ts", () => {
    expect(html).toContain(`'${DESIGN_STORAGE_KEY}'`);
  });

  it("gets its designs from the build (vite.config.ts fills the placeholder)", () => {
    expect(html).toContain("__LF_DESIGNS__");
  });

  it("leaves the design to the native shell inside the iOS app", () => {
    const read = html.indexOf("getItem('lf-ui-design')");
    const script = html.slice(read - 400, read);
    expect(script).toContain("data-shell");
  });

  it("swaps the same icon links design.ts swaps", () => {
    expect(html).toContain(`id="${ICON_LINK_IDS.svg}"`);
    expect(html).toContain(`id="${ICON_LINK_IDS.touch}"`);
    expect(html).toContain(`getElementById('${ICON_LINK_IDS.svg}')`);
    expect(html).toContain(`getElementById('${ICON_LINK_IDS.touch}')`);
  });

  it("sets the same theme-color metas design.ts sets", () => {
    for (const id of Object.values(THEME_COLOR_IDS)) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`getElementById('${id}')`);
    }
  });

  it("serves each design's icon tile as generated from the theme (scripts/gen-design-icons.mts)", () => {
    for (const t of themes.filter((x) => x.meta.id !== CLASSIC)) {
      const paths = designIcons(t);
      if (!paths) continue;
      const file = Object.entries(iconFiles).find(([k]) => k.endsWith(paths.svg))?.[1];
      expect(file?.trim()).toBe(iconTileSvg(t, 180));
    }
  });

  it("knows every design design.ts offers, and nothing else", () => {
    const boot = designBoot(themes.filter((t) => t.meta.id !== CLASSIC));
    expect(Object.keys(boot).sort()).toEqual(WEB_DESIGNS.filter((d) => d.id !== CLASSIC).map((d) => d.id).sort());
  });
});

describe("design stylesheet", () => {
  // Classic is the page with no data-design at all, so a rule that needs the
  // attribute (any design) or names its own design can never reach it.
  it("scopes every rule to a design, so Classic never sees it", () => {
    for (const t of themes.filter((x) => x.meta.id !== CLASSIC)) {
      const css = themeCss(t);
      // Every rule's selector names this design.
      const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+(?=\{)/g) ?? [];
      // An at-rule's prelude (@media) is not a selector: the rules inside it are checked like any other.
      for (const sel of selectors.filter((x) => !x.trim().startsWith("@"))) for (const part of topLevel(sel)) expect(part).toContain("[data-design");
    }
  });
});

/** A selector list split on its own commas, not the ones inside :is() or attributes. */
function topLevel(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  return [...parts, cur].filter((p) => p.trim());
}
