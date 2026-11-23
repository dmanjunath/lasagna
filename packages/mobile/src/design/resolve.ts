import { faceFor, withAlpha, type ColorRoles, type Elevation, type Scheme, type Theme, type TypeKey } from "@lasagna/design";
import type { TextStyle } from "react-native";

// A theme turned into what React Native draws with: text styles that name a
// face (never fontWeight: each weight is its own face), the scheme's colors and
// shadows, and the legacy Palette the existing screens read through @/theme.

export type Palette = {
  canvas: string;
  canvasSunken: string;
  panel: string;
  panelRaised: string;
  content: string;
  contentSecondary: string;
  contentMuted: string;
  contentFaint: string;
  /** contentFaint at 22%: the quiet fill of a step still ahead. */
  faintFill: string;
  hairline: string;
  line: string;
  lineStrong: string;
  brand: string;
  brandInk: string;
  brandFg: string;
  brandSoft: string;
  brandSofter: string;
  brandRing: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  accentSofter: string;
  info: string;
  infoSoft: string;
  sky: string;
  skySoft: string;
  violet: string;
  violetSoft: string;
  slate: string;
  slateSoft: string;
  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  dangerSolid: string;
  caution: string;
  cautionSoft: string;
  scrim: string;
  /** A control raised a little off its track (a segmented control's thumb). */
  shadowSm: string;
  /** A surface floating over the page (a toast). */
  shadowLg: string;
  // The home net worth card's credit-card segment (a literal on the web too).
  creditCard: string;
  viz: string[];
  /** The keyboard that matches the scheme. */
  keyboard: "light" | "dark";
};

export type FontNames = {
  regular: string;
  medium: string;
  semibold: string;
  bold: string;
  heading: string;
  headingSemibold: string;
  figure: string;
  figureHeavy: string;
  note: string;
};

export type ResolvedTheme = {
  id: string;
  name: string;
  scheme: Scheme;
  color: ColorRoles;
  palette: Palette;
  font: FontNames;
  type: Record<TypeKey, TextStyle>;
  weight: { regular: TextStyle; medium: TextStyle; semibold: TextStyle; bold: TextStyle };
  figures: TextStyle;
  inputType: TextStyle;
  space: Theme["space"];
  radius: Theme["radius"];
  stroke: Theme["stroke"];
  shadow: Record<Elevation, string>;
  motion: Theme["motion"];
  icon: Theme["icon"];
  skin: Theme["skin"];
  mascot: Theme["mascot"];
  /** The chat screen's title (and the Ask card's): the mascot's invitation where the theme has one ("Chat with Noodle"), else "Chat". The tab itself is "Chat" in every theme. */
  chatTitle: string;
};

function palette(c: ColorRoles, theme: Theme, scheme: Scheme): Palette {
  return {
    canvas: c.canvas,
    canvasSunken: c.canvasSunken,
    panel: c.surface,
    panelRaised: c.surfaceRaised,
    content: c.content,
    contentSecondary: c.contentSecondary,
    contentMuted: c.contentMuted,
    contentFaint: c.contentFaint,
    faintFill: withAlpha(c.contentFaint, 0.22),
    hairline: c.hairline,
    line: c.line,
    lineStrong: c.lineStrong,
    brand: c.brand,
    brandInk: c.brandInk,
    brandFg: c.onBrand,
    brandSoft: c.brandSoft,
    brandSofter: c.brandSofter,
    brandRing: c.brandRing,
    accent: c.accent,
    accentInk: c.accentInk,
    accentSoft: c.accentSoft,
    accentSofter: c.accentSofter,
    info: c.info,
    infoSoft: c.infoSoft,
    sky: c.sky,
    skySoft: c.skySoft,
    violet: c.violet,
    violetSoft: c.violetSoft,
    slate: c.slate,
    slateSoft: c.slateSoft,
    positive: c.positive,
    positiveSoft: c.positiveSoft,
    negative: c.negative,
    negativeSoft: c.negativeSoft,
    dangerSolid: c.dangerSolid,
    caution: c.caution,
    cautionSoft: c.cautionSoft,
    scrim: c.scrim,
    shadowSm: theme.shadow[scheme].sm,
    shadowLg: theme.shadow[scheme].lg,
    creditCard: "#F97316",
    viz: [...c.chart],
    keyboard: scheme,
  };
}

/** Scheme-independent parts: faces and text styles. */
function typography(theme: Theme) {
  const name = (role: keyof Theme["font"], w: 400 | 500 | 600 | 700 | 800) => faceFor(theme.font[role], w).name;
  const font: FontNames = {
    regular: name("body", 400),
    medium: name("body", 500),
    semibold: name("body", 600),
    bold: name("body", 700),
    heading: name("display", 800),
    headingSemibold: name("display", 600),
    figure: name("numeric", 700),
    figureHeavy: name("numeric", 800),
    note: name("note", 700),
  };
  const type = {} as Record<TypeKey, TextStyle>;
  for (const [k, s] of Object.entries(theme.type) as Array<[TypeKey, Theme["type"][TypeKey]]>) {
    type[k] = {
      fontFamily: name(s.role, s.weight),
      fontSize: s.size,
      lineHeight: s.lineHeight,
      ...(s.letterSpacing ? { letterSpacing: s.letterSpacing } : null),
      ...(s.role === "numeric" ? { fontVariant: ["tabular-nums"] as TextStyle["fontVariant"] } : null),
    };
  }
  return {
    font,
    type,
    weight: {
      regular: { fontFamily: font.regular },
      medium: { fontFamily: font.medium },
      semibold: { fontFamily: font.semibold },
      bold: { fontFamily: font.bold },
    },
    figures: { fontFamily: font.figure, fontVariant: ["tabular-nums"] } as TextStyle,
    // A single-line input's text: body without its lineHeight, which UIKit would misplace the text by.
    inputType: { fontFamily: type.body.fontFamily, fontSize: type.body.fontSize } as TextStyle,
  };
}

const cache = new Map<string, ResolvedTheme>();

export function resolve(theme: Theme, scheme: Scheme): ResolvedTheme {
  const key = `${theme.meta.id}:${scheme}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = theme.color[scheme];
  const r: ResolvedTheme = {
    id: theme.meta.id,
    name: theme.meta.name,
    scheme,
    color: c,
    palette: palette(c, theme, scheme),
    ...typography(theme),
    space: theme.space,
    radius: theme.radius,
    stroke: theme.stroke,
    shadow: theme.shadow[scheme],
    motion: theme.motion,
    icon: theme.icon,
    skin: theme.skin,
    mascot: theme.mascot,
    chatTitle: theme.mascot ? `Chat with ${theme.mascot.name}` : "Chat",
  };
  cache.set(key, r);
  return r;
}
