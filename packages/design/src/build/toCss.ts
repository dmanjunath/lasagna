import { toTriplet } from "../color";
import type { ColorRoles, Scheme, Skins, Theme } from "../schema";

// A theme as CSS custom properties, named as packages/web/src/styles/theme.css
// names them, so the web can switch design systems with a data-design
// attribute on <html>. Light under [data-design="<id>"], dark under the same
// selector with .dark (and :root.dark, which outranks the accent themes'
// :root[data-theme] blocks). Opaque colors the web feeds to Tailwind opacity
// modifiers are "R G B" triplets, as theme.css stores them.

type Var = { name: string; role: keyof ColorRoles; triplet?: boolean };

/** The web's existing --ui-* color variables, and the role each takes. */
export const WEB_COLOR_VARS: readonly Var[] = [
  { name: "canvas", role: "canvas", triplet: true },
  { name: "canvas-sunken", role: "canvasSunken", triplet: true },
  { name: "panel", role: "surface", triplet: true },
  { name: "panel-raised", role: "surfaceRaised", triplet: true },
  { name: "panel-inset", role: "surfaceInset", triplet: true },
  { name: "content", role: "content", triplet: true },
  { name: "content-secondary", role: "contentSecondary", triplet: true },
  { name: "content-muted", role: "contentMuted", triplet: true },
  { name: "content-faint", role: "contentFaint", triplet: true },
  { name: "hairline", role: "hairline" },
  { name: "line", role: "line" },
  { name: "line-strong", role: "lineStrong" },
  { name: "brand", role: "brand", triplet: true },
  { name: "brand-hover", role: "brandHover", triplet: true },
  { name: "brand-active", role: "brandActive", triplet: true },
  { name: "brand-ink", role: "brandInk", triplet: true },
  { name: "brand-fg", role: "onBrand", triplet: true },
  { name: "brand-soft", role: "brandSoft" },
  { name: "brand-softer", role: "brandSofter" },
  { name: "brand-ring", role: "brandRing" },
  { name: "accent", role: "accent", triplet: true },
  { name: "accent-ink", role: "accentInk", triplet: true },
  { name: "accent-soft", role: "accentSoft" },
  { name: "accent-softer", role: "accentSofter" },
  { name: "positive", role: "positive", triplet: true },
  { name: "positive-soft", role: "positiveSoft" },
  { name: "negative", role: "negative", triplet: true },
  { name: "negative-soft", role: "negativeSoft" },
  { name: "danger-solid", role: "dangerSolid", triplet: true },
  { name: "danger-on", role: "onDanger", triplet: true },
  { name: "caution", role: "caution", triplet: true },
  { name: "caution-soft", role: "cautionSoft" },
  { name: "info", role: "info", triplet: true },
  { name: "info-soft", role: "infoSoft" },
  { name: "sky", role: "sky", triplet: true },
  { name: "sky-soft", role: "skySoft" },
  { name: "violet", role: "violet", triplet: true },
  { name: "violet-soft", role: "violetSoft" },
  { name: "slate", role: "slate", triplet: true },
  { name: "slate-soft", role: "slateSoft" },
  // Roles the web has no variable for yet.
  { name: "surface-muted", role: "surfaceMuted", triplet: true },
  { name: "brand-edge", role: "brandEdge", triplet: true },
  { name: "highlight", role: "highlight", triplet: true },
  { name: "highlight-line", role: "highlightLine" },
  { name: "scrim", role: "scrim" },
  { name: "celebration", role: "celebration" },
  { name: "jar", role: "jar", triplet: true },
  { name: "selected", role: "selected" },
  { name: "on-selected", role: "onSelected" },
  { name: "thumb", role: "thumb" },
  { name: "on-thumb", role: "onThumb" },
];

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const quote = (family: string) => `"${family}"`;

function schemeVars(theme: Theme, scheme: Scheme): string[] {
  const c = theme.color[scheme];
  const out = WEB_COLOR_VARS.map((v) => `--ui-${v.name}: ${v.triplet ? toTriplet(c[v.role] as string) : c[v.role]};`);
  c.chart.forEach((v, i) => out.push(`--ui-viz-${i + 1}: ${v};`));
  c.category.forEach((v, i) => out.push(`--ui-category-${i + 1}: ${v.fill};`, `--ui-category-${i + 1}-ink: ${v.ink};`));
  // Role tints: --ui-tint-wealth (the card fill), -ink (its labels), -accent (its bars).
  for (const [role, v] of Object.entries(c.tint)) out.push(`--ui-tint-${role}: ${v.fill};`, `--ui-tint-${role}-ink: ${v.ink};`, `--ui-tint-${role}-accent: ${v.accent};`);
  for (const [k, v] of Object.entries(theme.shadow[scheme])) out.push(`--ui-shadow-${k}: ${v};`);
  return out;
}

function sharedVars(theme: Theme): string[] {
  const out: string[] = [];
  const { radius, motion, font, type, space, stroke, icon } = theme;
  for (const k of ["xs", "sm", "md", "lg", "xl", "pill"] as const) out.push(`--ui-r-${k}: ${radius[k]}px;`);
  out.push(
    `--ui-ease: ${motion.easing.standard};`,
    `--ui-ease-soft: ${motion.easing.soft};`,
    `--ui-dur-fast: ${motion.duration.fast}ms;`,
    `--ui-dur: ${motion.duration.base}ms;`,
    `--ui-dur-slow: ${motion.duration.slow}ms;`,
    `--ui-display: ${quote(font.display.family)};`,
  );
  for (const role of ["display", "body", "note", "numeric"] as const) out.push(`--ui-font-${role}: ${quote(font[role].family)};`);
  for (const [k, s] of Object.entries(type)) {
    const n = kebab(k);
    out.push(
      `--ui-type-${n}-size: ${s.size}px;`,
      `--ui-type-${n}-line: ${s.lineHeight}px;`,
      `--ui-type-${n}-weight: ${s.weight};`,
      `--ui-type-${n}-family: var(--ui-font-${s.role});`,
      `--ui-type-${n}-tracking: ${s.letterSpacing}px;`,
    );
  }
  for (const [k, v] of Object.entries(space)) out.push(`--ui-space-${k}: ${v}px;`);
  out.push(`--ui-stroke-hairline: ${stroke.hairline}px;`, `--ui-stroke-outline: ${stroke.outline}px;`);
  for (const [k, v] of Object.entries(icon.size)) out.push(`--ui-icon-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(theme.skin) as Array<[keyof Skins, string]>) out.push(`--ui-skin-${kebab(k)}: ${v};`);
  return out;
}

const block = (selector: string, lines: string[]) => `${selector} {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n`;

export function toCss(theme: Theme): string {
  const id = theme.meta.id;
  const sel = `[data-design="${id}"]`;
  return [
    `/* ${theme.meta.name}: generated from packages/design by toCss. Do not edit. */\n`,
    block(sel, [...sharedVars(theme), ...schemeVars(theme, "light")]),
    block(`${sel}.dark,\n:root.dark${sel}`, schemeVars(theme, "dark")),
  ].join("\n");
}
