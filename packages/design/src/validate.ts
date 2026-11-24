import { z } from "zod";
import { parseColor } from "./color";
import { TINT_ROLES, type Theme, type TintRole } from "./schema";

// The Theme type, checked at runtime. Tests run every registered theme through
// it, so a theme with a missing role or an unparseable color fails the suite.
// The annotation keeps this in step with schema.ts: a field added there and
// not here is a compile error.

const color = z.string().refine((c) => {
  try {
    parseColor(c);
    return true;
  } catch {
    return false;
  }
}, "not a #RRGGBB, rgb() or rgba() color");

const tint = z.strictObject({ fill: color, ink: color, accent: color });

const eight = <T extends z.ZodTypeAny>(t: T) => z.tuple([t, t, t, t, t, t, t, t]);

const colorRoles = z.strictObject({
  canvas: color,
  canvasSunken: color,
  surface: color,
  surfaceRaised: color,
  surfaceInset: color,
  surfaceMuted: color,
  content: color,
  contentSecondary: color,
  contentMuted: color,
  contentFaint: color,
  hairline: color,
  line: color,
  lineStrong: color,
  brand: color,
  brandHover: color,
  brandActive: color,
  brandInk: color,
  onBrand: color,
  brandSoft: color,
  brandSofter: color,
  brandRing: color,
  brandEdge: color,
  accent: color,
  accentInk: color,
  accentSoft: color,
  accentSofter: color,
  positive: color,
  positiveSoft: color,
  negative: color,
  negativeSoft: color,
  dangerSolid: color,
  onDanger: color,
  caution: color,
  cautionSoft: color,
  info: color,
  infoSoft: color,
  sky: color,
  skySoft: color,
  violet: color,
  violetSoft: color,
  slate: color,
  slateSoft: color,
  highlight: color,
  highlightLine: color,
  selected: color,
  onSelected: color,
  thumb: color,
  onThumb: color,
  scrim: color,
  celebration: color,
  jar: color,
  category: eight(z.strictObject({ fill: color, ink: color })),
  chart: eight(color),
  tint: z.strictObject(Object.fromEntries(TINT_ROLES.map((r) => [r, tint])) as Record<TintRole, typeof tint>),
});

const weight = z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]);
const face = z.strictObject({ name: z.string().min(1), file: z.string().regex(/^fonts\/.+\.(ttf|otf)$/) });
const fontRole = z.strictObject({
  family: z.string().min(1),
  faces: z
    .partialRecord(z.enum(["400", "500", "600", "700", "800"]), face)
    .refine((f) => Object.keys(f).length > 0, "a font role needs at least one face"),
});
const typeStyle = z.strictObject({
  size: z.number().positive(),
  lineHeight: z.number().positive(),
  weight,
  role: z.enum(["display", "body", "note", "numeric"]),
  letterSpacing: z.number(),
});
const size = z.strictObject({ xs: z.number(), sm: z.number(), md: z.number(), lg: z.number(), xl: z.number() });
const elevations = z.strictObject({ sm: z.string(), md: z.string(), lg: z.string(), xl: z.string() });
const svg = z.string().regex(/^<svg[\s\S]*<\/svg>$/);

export const themeSchema = z.strictObject({
  meta: z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), name: z.string().min(1) }),
  color: z.strictObject({ light: colorRoles, dark: colorRoles }),
  font: z.strictObject({ display: fontRole, body: fontRole, note: fontRole, numeric: fontRole }),
  type: z.strictObject({
    largeTitle: typeStyle,
    title1: typeStyle,
    title2: typeStyle,
    headline: typeStyle,
    body: typeStyle,
    callout: typeStyle,
    subhead: typeStyle,
    footnote: typeStyle,
    caption: typeStyle,
    amountXL: typeStyle,
    amountL: typeStyle,
    amountM: typeStyle,
    note: typeStyle,
  }),
  space: z.strictObject({
    xxs: z.number(),
    xs: z.number(),
    sm: z.number(),
    md: z.number(),
    lg: z.number(),
    xl: z.number(),
    xxl: z.number(),
    screen: z.number().nonnegative(),
    card: z.number().positive(),
    rowInset: z.number().nonnegative(),
  }),
  radius: size.extend({ pill: z.number() }),
  stroke: z.strictObject({ hairline: z.number().positive(), outline: z.number().positive() }),
  shadow: z.strictObject({ light: elevations, dark: elevations }),
  motion: z.strictObject({
    duration: z.strictObject({ fast: z.number(), base: z.number(), slow: z.number() }),
    easing: z.strictObject({ standard: z.string(), soft: z.string() }),
    spring: z.strictObject({ damping: z.number(), stiffness: z.number(), mass: z.number() }),
  }),
  icon: z.strictObject({ size, weight: z.enum(["regular", "medium", "semibold", "bold"]) }),
  skin: z.strictObject({
    card: z.enum(["flat", "outlined", "offset", "soft"]),
    button: z.enum(["pill", "rounded", "chunky"]),
    row: z.enum(["plain", "inset", "carded"]),
    chip: z.enum(["filled", "outlined"]),
    pill: z.enum(["raised", "plain"]),
    breakdown: z.enum(["ranked", "bars"]),
    tabBar: z.enum(["standard", "floating", "pill"]),
    header: z.enum(["plain", "blurred"]),
    emptyArt: z.enum(["mascot", "icon", "none"]),
    celebration: z.enum(["sparkle", "none"]),
    noteAccent: z.enum(["handwritten", "none"]),
    progress: z.enum(["bar", "jar"]),
    actionCard: z.enum(["highlight", "accentBar"]),
    summary: z.enum(["tiles", "card"]),
    categoryTile: z.enum(["tinted", "neutral"]),
    greeting: z.enum(["bubble", "card"]),
    brandArt: z.enum(["mascot", "mark"]),
    refresh: z.enum(["mascot", "brandPuff"]),
    emptyState: z.enum(["open", "panel"]),
    cardAction: z.enum(["link", "footer"]),
  }),
  mascot: z.strictObject({ name: z.string().min(1), happy: svg, sleepy: svg }).optional(),
});

// Compile-time: what the validator accepts is a Theme, and every Theme field is validated.
type Validated = z.infer<typeof themeSchema>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type StripFaces<T> = Omit<T, "font">;
export const schemaMatchesType: Same<StripFaces<Validated>, StripFaces<Theme>> = true;
