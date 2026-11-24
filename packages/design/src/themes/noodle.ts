import { happy, sleepy } from "../mascot/generated";
import type { ColorRoles, Theme } from "../schema";

// Noodle, clean: white space, rounded soft cards, one friendly character.
// Palette names (for reading this file only, components use the roles):
// basil #1DB06B, sauce #F0442E, pasta #FFC93C, denim #3B6E9E,
// cream #FBF6EC, ink #2A2420, pasta wash #FFF5D6 (the one yellow, see YELLOW).
//
// Every neutral is warm (owner decision 2026-11-22, "Warm cream"): cream
// cards, warm lines, a brown-black ink, a warm charcoal dark canvas. No cool
// gray or navy, which noodle-warm.test.ts enforces.
//
// Basil is too light for white text (2.8:1), so text and the primary button
// fill use a deeper basil (#0E7A45, 5.4:1 with white).

/**
 * Noodle's one yellow (owner decision 2026-11-23): the goal and action hero
 * fill, the action block's divider, and the chip step (value chips, the yellow
 * category tile, caution washes). The chip stays visible on both the cream card
 * and the yellow hero, so a yellow always looks the same.
 */
export const YELLOW = {
  light: { fill: "#FFF5D6", line: "#F0E2B6", chip: "#FFE8A3", ink: "#8A5A00" },
  dark: { fill: "#3E3117", line: "#56451F", chip: "#6E5622", ink: "#FFD166" },
} as const;

const light: ColorRoles = {
  // Warm page, white cards (owner decision 2026-11-23, "Surfaces" option A):
  // the cream moves to the page, so cards lift off it with a warm edge and a
  // soft shadow, and yellow only shows in chips and the yellow heroes.
  canvas: "#F6EFE3",
  // A step under the page, so a track still shows inside a white card and a press reads on one.
  canvasSunken: "#F2EBDD",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  // A pill, search field or filled chip: a step deeper than the page, so it shows on the page and on a white card.
  surfaceInset: "#ECE3D2",
  // The soft card: white on the warm page.
  surfaceMuted: "#FFFFFF",
  content: "#2A2420",
  contentSecondary: "#4D4339",
  contentMuted: "#75695A",
  contentFaint: "#ADA08C",
  // The card's warm edge.
  hairline: "#ECE2D0",
  line: "#E6DAC4",
  lineStrong: "#D3C4A9",
  brand: "#1DB06B",
  brandHover: "#19A062",
  brandActive: "#168F57",
  brandInk: "#0E7A45",
  onBrand: "#FFFFFF",
  brandSoft: "#E6F7EE",
  brandSofter: "#F3FBF7",
  brandRing: "rgba(14, 122, 69, 0.9)",
  brandEdge: "#0A5A33",
  // Denim (owner, 2026-11-23): a muted blue that sits with the warm palette, replacing blueberry.
  accent: "#3B6E9E",
  accentInk: "#2C5A84",
  accentSoft: "#E8EEF5",
  accentSofter: "#F3F6F9",
  positive: "#0E7A45",
  positiveSoft: "#E6F7EE",
  negative: "#C2311E",
  negativeSoft: "#FFF4F1",
  dangerSolid: "#C2311E",
  onDanger: "#FFFFFF",
  caution: "#8A5A00",
  cautionSoft: YELLOW.light.chip,
  info: "#2C5A84",
  infoSoft: "#E8EEF5",
  sky: "#0369A1",
  skySoft: "#E3F3FC",
  violet: "#7B2CBF",
  violetSoft: "#F4EAFD",
  slate: "#5A4E42",
  slateSoft: "#F3EBDC",
  highlight: YELLOW.light.fill,
  highlightLine: YELLOW.light.line,
  selected: "#E6F7EE",
  onSelected: "#0E7A45",
  thumb: "#FFFFFF",
  onThumb: "#0E7A45",
  scrim: "rgba(42, 36, 32, 0.35)",
  celebration: "#FFC93C",
  // A step under the canvasSunken track, so the glass also shows on the pasta goal card.
  jar: "#E3D8C3",
  category: [
    { fill: "#E6F7EE", ink: "#0E7A45" },
    { fill: "#E8EEF5", ink: "#2C5A84" },
    { fill: YELLOW.light.chip, ink: YELLOW.light.ink },
    { fill: "#FFE9E4", ink: "#C2311E" },
    { fill: "#E3F3FC", ink: "#0369A1" },
    { fill: "#F4EAFD", ink: "#7B2CBF" },
    { fill: "#F3EBDC", ink: "#5A4E42" },
    { fill: "#FDE8F1", ink: "#B0216A" },
  ],
  // Slot 5 (property, "other") is a lighter Denim step, never a new hue: it sits beside Denim (slot 2) in the net worth bar.
  chart: ["#1DB06B", "#3B6E9E", "#FFC93C", "#F0442E", "#86A8C9", "#84CC16", "#8C7B66", "#A855F7"],
  // The mockup's card colors: denim for net worth, sauce for spending,
  // basil for money in, pasta for goals, the sticky note for actions, cream
  // for the rest. Labels take the deeper ink (basil's is the primary green).
  tint: {
    wealth: { fill: "#E8EEF5", ink: "#2C5A84", accent: "#3B6E9E" },
    spend: { fill: "#FFF4F1", ink: "#C2311E", accent: "#F0442E" },
    income: { fill: "#E6F7EE", ink: "#0E7A45", accent: "#1DB06B" },
    goal: { fill: YELLOW.light.fill, ink: YELLOW.light.ink, accent: "#FFC93C" },
    action: { fill: YELLOW.light.fill, ink: YELLOW.light.ink, accent: "#FFC93C" },
    neutral: { fill: "#FBF6EC", ink: "#75695A", accent: "#ADA08C" },
  },
};

