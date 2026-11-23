import type { ColorRoles, Theme, Tint, TintRole } from "../schema";

// The look the app shipped with before Noodle: the --ui-* tokens of
// packages/web/src/styles/theme.css as packages/mobile/src/theme.ts mirrored
// them. Kept as the fallback and as proof that swapping works.

type Base = Omit<ColorRoles, "tint">;

const rgb = (r: number, g: number, b: number) => `rgb(${r}, ${g}, ${b})`;

const lightBase: Base = {
  canvas: rgb(247, 249, 252),
  canvasSunken: rgb(238, 242, 247),
  surface: rgb(255, 255, 255),
  surfaceRaised: rgb(255, 255, 255),
  surfaceInset: rgb(238, 242, 247),
  surfaceMuted: rgb(238, 242, 247),
  content: rgb(16, 24, 38),
  contentSecondary: rgb(56, 70, 90),
  contentMuted: rgb(92, 107, 128),
  contentFaint: rgb(134, 147, 166),
  hairline: "rgba(16, 24, 38, 0.07)",
  line: "rgba(16, 24, 38, 0.12)",
  lineStrong: "rgba(16, 24, 38, 0.20)",
  brand: rgb(5, 178, 121),
  brandHover: rgb(4, 158, 107),
  brandActive: rgb(3, 138, 93),
  brandInk: rgb(4, 122, 84),
  onBrand: rgb(255, 255, 255),
  brandSoft: "rgba(5, 178, 121, 0.12)",
  brandSofter: "rgba(5, 178, 121, 0.06)",
  brandRing: "rgba(4, 122, 84, 0.9)",
  brandEdge: rgb(3, 92, 63),
  accent: rgb(99, 102, 241),
  accentInk: rgb(79, 70, 229),
  accentSoft: "rgba(99, 102, 241, 0.12)",
  accentSofter: "rgba(99, 102, 241, 0.06)",
  positive: rgb(13, 110, 103),
  positiveSoft: "rgba(13, 148, 136, 0.13)",
  negative: rgb(190, 20, 62),
  negativeSoft: "rgba(244, 73, 110, 0.14)",
  dangerSolid: rgb(201, 24, 68),
  onDanger: rgb(255, 255, 255),
  caution: rgb(140, 86, 0),
  cautionSoft: "rgba(245, 158, 11, 0.16)",
  info: rgb(79, 70, 229),
  infoSoft: "rgba(99, 102, 241, 0.13)",
  sky: rgb(3, 105, 161),
  skySoft: "rgba(14, 165, 233, 0.15)",
  violet: rgb(107, 33, 168),
  violetSoft: "rgba(168, 85, 247, 0.15)",
  slate: rgb(51, 65, 85),
  slateSoft: "rgba(100, 116, 139, 0.16)",
  highlight: rgb(255, 247, 230),
  highlightLine: "rgba(140, 86, 0, 0.16)",
  // A chosen chip in ink, a segmented thumb as a raised panel: the look before role colors.
  selected: rgb(16, 24, 38),
  onSelected: rgb(247, 249, 252),
  thumb: rgb(255, 255, 255),
  onThumb: rgb(16, 24, 38),
  scrim: "rgba(16, 24, 38, 0.35)",
  celebration: "#F59E0B",
  jar: rgb(238, 242, 247),
  category: [
    { fill: "rgba(5, 178, 121, 0.12)", ink: rgb(4, 122, 84) },
    { fill: "rgba(99, 102, 241, 0.12)", ink: rgb(79, 70, 229) },
    { fill: "rgba(245, 158, 11, 0.16)", ink: rgb(140, 86, 0) },
    { fill: "rgba(244, 73, 110, 0.14)", ink: rgb(190, 20, 62) },
    { fill: "rgba(14, 165, 233, 0.15)", ink: rgb(3, 105, 161) },
    { fill: "rgba(13, 148, 136, 0.13)", ink: rgb(13, 110, 103) },
    { fill: "rgba(100, 116, 139, 0.16)", ink: rgb(51, 65, 85) },
    { fill: "rgba(168, 85, 247, 0.15)", ink: rgb(107, 33, 168) },
  ],
  chart: ["#14B8A6", "#6366F1", "#F59E0B", "#F4496E", "#0EA5E9", "#84CC16", "#64748B", "#A855F7"],
};

