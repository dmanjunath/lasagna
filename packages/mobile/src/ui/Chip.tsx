import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ColorRoles, TintRole } from "@lasagna/design";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "@/design";
import { hasRoleColor } from "@/design/tint";
import { type, weight } from "@/theme";
import { useHeroRole } from "./Card";
import { pressScale } from "./press";

/**
 * A compact pill: a filter, a choice in a row of choices. `selected` marks the
 * chosen one in a set, `tone="brand"` a chip that is on (an active filter).
 * `icon` trails the label (an xmark on a removable chip).
 *
 * Skins: `filled` (a quiet fill a step deeper than a soft card, surfaceInset),
 * `outlined` (a panel with a hairline edge).
 * The selected one takes the theme's `selected` colors, or `tint`'s role
 * colors when the choice means money in or out and the theme has them.
 *
 * The `pill` skin `raised` (owner decision 2026-11-23) makes a choice
 * unmistakable: the selected one fills with the brand ink (or the role's ink)
 * over a soft edge shadow, the gentle cousin of the chunky button, and the
 * rest sit flat on the card fill with a hairline.
 */
export function Chip({
  label,
  onPress,
  selected,
  tone,
  icon,
  accessibilityLabel,
  onCard,
  wrap,
  uncapped,
  tint,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  tone?: "brand";
  icon?: SFSymbol;
  accessibilityLabel?: string;
  /** Sits on a card: a filled chip takes whichever of surfaceInset and surface stands off the card's fill. */
  onCard?: boolean;
  /** A long label (a question to ask) wraps to a second line instead of being cut. */
  wrap?: boolean;
  /** No width cap: the label always shows whole on one line (a pill in a row that scrolls sideways). */
  uncapped?: boolean;
  /** The role a selected chip wears (Money in: income). */
  tint?: TintRole;
}) {
  const d = useTheme();
  const c = d.color;
  const filled = d.skin.chip === "filled";
  const heroRole = useHeroRole();
  const raised = d.skin.pill === "raised" && selected !== undefined;
  // On a hero, a selected pill wears the hero's own ink (a range pill on the denim net worth card), not the brand green.
  const on: { fill: string; ink: string; edge?: string } = raised ? raisedColors(c, tint ?? heroRole ?? undefined) : selectedColors(c, tint);
  const rest = raised ? c.surfaceMuted : filled ? (onCard ? chipOnCard(d) : c.surfaceInset) : c.surface;
  const bg = selected ? on.fill : tone === "brand" ? c.brandSoft : rest;
  const fg = selected ? on.ink : tone === "brand" ? c.brandInk : c.content;
  const bordered = (raised || !filled) && !selected && tone !== "brand";
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      // 32pt to look at, 44pt to touch.
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: bg, borderRadius: d.radius.pill },
        raised ? pressScale(pressed) : { opacity: pressed ? 0.6 : 1 },
        raised && pressed && !selected && { backgroundColor: c.surfaceInset },
        bordered && { borderWidth: raised ? 1 : StyleSheet.hairlineWidth, borderColor: raised ? c.hairline : c.line },
        // A border in its own fill, so a selected pill is exactly as tall as the bordered ones beside it.
        raised && selected && { boxShadow: `0 2px 0 ${on.edge}`, borderWidth: 1, borderColor: on.fill },
        !icon && { paddingRight: 12 },
        wrap && styles.wrap,
        uncapped && styles.uncapped,
      ]}
    >
      <Text style={[type.subhead, weight.semibold, styles.label, { color: fg }]} numberOfLines={wrap ? 2 : 1}>
        {label}
      </Text>
      {icon ? <SymbolView name={icon} size={d.icon.size.xs} weight="bold" tintColor={tone === "brand" || selected ? fg : c.contentMuted} accessibilityElementsHidden importantForAccessibility="no" /> : null}
    </Pressable>
  );
}

/**
 * A selected chip's colors: the role's tint where the theme gives that role a
 * color of its own, else the theme's `selected` pair (see hasRoleColor).
 */
export function selectedColors(c: ColorRoles, tint?: TintRole): { fill: string; ink: string } {
  return tint && hasRoleColor(c, tint) ? { fill: c.tint[tint].fill, ink: c.tint[tint].ink } : { fill: c.selected, ink: c.onSelected };
}

/**
 * A selected raised pill: the role's ink (Money in, Money out) or the brand
 * ink as the fill, the page color as the text (white in light, near black on
 * the bright dark inks), and a deeper shade of the fill as its edge shadow.
 */
export function raisedColors(c: ColorRoles, tint?: TintRole): { fill: string; ink: string; edge: string } {
  if (tint && hasRoleColor(c, tint)) return { fill: c.tint[tint].ink, ink: c.onBrand, edge: shade(c.tint[tint].ink) };
  return { fill: c.brandInk, ink: c.onBrand, edge: c.brandEdge };
}

/** A fill a step darker, for an edge shadow under it. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.round(v * 0.78).toString(16).padStart(2, "0");
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, maxWidth: 260, paddingLeft: 12, paddingRight: 10 },
  label: { flexShrink: 1 },
  wrap: { maxWidth: "100%", paddingVertical: 6 },
  uncapped: { maxWidth: undefined },
});

/** A filled chip on a card: the inset fill, unless the card itself is that fill (then the plain surface). */
export function chipOnCard(d: { color: { surface: string; surfaceInset: string; surfaceMuted: string }; skin: { card: string } }): string {
  const card = d.skin.card === "soft" ? d.color.surfaceMuted : d.color.surface;
  return card === d.color.surfaceInset ? d.color.surface : d.color.surfaceInset;
}
