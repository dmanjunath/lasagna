import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composite, parseColor } from "../color";
import { getTheme } from "../registry";
import type { ColorRoles, Scheme } from "../schema";

// Noodle's neutrals are warm (owner decision 2026-11-22, "Warm cream"): cream
// cards, warm lines, a brown-black ink, a warm charcoal dark canvas. A cool
// gray or navy anywhere in Noodle fails here, naming the token.
//
// "Neutral" is a color with little color in it: HSL saturation under 0.30, or
// under 5% chroma (a near-white or near-black, where HSL saturation says
// little; a brand's pale wash, like accentSofter, keeps its hue and is held
// to the saturation test only). A neutral must have a warm hue (15 to 60 degrees), or be pure
// black or white at any opacity. The roles that are neutral by meaning
// (surfaces, text, lines, the slate tone) must be warm at any saturation, so a
// pale blue-gray cannot slip in on a high HSL saturation.

const WARM: [number, number] = [15, 60];
const SCHEMES: Scheme[] = ["light", "dark"];

/** Roles that are a neutral by meaning, whatever their saturation. */
const NEUTRAL_ROLES: Array<keyof ColorRoles> = [
  "canvas",
  "canvasSunken",
  "surface",
  "surfaceRaised",
  "surfaceInset",
  "surfaceMuted",
  "content",
  "contentSecondary",
  "contentMuted",
  "contentFaint",
  "hairline",
  "line",
  "lineStrong",
  "slate",
  "slateSoft",
  "thumb",
  "scrim",
  "jar",
];

function hsl(color: string): { h: number; s: number; chroma: number; a: number; r: number; g: number; b: number } {
  const { r, g, b, a } = parseColor(color);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const chroma = max - min;
  const l = (max + min) / 2;
  const s = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (chroma) {
    if (max === R) h = 60 * (((G - B) / chroma) % 6);
    else if (max === G) h = 60 * ((B - R) / chroma + 2);
    else h = 60 * ((R - G) / chroma + 4);
  }
  return { h: (h + 360) % 360, s, chroma, a, r, g, b };
}

const pureBlackOrWhite = (c: ReturnType<typeof hsl>) => (c.r === 0 && c.g === 0 && c.b === 0) || (c.r === 255 && c.g === 255 && c.b === 255) || c.a === 0;
const isNeutral = (c: ReturnType<typeof hsl>, wash: boolean) => c.s < 0.3 || (!wash && c.chroma < 0.05);
const isWarm = (c: ReturnType<typeof hsl>) => c.h >= WARM[0] && c.h <= WARM[1];

/** Why a color breaks the rule, or null. `byRole` holds it to the rule at any saturation, `wash` marks a brand's pale wash. */
function coolNeutral(color: string, byRole = false, wash = false): string | null {
  const c = hsl(color);
  if (pureBlackOrWhite(c) || isWarm(c)) return null;
  if (!byRole && !isNeutral(c, wash)) return null;
  const cool = c.h >= 180 && c.h <= 280 ? "a cool neutral" : "a neutral off the warm range";
  return `${color} is ${cool} (hue ${c.h.toFixed(0)}, saturation ${c.s.toFixed(2)})`;
}

const COLOR = /#[0-9a-f]{6}\b|rgba?\(\s*\d[^)]*\)/gi;

/** Every color in the Noodle theme, each with the token that holds it. */
type Entry = { token: string; color: string; byRole: boolean; wash?: boolean };

/** A hued role's soft wash (brandSofter, accentSoft): pale by design, its hue is the role's. */
const isWash = (role: string) => /Softer?$/.test(role) && !role.startsWith("slate");

