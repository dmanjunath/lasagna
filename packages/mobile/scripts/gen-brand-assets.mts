// Draws the app icon and the launch artwork from the default theme's mascot
// (packages/design/src/mascot/happy.svg) in that theme's colors. Needs
// rsvg-convert (brew install librsvg). Run from packages/mobile:
//   npx tsx scripts/gen-brand-assets.mts
// then rebuild the native app (the icon and launch screen are native assets).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTheme, DEFAULT_THEME_ID } from "../../design/src/index";

const theme = getTheme(DEFAULT_THEME_ID);
if (!theme.mascot) throw new Error(`${theme.meta.id} has no mascot`);
const happy = theme.mascot.happy;
const assets = join(dirname(fileURLToPath(import.meta.url)), "../assets");
const work = mkdtempSync(join(tmpdir(), "brand-"));

// The artwork's viewBox is 140 by 124.
const ART_W = 140;
const ART_H = 124;

/** The mascot's <svg> inner markup with its outline token set. */
function mascotBody(outline: string): string {
  const inner = happy.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<g color="${outline}">${inner}</g>`;
}

/** A square canvas of `side` with the mascot `width` wide at its centre, over `background` (or transparent). */
function square(side: number, width: number, outline: string, background: string | null): string {
  const scale = width / ART_W;
  const x = (side - width) / 2;
  const y = (side - ART_H * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">${
    background ? `<rect width="${side}" height="${side}" fill="${background}"/>` : ""
  }<g transform="translate(${x} ${y}) scale(${scale})">${mascotBody(outline)}</g></svg>`;
}

function render(name: string, svg: string, side: number) {
  const src = join(work, `${name}.svg`);
  writeFileSync(src, svg);
  execFileSync("rsvg-convert", ["-w", String(side), "-h", String(side), "-o", join(assets, name), src]);
  console.log(`wrote assets/${name}`);
}

// App icon: the icon tile, the mascot on the brand fill, full bleed (iOS
// rounds the corners) and opaque, 1024 square.
render("icon.png", square(1024, 760, theme.color.light.content, theme.color.light.brand), 1024);

// Launch artwork: the mascot alone at the centre of a 2732 square, on a
// transparent ground so the launch screen's color (the theme's canvas) shows
// through. Light and dark differ only in the outline, as in the app.
export const SPLASH_SIDE = 2732;
export const SPLASH_MASCOT_W = 520;
render("splash.png", square(SPLASH_SIDE, SPLASH_MASCOT_W, theme.color.light.content, null), SPLASH_SIDE);
render("splash-dark.png", square(SPLASH_SIDE, SPLASH_MASCOT_W, theme.color.dark.content, null), SPLASH_SIDE);
// The canvas the launch screen and root view paint, read by app.config.ts
// (which cannot import the theme's TypeScript).
writeFileSync(join(assets, "brand.json"), `${JSON.stringify({ theme: theme.meta.id, canvas: { light: theme.color.light.canvas, dark: theme.color.dark.canvas } }, null, 2)}\n`);
console.log("wrote assets/brand.json");