const darkBase: Base = {
  canvas: rgb(13, 17, 23),
  canvasSunken: rgb(9, 12, 17),
  surface: rgb(22, 27, 35),
  surfaceRaised: rgb(28, 35, 45),
  surfaceInset: rgb(18, 22, 29),
  surfaceMuted: rgb(28, 35, 45),
  content: rgb(244, 247, 251),
  contentSecondary: rgb(226, 232, 240),
  contentMuted: rgb(203, 212, 224),
  contentFaint: rgb(160, 172, 190),
  hairline: "rgba(255, 255, 255, 0.08)",
  line: "rgba(255, 255, 255, 0.14)",
  lineStrong: "rgba(255, 255, 255, 0.24)",
  brand: rgb(30, 216, 148),
  brandHover: rgb(64, 226, 165),
  brandActive: rgb(22, 196, 132),
  brandInk: rgb(30, 216, 148),
  onBrand: rgb(6, 32, 23),
  brandSoft: "rgba(30, 216, 148, 0.16)",
  brandSofter: "rgba(30, 216, 148, 0.09)",
  brandRing: "rgba(30, 216, 148, 0.50)",
  brandEdge: rgb(14, 140, 94),
  accent: rgb(129, 140, 248),
  accentInk: rgb(165, 173, 250),
  accentSoft: "rgba(129, 140, 248, 0.16)",
  accentSofter: "rgba(129, 140, 248, 0.09)",
  positive: rgb(94, 234, 212),
  positiveSoft: "rgba(94, 234, 212, 0.16)",
  negative: rgb(255, 109, 140),
  negativeSoft: "rgba(255, 109, 140, 0.18)",
  dangerSolid: rgb(201, 24, 68),
  onDanger: rgb(255, 255, 255),
  caution: rgb(251, 191, 36),
  cautionSoft: "rgba(251, 191, 36, 0.16)",
  info: rgb(165, 173, 250),
  infoSoft: "rgba(129, 140, 248, 0.18)",
  sky: rgb(125, 211, 252),
  skySoft: "rgba(56, 189, 248, 0.18)",
  violet: rgb(216, 180, 254),
  violetSoft: "rgba(192, 132, 252, 0.18)",
  slate: rgb(203, 213, 225),
  slateSoft: "rgba(148, 163, 184, 0.20)",
  highlight: rgb(42, 36, 22),
  highlightLine: "rgba(251, 191, 36, 0.18)",
  selected: rgb(244, 247, 251),
  onSelected: rgb(13, 17, 23),
  thumb: rgb(28, 35, 45),
  onThumb: rgb(244, 247, 251),
  scrim: "rgba(0, 0, 0, 0.35)",
  celebration: "#FBBF24",
  jar: rgb(37, 45, 58),
  category: [
    { fill: "rgba(30, 216, 148, 0.16)", ink: rgb(30, 216, 148) },
    { fill: "rgba(129, 140, 248, 0.16)", ink: rgb(165, 173, 250) },
    { fill: "rgba(251, 191, 36, 0.16)", ink: rgb(251, 191, 36) },
    { fill: "rgba(255, 109, 140, 0.18)", ink: rgb(255, 109, 140) },
    { fill: "rgba(56, 189, 248, 0.18)", ink: rgb(125, 211, 252) },
    { fill: "rgba(94, 234, 212, 0.16)", ink: rgb(94, 234, 212) },
    { fill: "rgba(148, 163, 184, 0.20)", ink: rgb(203, 213, 225) },
    { fill: "rgba(192, 132, 252, 0.18)", ink: rgb(216, 180, 254) },
  ],
  chart: ["#2DD4BF", "#818CF8", "#FBBF24", "#FB7185", "#38BDF8", "#A3E635", "#94A3B8", "#C084FC"],
};

// Classic has no role colors: every tinted card is its plain panel with muted
// labels, and the bars keep the chart colors they always had (money in and
// a balance trend in the second, money out in the fourth).
function plainTints(c: Base): Record<TintRole, Tint> {
  const plain = (accent: string): Tint => ({ fill: c.surface, ink: c.contentMuted, accent });
  return {
    wealth: plain(c.chart[1]),
    spend: plain(c.chart[3]),
    income: plain(c.chart[1]),
    goal: plain(c.brand),
    action: { fill: c.highlight, ink: c.caution, accent: c.celebration },
    neutral: plain(c.contentFaint),
  };
}

const light: ColorRoles = { ...lightBase, tint: plainTints(lightBase) };
const dark: ColorRoles = { ...darkBase, tint: plainTints(darkBase) };

const face = (name: string, file: string) => ({ name, file: `fonts/${file}` });

