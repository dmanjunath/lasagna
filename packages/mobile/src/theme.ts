import type { TextStyle } from "react-native";
import { useTheme as useDesign } from "@/design/ThemeProvider";
import { resolve, type Palette } from "@/design/resolve";
import { activeTheme, subscribeDesign } from "@/design/store";

// The adapter the screens were written against. Every value now comes from the
// active design system (packages/design, see src/design), so a screen built on
// these names follows a switch without knowing which theme is on. New code
// reads useTheme() from @/design for skins and roles. Screens never branch on
// a theme's id.
//
// The objects below keep their identity and are refilled on a switch. Module
// level style sheets that spread them must be built with themedStyles(), which
// rebuilds after a switch, not StyleSheet.create, which copies once at import.

export type { Palette };
export { themedStyles } from "@/design/themed";

/** The active theme's colors in the system scheme, under the names the screens use. */
export function useTheme(): Palette {
  return useDesign().palette;
}

/** Both schemes of the active theme. A dark surface in light mode (the toast) takes `palettes.dark`. */
export const palettes = {
  get light(): Palette {
    return resolve(activeTheme(), "light").palette;
  },
  get dark(): Palette {
    return resolve(activeTheme(), "dark").palette;
  },
};

type LegacyType = Record<
  | "display"
  | "amount"
  | "largeTitle"
  | "title"
  | "headline"
  | "body"
  | "callout"
  | "subhead"
  | "footnote"
  | "caption"
  | "title1"
  | "title2"
  | "amountXL"
  | "amountL"
  | "amountM"
  | "note",
  TextStyle
>;

/**
 * The only text styles in the app. Spread one into every Text and TextInput
 * style. Emphasis swaps the face with `weight`, figures switch to the numeric
 * face with `figures`. No literal fontSize or fontWeight anywhere else.
 */
export const type = {} as LegacyType;
/** Emphasis inside a type style: swaps the face, keeps the size. */
export const weight = {} as { regular: TextStyle; medium: TextStyle; semibold: TextStyle; bold: TextStyle };
/** Figures in a text style: the numeric face with tabular digits. */
export const figures = {} as TextStyle;
/** A single-line input's text: body without its lineHeight, which UIKit would misplace the text by. */
export const inputType = {} as TextStyle;
/**
 * The active theme's spacing and density. `screen` is the gutter from the
 * screen edge to a card, `card` a card's padding, `rowInset` a list row's
 * inset inside a full-width card. Screens read these, never literals.
 */
export const space = {} as {
  xxs: number;
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  screen: number;
  card: number;
  rowInset: number;
};
export const radius = {} as { xs: number; sm: number; md: number; lg: number; xl: number; pill: number };
/** SF Symbol sizes. Every SymbolView takes one of these. */
export const icon = {} as { xs: number; sm: number; md: number; lg: number; xl: number };
/** Face names. Each weight is its own face, so a style names the face and never sets fontWeight. */
export const font = {} as {
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

/** Empties `target` and fills it from `src`, keeping nested objects' identity. */
function refill(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Object.isFrozen(cur)) {
      refill(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...v } : v;
    }
  }
}

function sync() {
  const r = resolve(activeTheme(), "light");
  const t = r.type;
  refill(type, {
    // The names the screens use, on the scale's roles.
    display: t.amountXL,
    amount: t.amountL,
    title: t.title2,
    ...t,
  });
  refill(weight, r.weight);
  refill(figures as Record<string, unknown>, r.figures as Record<string, unknown>);
  refill(inputType as Record<string, unknown>, r.inputType as Record<string, unknown>);
  refill(radius, r.radius);
  refill(space, r.space);
  refill(icon, r.icon.size);
  refill(font, r.font);
}

sync();
subscribeDesign(sync);
