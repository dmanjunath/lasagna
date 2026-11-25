import { getTheme, splitWavingArm } from "@lasagna/design";
import { toCss } from "@lasagna/design/build/toCss";
import { fontsUrl, iconTileSvg } from "@lasagna/design/build/webCss";
import happy from "@lasagna/design/mascot/happy.svg?raw";

// The site renders in the app's Noodle design. Every color, radius, shadow and
// face comes from packages/design, the same source the app reads, so the site
// can never drift from the product.
const theme = getTheme("noodle");

/** The theme's --ui-* variables under [data-design="noodle"], light and .dark. */
export const designCss = toCss(theme);
/** The Google Fonts stylesheet for the theme's faces. */
export const fonts = fontsUrl(theme);
/** The app icon tile (the mascot on the brand fill), as an SVG string. */
export const tileSvg = iconTileSvg(theme, 180) ?? "";
/** The mascot split into a still body and the raised arm, for the hello wave. */
export const mascot = splitWavingArm(happy) ?? { body: happy, arm: "" };
export const fullMascot = happy;

/**
 * The mascot's artwork without its outer <svg>, for placing Noodle inside an
 * illustration in the artwork's own 140 by 124 coordinates. `arm` is the
 * raised arm alone, turned at the shoulder (122, 70) for a wave.
 */
const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<!--[\s\S]*?-->/g, "");
export const mascotParts = { body: inner(mascot.body), arm: mascot.arm ? inner(mascot.arm) : "" };
