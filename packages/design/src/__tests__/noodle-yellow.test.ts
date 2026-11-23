import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrastRatio, parseColor } from "../color";
import { getTheme } from "../registry";
import { YELLOW } from "../themes/noodle";
import type { Scheme } from "../schema";

// Noodle has one yellow (owner decision 2026-11-23): the goal and action hero
// fill, its divider, the chip step and the ink, plus the pasta accent the
// charts and the celebration use. A second pale yellow anywhere in the theme
// fails here, naming the token, so a yellow always looks the same.

const SCHEMES: Scheme[] = ["light", "dark"];
const ACCENTS = ["#FFC93C", "#FFD166"];

function yellowHue(color: string): boolean {
  const { r, g, b } = parseColor(color);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const chroma = max - min;
  if (chroma < 0.08 || max !== R) return false;
  // A warm neutral (cream, the lines, the muted text) shares the hue; a yellow is saturated.
  const l = (max + min) / 2;
  const s = chroma / (1 - Math.abs(2 * l - 1));
  const h = (60 * ((G - B) / chroma) + 360) % 360;
  return s >= 0.6 && h >= 36 && h <= 58;
}

function entries(node: unknown, path: string, out: Array<[string, string]>) {
  if (typeof node === "string") out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => entries(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) entries(v, path ? `${path}.${k}` : k, out);
}

describe("Noodle's one yellow", () => {
  for (const scheme of SCHEMES) {
    const c = getTheme("noodle").color[scheme];
    const y = YELLOW[scheme];
    const allowed = new Set([y.fill, y.line, y.chip, y.ink, ...ACCENTS].map((v) => v.toUpperCase()));

    it(`${scheme}: every yellow token is the family`, () => {
      const found: Array<[string, string]> = [];
      entries(c, "", found);
      const strays = found.filter(([, v]) => /^#|^rgb/.test(v) && yellowHue(v) && !allowed.has(v.toUpperCase()));
      assert.deepEqual(strays, [], `a yellow outside the family: ${strays.map(([k, v]) => `${k} ${v}`).join(", ")}`);
    });

    it(`${scheme}: the hero fill is a warm pasta, a step above the card`, () => {
      const { r, g, b } = parseColor(y.fill);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const hue = (60 * ((g - b) / (max - min)) + 360) % 360;
      assert.ok(max === r && hue >= 34 && hue <= 46, `${y.fill} hue ${hue.toFixed(0)} is not pasta`);
      if (scheme === "dark") assert.ok(contrastRatio(y.fill, c.surfaceMuted) >= 1.15, "a step above the dark card");
    });

    it(`${scheme}: goal, action and the highlight block share one fill`, () => {
      assert.equal(c.tint.goal.fill, y.fill);
      assert.equal(c.tint.action.fill, y.fill);
      assert.equal(c.highlight, y.fill);
    });

    it(`${scheme}: the chip shows on the cream card and on the yellow hero, and its ink reads`, () => {
      assert.ok(contrastRatio(y.chip, c.surfaceMuted) >= 1.1, "chip on the card");
      // Dark: a shape on the hero needs a clear step, or the chip and the jar sink into it.
      const shape = scheme === "dark" ? 1.6 : 1.1;
      assert.ok(contrastRatio(y.chip, y.fill) >= shape, "chip on the yellow hero");
      assert.ok(contrastRatio(c.jar, y.fill) >= (scheme === "dark" ? 1.6 : 1), "the goal jar on the yellow hero");
      assert.ok(contrastRatio(y.ink, y.chip) >= 4.5, "ink on the chip");
      assert.ok(contrastRatio(y.ink, y.fill) >= 4.5, "ink on the hero");
    });
  }
});
