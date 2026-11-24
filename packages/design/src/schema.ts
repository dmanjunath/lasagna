// The shape every design system fills in. A theme is data only: no React, no
// platform code. Web turns it into CSS variables (build/toCss.ts), iOS reads
// the object directly. Components ask for roles ("brandInk"), never raw
// palette names ("basil").

export type Scheme = "light" | "dark";

/** Any CSS color string: #RRGGBB, rgb(), rgba(). */
export type Color = string;

/** A category's tile: a soft fill and the ink drawn on it (icon, letter). */
export type CategoryTone = { fill: Color; ink: Color };

export type Eight<T> = [T, T, T, T, T, T, T, T];

/**
 * What a card or tile is about, so it can wear that subject's color: net worth
 * and accounts (`wealth`), money out (`spend`), money in (`income`), goals and
 * savings (`goal`), actions (`action`, the sticky note), and anything else
 * (`neutral`). A theme with no role colors maps them all to its plain card.
 */
export type TintRole = "wealth" | "spend" | "income" | "goal" | "action" | "neutral";

export const TINT_ROLES: readonly TintRole[] = ["wealth", "spend", "income", "goal", "action", "neutral"];

/**
 * A role's colors: `fill` behind a card or tile (body text on it stays
 * `content`), `ink` for its labels and key icons, `accent` for its bars and
 * chart marks (a graphic, never text).
 */
export type Tint = { fill: Color; ink: Color; accent: Color };

export type ColorRoles = {
  // Surfaces, from the page down to what floats over it.
  canvas: Color;
  /** Wells and tracks set into the page (a progress track, a segmented control). */
  canvasSunken: Color;
  surface: Color;
  /** Popovers, sheets, toasts. */
  surfaceRaised: Color;
  /** A tray set into a surface (a card's footer). */
  surfaceInset: Color;
  /** A quiet filled surface: a soft card, a secondary button, a filled chip. */
  surfaceMuted: Color;

  content: Color;
  contentSecondary: Color;
  contentMuted: Color;
  /** Placeholders, disabled text, decorative marks. Not for text that must be read. */
  contentFaint: Color;

  hairline: Color;
  line: Color;
  lineStrong: Color;

  /** The brand fill: active indicators, progress, checks. */
  brand: Color;
  brandHover: Color;
  brandActive: Color;
  /** Brand-colored text and the primary button's fill. AA on every surface. */
  brandInk: Color;
  /** Text and icons on brandInk (and on brand). */
  onBrand: Color;
  brandSoft: Color;
  brandSofter: Color;
  brandRing: Color;
  /** The darker edge under a chunky button. */
  brandEdge: Color;

  accent: Color;
  accentInk: Color;
  accentSoft: Color;
  accentSofter: Color;

  positive: Color;
  positiveSoft: Color;
  negative: Color;
  negativeSoft: Color;
  dangerSolid: Color;
  onDanger: Color;
  caution: Color;
  cautionSoft: Color;
  info: Color;
  infoSoft: Color;
  sky: Color;
  skySoft: Color;
  violet: Color;
  violetSoft: Color;
  slate: Color;
  slateSoft: Color;

  /** The sticky-note tint behind a highlighted block. Text on it is `content`. */
  highlight: Color;
  /** A divider inside a highlighted block. */
  highlightLine: Color;

  /** A chosen chip, pill or tab-like toggle, and the text on it. */
  selected: Color;
  onSelected: Color;
  /** A segmented control's thumb (its track is canvasSunken), and the text on it. */
  thumb: Color;
  onThumb: Color;

  scrim: Color;
  /** A sparkle beside a win. Decorative, never text. */
  celebration: Color;
  /** A savings jar's empty body. Shows as glass on a card and on the page in both schemes, never as a hole. */
  jar: Color;

  category: Eight<CategoryTone>;
  chart: Eight<Color>;
  tint: Record<TintRole, Tint>;
};

export type FontWeight = 400 | 500 | 600 | 700 | 800;

/** One face of a family. `name` is what a platform asks for (iOS fontFamily, a web @font-face family alias). */
export type FontFace = {
  /** The face's name: the PostScript name where the font is embedded natively, else the runtime alias. */
  name: string;
  /** The file, relative to packages/design. */
  file: string;
};

export type FontRole = {
  /** The family's display name (CSS font-family). */
  family: string;
  faces: Partial<Record<FontWeight, FontFace>>;
};

export type FontRoleName = "display" | "body" | "note" | "numeric";

export type TypeKey =
  | "largeTitle"
  | "title1"
  | "title2"
  | "headline"
  | "body"
  | "callout"
  | "subhead"
  | "footnote"
  | "caption"
  | "amountXL"
  | "amountL"
  | "amountM"
  /** The handwritten accent (Note). Equals a body style when the theme has no handwriting. */
  | "note";