// Dark: a warm charcoal canvas, surfaces raised by lightening the same warm
// brown, and the sauce, pasta and denim lifted until they read on it.
const dark: ColorRoles = {
  canvas: "#171513",
  canvasSunken: "#0F0D0C",
  surface: "#1F1C18",
  surfaceRaised: "#2C2723",
  surfaceInset: "#2E2924",
  surfaceMuted: "#24201C",
  content: "#F6F1EA",
  contentSecondary: "#DDD3C5",
  contentMuted: "#B9AD9C",
  contentFaint: "#7F7466",
  hairline: "#3A332C",
  line: "#463E35",
  lineStrong: "#5C5247",
  brand: "#3DD68A",
  brandHover: "#5ADF9C",
  brandActive: "#2FC47A",
  brandInk: "#4ADE8E",
  onBrand: "#0B1F14",
  brandSoft: "rgba(61, 214, 138, 0.16)",
  brandSofter: "rgba(61, 214, 138, 0.08)",
  brandRing: "rgba(74, 222, 142, 0.55)",
  brandEdge: "#1F8F57",
  accent: "#7FA9D3",
  accentInk: "#9CC0E3",
  // Opaque deep blues: a translucent blue on the warm charcoal lands as a slate gray.
  accentSoft: "#1E2B38",
  accentSofter: "#18232F",
  positive: "#4ADE8E",
  positiveSoft: "rgba(74, 222, 142, 0.14)",
  negative: "#FF8A75",
  negativeSoft: "rgba(255, 122, 102, 0.16)",
  dangerSolid: "#C2311E",
  onDanger: "#FFFFFF",
  caution: "#FFD166",
  cautionSoft: YELLOW.dark.chip,
  info: "#9CC0E3",
  infoSoft: "#21303F",
  sky: "#7DD3FC",
  skySoft: "#133B4D",
  violet: "#D8B4FE",
  violetSoft: "#3A2552",
  slate: "#D6CBBB",
  slateSoft: "rgba(185, 173, 156, 0.20)",
  // A warm, dim sticky note.
  highlight: YELLOW.dark.fill,
  highlightLine: YELLOW.dark.line,
  selected: "#163A2F",
  onSelected: "#4ADE8E",
  thumb: "#36302A",
  onThumb: "#4ADE8E",
  scrim: "rgba(0, 0, 0, 0.5)",
  celebration: "#FFD166",
  // Well above the card surface and the deep tints (the yellow goal hero too), so an empty jar reads as glass and not as a dark hole.
  jar: "#6A5C48",
  category: [
    { fill: "rgba(61, 214, 138, 0.16)", ink: "#4ADE8E" },
    { fill: "#21303F", ink: "#9CC0E3" },
    { fill: YELLOW.dark.chip, ink: YELLOW.dark.ink },
    { fill: "rgba(255, 122, 102, 0.16)", ink: "#FF8A75" },
    { fill: "#133B4D", ink: "#7DD3FC" },
    { fill: "#3A2552", ink: "#D8B4FE" },
    { fill: "rgba(185, 173, 156, 0.20)", ink: "#D6CBBB" },
    { fill: "rgba(244, 114, 182, 0.18)", ink: "#F9A8D4" },
  ],
  chart: ["#3DD68A", "#7FA9D3", "#FFD166", "#FF8A75", "#4F7499", "#A3E635", "#B3A491", "#C084FC"],
  // Deep, opaque versions of the light tints: each a step above the card
  // surface so a tinted card still reads as a card, with the lifted inks.
  tint: {
    wealth: { fill: "#1E2B38", ink: "#9CC0E3", accent: "#7FA9D3" },
    spend: { fill: "#42231F", ink: "#FF9B88", accent: "#FF7A66" },
    income: { fill: "#163A2F", ink: "#4ADE8E", accent: "#3DD68A" },
    goal: { fill: YELLOW.dark.fill, ink: YELLOW.dark.ink, accent: "#FFC93C" },
    action: { fill: YELLOW.dark.fill, ink: YELLOW.dark.ink, accent: "#FFC93C" },
    neutral: { fill: "#24201C", ink: "#B9AD9C", accent: "#7F7466" },
  },
};

