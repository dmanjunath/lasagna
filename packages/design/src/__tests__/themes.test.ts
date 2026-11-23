import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { toCss, WEB_COLOR_VARS } from "../build/toCss";
import { composite, contrastRatio, parseColor } from "../color";
import { CONTRAST_PAIRS, ON_TINT, TINT_UNDER } from "../contrast";
import * as generated from "../mascot/generated";
import { MASCOT_NAMES, renderMascotModule } from "../mascot/source";
import { DEFAULT_THEME_ID, getTheme, themes } from "../registry";
import { TINT_ROLES, type Scheme } from "../schema";
import { themeSchema } from "../validate";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMES: Scheme[] = ["light", "dark"];

describe("registry", () => {
  it("has unique ids and a default that exists", () => {
    const ids = themes.map((t) => t.meta.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes(DEFAULT_THEME_ID));
    assert.equal(getTheme("no-such-theme").meta.id, DEFAULT_THEME_ID);
  });

  it("gives each theme its pull to refresh, empty state and card action", () => {
    // Noodle's character refreshes, Classic keeps the web's brand mark and its panel empty states.
    assert.equal(getTheme("noodle").skin.refresh, "mascot");
    assert.equal(getTheme("classic").skin.refresh, "brandPuff");
    assert.equal(getTheme("noodle").skin.emptyState, "open");
    assert.equal(getTheme("classic").skin.emptyState, "panel");
    assert.equal(getTheme("classic").skin.cardAction, "footer");
  });
});

for (const theme of themes) {
  describe(`theme ${theme.meta.id}`, () => {
    it("satisfies the schema", () => {
      const r = themeSchema.safeParse(theme);
      assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2));
    });

    it("pulls to refresh with art it has", () => {
      // The mascot refresh draws the theme's character, so a theme without one uses the brand mark.
      if (theme.skin.refresh === "mascot") assert.ok(theme.mascot, "refresh: mascot needs a mascot");
    });

    it("references font files that exist", () => {
      for (const role of Object.values(theme.font)) {
        for (const face of Object.values(role.faces)) assert.ok(existsSync(join(root, face!.file)), face!.file);
      }
    });

    it("starts content about 24pt from the screen edge", () => {
      const { screen, card, rowInset } = theme.space;
      // The owner's density: a slim gutter, and a card's padding doing the rest.
      assert.ok(screen <= 12, `gutter ${screen}`);
      assert.ok(Math.abs(screen + card - 24) <= 4, `content edge ${screen + card}`);
      // A list row inside a full-width card lines up with the card's other content.
      assert.ok(Math.abs(rowInset - card) <= 4, `row inset ${rowInset} vs card ${card}`);
    });

    it("has a face for every type style's weight", () => {
      for (const [k, s] of Object.entries(theme.type)) assert.ok(theme.font[s.role].faces[s.weight], `${k}: ${s.role} ${s.weight}`);
    });

    for (const scheme of SCHEMES) {
      it(`passes WCAG AA for every component text pair (${scheme})`, () => {
        const c = theme.color[scheme];
        const failures: string[] = [];
        for (const p of CONTRAST_PAIRS) {
          if (p.when && !p.when(theme.skin)) continue;
          const bg = p.over ? composite(c[p.on], c[p.over]) : c[p.on];
          const ratio = contrastRatio(c[p.text], bg);
          if (ratio < p.min) failures.push(`${p.text} on ${p.on}${p.over ? ` over ${p.over}` : ""}: ${ratio.toFixed(2)} < ${p.min} (${p.why})`);
        }
        c.category.forEach((cat, i) => {
          const bg = composite(cat.fill, c.surface);
          const ratio = contrastRatio(cat.ink, bg);
          if (ratio < 3) failures.push(`category ${i + 1} ink on fill: ${ratio.toFixed(2)} < 3 (icon)`);
        });
        assert.deepEqual(failures, []);
      });

      it(`passes WCAG AA for every text on every role tint (${scheme})`, () => {
        const c = theme.color[scheme];
        const failures: string[] = [];
        for (const role of TINT_ROLES) {
          const tint = c.tint[role];
          for (const under of TINT_UNDER) {
            const bg = composite(tint.fill, c[under]);
            for (const p of ON_TINT) {
              const fg = p.text === "ink" ? tint.ink : c[p.text];
              const ratio = contrastRatio(fg, bg);
              if (ratio < 4.5) failures.push(`${p.text} on tint.${role} over ${under}: ${ratio.toFixed(2)} < 4.5 (${p.why})`);
            }
          }
        }
        assert.deepEqual(failures, []);
      });

      it(`gives each role tint a fill that stands off the page, or is the plain card (${scheme})`, () => {
        const c = theme.color[scheme];
        // A role colour must not vanish into the page: a tinted card on the canvas still reads as a card.
        for (const role of TINT_ROLES) {
          const fill = composite(c.tint[role].fill, c.canvas);
          if (fill === composite(c.surface, c.canvas)) continue;
          assert.ok(fill !== composite(c.canvas, c.canvas), `tint.${role} fill equals the canvas`);
        }
      });

      it(`draws an empty jar that stands off the card and the page (${scheme})`, () => {
        if (theme.skin.progress !== "jar") return;
        const c = theme.color[scheme];
        // An empty jar is only its body, so the body must not vanish into, or sink below, what it sits on:
        // the page, a card, and the cards that hold jars in their role colors (goals, and the plain card).
        const under: Array<[string, string]> = [
          ["surface", c.surface],
          ["canvas", c.canvas],
          ["tint.goal", composite(c.tint.goal.fill, c.canvas)],
          ["tint.neutral", composite(c.tint.neutral.fill, c.canvas)],
        ];
        for (const [name, bg] of under) assert.ok(contrastRatio(c.jar, bg) >= 1.15, `jar on ${name}: ${contrastRatio(c.jar, bg).toFixed(2)}`);
      });

      it(`has opaque surfaces and text colors (${scheme})`, () => {
        const c = theme.color[scheme];
        for (const v of WEB_COLOR_VARS.filter((x) => x.triplet)) assert.equal(parseColor(c[v.role] as string).a, 1, v.role);
      });
    }
  });
}