const body = {
  family: "Plus Jakarta Sans",
  faces: {
    400: face("PlusJakartaSans-Regular", "PlusJakartaSans_400Regular.ttf"),
    500: face("PlusJakartaSans-Medium", "PlusJakartaSans_500Medium.ttf"),
    600: face("PlusJakartaSans-SemiBold", "PlusJakartaSans_600SemiBold.ttf"),
    700: face("PlusJakartaSans-Bold", "PlusJakartaSans_700Bold.ttf"),
  },
};

export const classic: Theme = {
  meta: { id: "classic", name: "Classic" },
  color: { light, dark },
  font: {
    display: {
      family: "Instrument Sans",
      faces: {
        600: face("InstrumentSans-SemiBold", "InstrumentSans_600SemiBold.ttf"),
        700: face("InstrumentSans-Bold", "InstrumentSans_700Bold.ttf"),
      },
    },
    body,
    // No handwriting: the note accent is set in the body face.
    note: body,
    numeric: {
      family: "Figtree",
      faces: {
        700: face("Figtree-Bold", "Figtree_700Bold.ttf"),
        800: face("Figtree-ExtraBold", "Figtree_800ExtraBold.ttf"),
      },
    },
  },
  type: {
    largeTitle: { size: 30, lineHeight: 36, weight: 700, role: "display", letterSpacing: -0.6 },
    title1: { size: 26, lineHeight: 32, weight: 700, role: "display", letterSpacing: -0.5 },
    title2: { size: 21, lineHeight: 26, weight: 700, role: "display", letterSpacing: -0.3 },
    headline: { size: 17, lineHeight: 22, weight: 600, role: "body", letterSpacing: 0 },
    body: { size: 17, lineHeight: 22, weight: 400, role: "body", letterSpacing: 0 },
    callout: { size: 16, lineHeight: 22, weight: 400, role: "body", letterSpacing: 0 },
    subhead: { size: 15, lineHeight: 20, weight: 400, role: "body", letterSpacing: 0 },
    footnote: { size: 13, lineHeight: 18, weight: 400, role: "body", letterSpacing: 0 },
    caption: { size: 12, lineHeight: 16, weight: 500, role: "body", letterSpacing: 0 },
    amountXL: { size: 34, lineHeight: 40, weight: 800, role: "numeric", letterSpacing: -0.8 },
    amountL: { size: 24, lineHeight: 30, weight: 800, role: "numeric", letterSpacing: -0.4 },
    amountM: { size: 17, lineHeight: 22, weight: 700, role: "numeric", letterSpacing: 0 },
    note: { size: 15, lineHeight: 20, weight: 500, role: "note", letterSpacing: 0 },
  },
  // Density: an 8pt gutter and 16pt card padding, so content starts 24pt from the screen edge.
  space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, screen: 8, card: 16, rowInset: 16 },
  radius: { xs: 6, sm: 8, md: 12, lg: 16, xl: 22, pill: 999 },
  stroke: { hairline: 0.5, outline: 1 },
  shadow: {
    light: {
      sm: "0 1px 3px rgba(16, 24, 38, 0.12)",
      md: "0 2px 6px rgba(20, 33, 61, 0.06), 0 10px 24px rgba(20, 33, 61, 0.09)",
      lg: "0 8px 24px rgba(16, 24, 38, 0.18)",
      xl: "0 24px 56px rgba(20, 33, 61, 0.18)",
    },
    dark: {
      sm: "0 1px 3px rgba(0, 0, 0, 0.4)",
      md: "0 2px 8px rgba(0, 0, 0, 0.45), 0 12px 28px rgba(0, 0, 0, 0.40)",
      lg: "0 8px 24px rgba(0, 0, 0, 0.45)",
      xl: "0 28px 60px rgba(0, 0, 0, 0.62)",
    },
  },
  motion: {
    duration: { fast: 150, base: 200, slow: 260 },
    easing: { standard: "cubic-bezier(0.22, 1, 0.36, 1)", soft: "cubic-bezier(0.4, 0, 0.2, 1)" },
    spring: { damping: 20, stiffness: 220, mass: 1 },
  },
  icon: { size: { xs: 11, sm: 13, md: 17, lg: 22, xl: 28 }, weight: "semibold" },
  skin: {
    card: "outlined",
    button: "rounded",
    row: "inset",
    chip: "outlined",
    tabBar: "standard",
    header: "blurred",
    emptyArt: "icon",
    celebration: "none",
    noteAccent: "none",
    progress: "bar",
    actionCard: "accentBar",
    summary: "card",
    categoryTile: "neutral",
    greeting: "card",
    brandArt: "mark",
    refresh: "brandPuff",
    cardAction: "footer",
    emptyState: "panel",
  },
};