const face = (name: string, file: string) => ({ name, file: `fonts/${file}` });

export const noodle: Theme = {
  meta: { id: "noodle", name: "Noodle" },
  color: { light, dark },
  font: {
    display: {
      family: "Baloo 2",
      faces: {
        700: face("Baloo2-Bold", "Baloo2_700Bold.ttf"),
        800: face("Baloo2-ExtraBold", "Baloo2_800ExtraBold.ttf"),
      },
    },
    body: {
      family: "DM Sans",
      faces: {
        400: face("DMSans-Regular", "DMSans_400Regular.ttf"),
        500: face("DMSans-Medium", "DMSans_500Medium.ttf"),
        600: face("DMSans-SemiBold", "DMSans_600SemiBold.ttf"),
        700: face("DMSans-Bold", "DMSans_700Bold.ttf"),
      },
    },
    note: { family: "Caveat", faces: { 700: face("Caveat-Bold", "Caveat_700Bold.ttf") } },
    numeric: {
      family: "Baloo 2",
      faces: {
        700: face("Baloo2-Bold", "Baloo2_700Bold.ttf"),
        800: face("Baloo2-ExtraBold", "Baloo2_800ExtraBold.ttf"),
      },
    },
  },
  type: {
    largeTitle: { size: 34, lineHeight: 40, weight: 800, role: "display", letterSpacing: 0 },
    title1: { size: 28, lineHeight: 34, weight: 800, role: "display", letterSpacing: 0 },
    title2: { size: 21, lineHeight: 28, weight: 800, role: "display", letterSpacing: 0 },
    headline: { size: 17, lineHeight: 22, weight: 700, role: "body", letterSpacing: 0 },
    body: { size: 17, lineHeight: 23, weight: 400, role: "body", letterSpacing: 0 },
    callout: { size: 16, lineHeight: 22, weight: 400, role: "body", letterSpacing: 0 },
    subhead: { size: 15, lineHeight: 20, weight: 400, role: "body", letterSpacing: 0 },
    footnote: { size: 13, lineHeight: 18, weight: 400, role: "body", letterSpacing: 0 },
    caption: { size: 12, lineHeight: 16, weight: 600, role: "body", letterSpacing: 0 },
    amountXL: { size: 34, lineHeight: 42, weight: 800, role: "numeric", letterSpacing: 0 },
    amountL: { size: 24, lineHeight: 30, weight: 800, role: "numeric", letterSpacing: 0 },
    amountM: { size: 18, lineHeight: 24, weight: 700, role: "numeric", letterSpacing: 0 },
    note: { size: 22, lineHeight: 26, weight: 700, role: "note", letterSpacing: 0 },
  },
  // Density: an 8pt gutter and 16pt card padding, so content starts 24pt from the screen edge.
  space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, screen: 8, card: 16, rowInset: 16 },
  radius: { xs: 8, sm: 12, md: 16, lg: 24, xl: 28, pill: 999 },
  stroke: { hairline: 1, outline: 2 },
  shadow: {
    light: {
      // The soft card's shadow: barely there, so the edge does most of the lifting.
      sm: "0 1px 2px rgba(42, 36, 32, 0.05), 0 4px 12px rgba(42, 36, 32, 0.04)",
      md: "0 4px 14px rgba(42, 36, 32, 0.08)",
      lg: "0 10px 28px rgba(42, 36, 32, 0.16)",
      xl: "0 24px 56px rgba(42, 36, 32, 0.20)",
    },
    dark: {
      sm: "0 1px 3px rgba(0, 0, 0, 0.45)",
      md: "0 4px 14px rgba(0, 0, 0, 0.45)",
      lg: "0 10px 28px rgba(0, 0, 0, 0.55)",
      xl: "0 24px 56px rgba(0, 0, 0, 0.62)",
    },
  },
  motion: {
    duration: { fast: 150, base: 220, slow: 300 },
    easing: { standard: "cubic-bezier(0.34, 1.4, 0.64, 1)", soft: "cubic-bezier(0.4, 0, 0.2, 1)" },
    spring: { damping: 14, stiffness: 200, mass: 1 },
  },
  icon: { size: { xs: 11, sm: 13, md: 17, lg: 22, xl: 28 }, weight: "bold" },
  skin: {
    card: "soft",
    button: "chunky",
    row: "plain",
    chip: "filled",
    pill: "raised",
    breakdown: "ranked",
    tabBar: "standard",
    header: "plain",
    emptyArt: "mascot",
    celebration: "sparkle",
    noteAccent: "handwritten",
    progress: "jar",
    actionCard: "highlight",
    summary: "tiles",
    categoryTile: "tinted",
    greeting: "bubble",
    brandArt: "mascot",
    refresh: "mascot",
    cardAction: "link",
    emptyState: "open",
  },
  mascot: { name: "Lasagna", happy, sleepy },
};