function noodleColors(): Entry[] {
  const t = getTheme("noodle");
  const out: Entry[] = [];
  for (const scheme of SCHEMES) {
    const c = t.color[scheme];
    for (const [k, v] of Object.entries(c)) {
      const token = `color.${scheme}.${k}`;
      if (typeof v === "string") out.push({ token, color: v, byRole: NEUTRAL_ROLES.includes(k as keyof ColorRoles), wash: isWash(k) });
    }
    c.category.forEach((v, i) => out.push({ token: `color.${scheme}.category[${i}].fill`, color: v.fill, byRole: false }, { token: `color.${scheme}.category[${i}].ink`, color: v.ink, byRole: false }));
    c.chart.forEach((v, i) => out.push({ token: `color.${scheme}.chart[${i}]`, color: v, byRole: false }));
    for (const [role, v] of Object.entries(c.tint)) {
      for (const [part, color] of Object.entries(v)) out.push({ token: `color.${scheme}.tint.${role}.${part}`, color, byRole: role === "neutral" });
    }
    for (const [k, v] of Object.entries(t.shadow[scheme])) for (const m of v.match(COLOR) ?? []) out.push({ token: `shadow.${scheme}.${k}`, color: m, byRole: false });
  }
  for (const [name, svg] of Object.entries(t.mascot ?? {})) {
    if (typeof svg !== "string") continue;
    for (const m of svg.match(COLOR) ?? []) out.push({ token: `mascot.${name}`, color: m, byRole: false });
  }
  return out;
}

describe("noodle neutrals are warm", () => {
  it("classifies the palettes the rule is about", () => {
    // Option A, approved: cream, warm lines, brown-black ink, warm charcoal.
    for (const ok of ["#FFFFFF", "#FBF6EC", "#F5EEDF", "#EFE6D4", "#7A6E5E", "#2A2420", "#171513", "#24201C", "#3A332C", "#B9AD9C", "#F6F1EA", "rgba(0, 0, 0, 0.5)", "rgba(255, 255, 255, 0.07)"]) {
      assert.equal(coolNeutral(ok, true), null, ok);
    }
    // The cool grays and navy Noodle used to have.
    for (const bad of ["#1E2235", "#14172A", "#F1F3F9", "#E1E5F0", "#9AA0B8", "#64748B", "rgba(30, 34, 53, 0.35)", "rgba(148, 163, 184, 0.20)"]) {
      assert.ok(coolNeutral(bad, true), bad);
    }
    // A brand tint is not a neutral: the blueberry wash stays blue.
    assert.equal(coolNeutral("#EEF1FF"), null);
    assert.equal(coolNeutral("#F6F8FF", false, true), null);
    assert.ok(coolNeutral("#F6F8FF"), "the same wash outside a hued role reads as a cool gray");
  });

  it("has no cool or off-range neutral in any token, shadow or mascot", () => {
    const bad = noodleColors()
      .map(({ token, color, byRole, wash }) => ({ token, why: coolNeutral(color, byRole, wash) }))
      .filter((x) => x.why)
      .map((x) => `${x.token}: ${x.why}`);
    assert.deepEqual(bad, [], `Noodle neutrals must be warm (hue ${WARM[0]} to ${WARM[1]}):\n${bad.join("\n")}`);
  });

  it("has no translucent fill that lands as a cool gray on a card", () => {
    // A blue wash at low alpha over a warm card composites to a slate gray
    // (#373745 on the dark card: the old blueberry category fill). Each
    // translucent fill is laid on every card surface and must keep its hue.
    const t = getTheme("noodle");
    const bad: string[] = [];
    for (const scheme of SCHEMES) {
      const c = t.color[scheme];
      const surfaces = [c.canvas, c.surface, c.surfaceRaised, c.surfaceMuted, c.tint.neutral.fill];
      const fills: Array<[string, string]> = [
        ...Object.entries(c).filter((e): e is [string, string] => typeof e[1] === "string" && /Soft(er)?$|^highlight$|^selected$/.test(e[0])),
        ...c.category.map((v, i) => [`category[${i}].fill`, v.fill] as [string, string]),
        ...Object.entries(c.tint).map(([role, v]) => [`tint.${role}.fill`, v.fill] as [string, string]),
      ];
      for (const [name, fill] of fills) {
        if (parseColor(fill).a >= 1) continue;
        for (const under of surfaces) {
          const h = hsl(composite(fill, under));
          if (h.h >= 180 && h.h <= 280 && h.s < 0.3) bad.push(`color.${scheme}.${name} on ${under} lands at ${composite(fill, under)} (hue ${h.h.toFixed(0)}, saturation ${h.s.toFixed(2)})`);
        }
      }
    }
    assert.deepEqual(bad, [], `Translucent fills must not composite to a cool gray:\n${bad.join("\n")}`);
  });
});