export type TypeStyle = {
  size: number;
  lineHeight: number;
  weight: FontWeight;
  role: FontRoleName;
  letterSpacing: number;
};

export type SizeScale = { xs: number; sm: number; md: number; lg: number; xl: number };

/** A CSS box-shadow string ("none", a soft blur, or an offset with no blur). RN accepts the same string. */
export type ShadowDef = string;

export type Elevation = "sm" | "md" | "lg" | "xl";

export type Skins = {
  card: "flat" | "outlined" | "offset" | "soft";
  button: "pill" | "rounded" | "chunky";
  row: "plain" | "inset" | "carded";
  chip: "filled" | "outlined";
  /** A page-top or section pill: raised (the selected one filled in the brand or role ink with a soft edge shadow, the rest flat on the card fill with a hairline), or plain (the selected one on the selected tint). */
  pill: "raised" | "plain";
  /** The web Spending breakdown: ranked rows (a category tile, the name and amount over a share track, a Money out / Money in switch, as the app draws it), or the web's original proportional bars. */
  breakdown: "ranked" | "bars";
  tabBar: "standard" | "floating" | "pill";
  header: "plain" | "blurred";
  emptyArt: "mascot" | "icon" | "none";
  celebration: "sparkle" | "none";
  noteAccent: "handwritten" | "none";
  progress: "bar" | "jar";
  /** Home's action rows: on the highlight (sticky-note) tint with a value pill, or white cards with an area accent bar and area chip. */
  actionCard: "highlight" | "accentBar";
  /** A list's money summary: two tinted tiles (in, out), or one card of four figures (count, in, out, net). */
  summary: "tiles" | "card";
  /** A category's icon tile: its category tone, or one neutral fill for every category. */
  categoryTile: "tinted" | "neutral";
  /** Home's greeting: the mascot's speech bubble, or a large title on a soft-gradient card that holds the actions. */
  greeting: "bubble" | "card";
  /** The art on the lock and app-switcher cover: the mascot, or the brand mark. */
  brandArt: "mascot" | "mark";
  /**
   * Pull to refresh: the mascot slides down from under the nav bar, hops once
   * armed and bobs while it loads, or the brand mark is pulled down out of the
   * nav bar and lands back in it with a puff of smoke (the web's original).
   */
  refresh: "mascot" | "brandPuff";
  /** A screen with nothing to show: open on the page under its title, or on one panel card (the web's page empty state). */
  emptyState: "open" | "panel";
  /** A goal card's next step: a text link (the card itself opens the goal), or the web's footer of a tinted button beside "View goal". */
  cardAction: "link" | "footer";
};

/**
 * The theme's character: its name (it names the chat tab, "Chat with Lasagna")
 * and named SVG sources, as complete <svg> documents. In the artwork,
 * `currentColor` is the outline token (the silhouette and arms): the app sets
 * it per scheme so the outline shows on a dark canvas.
 */
export type Mascot = { name: string; happy: string; sleepy: string };

export type Theme = {
  meta: { id: string; name: string };
  color: Record<Scheme, ColorRoles>;
  font: Record<FontRoleName, FontRole>;
  type: Record<TypeKey, TypeStyle>;
  /**
   * The spacing scale, plus the page's density: `screen` is the gutter
   * between the screen edge and a card, `card` a card's inner padding, and
   * `rowInset` a list row's horizontal inset inside a full-width list card.
   * Content starts `screen + card` from the screen edge.
   */
  space: { xxs: number; xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; screen: number; card: number; rowInset: number };
  radius: SizeScale & { pill: number };
  stroke: { hairline: number; outline: number };
  shadow: Record<Scheme, Record<Elevation, ShadowDef>>;
  motion: {
    duration: { fast: number; base: number; slow: number };
    easing: { standard: string; soft: string };
    spring: { damping: number; stiffness: number; mass: number };
  };
  icon: {
    size: SizeScale;
    /** SF Symbol weight / stroke weight for line icons. */
    weight: "regular" | "medium" | "semibold" | "bold";
  };
  skin: Skins;
  /** Absent: mascot surfaces fall back to the emptyArt icon. */
  mascot?: Mascot;
};

/** The face for a role and weight: the exact weight, else the nearest one the role has. */
export function faceFor(role: FontRole, weight: FontWeight): FontFace {
  const exact = role.faces[weight];
  if (exact) return exact;
  const weights = (Object.keys(role.faces).map(Number) as FontWeight[]).sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight) || b - a);
  const face = role.faces[weights[0]];
  if (!face) throw new Error(`Font role ${role.family} has no faces`);
  return face;
}