describe("mascot", () => {
  it("generated strings match the .svg sources", () => {
    const sources = Object.fromEntries(MASCOT_NAMES.map((n) => [n, readFileSync(join(root, "src/mascot", `${n}.svg`), "utf8")]));
    const onDisk = readFileSync(join(root, "src/mascot/generated.ts"), "utf8");
    assert.equal(onDisk, renderMascotModule(sources), "run pnpm -F @lasagna/design gen:mascot");
  });

  it("every mascot is one well-formed svg element", () => {
    for (const n of MASCOT_NAMES) {
      const s = generated[n];
      assert.match(s, /^<svg [^>]*viewBox="[\d.\s-]+"[^>]*>[\s\S]*<\/svg>$/);
      assert.doesNotMatch(s, /<!--/);
      const opens = (s.match(/<(?!\/)[a-z]+[^>]*[^/]>/g) ?? []).length;
      const closes = (s.match(/<\/[a-z]+>/g) ?? []).length;
      assert.equal(opens, closes, `${n}: unbalanced tags`);
    }
  });
});

describe("toCss", () => {
  const webCss = readFileSync(join(root, "../web/src/styles/theme.css"), "utf8");
  const webVars = new Set([...webCss.matchAll(/(--ui-[a-z0-9-]+):/g)].map((m) => m[1]));

  for (const theme of themes) {
    it(`${theme.meta.id}: defines every --ui-* variable the web theme defines`, () => {
      const css = toCss(theme);
      const missing = [...webVars].filter((v) => !css.includes(`${v}:`));
      assert.deepEqual(missing, []);
      assert.ok(css.includes(`[data-design="${theme.meta.id}"] {`));
      assert.ok(css.includes(`:root.dark[data-design="${theme.meta.id}"]`));
    });
  }

  it("writes opaque colors as triplets, as theme.css does", () => {
    const css = toCss(getTheme("classic"));
    assert.match(css, /--ui-canvas: 247 249 252;/);
    assert.match(css, /--ui-line: rgba\(16, 24, 38, 0.12\);/);
  });
});
