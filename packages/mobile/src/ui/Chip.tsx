import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ColorRoles, TintRole } from "@lasagna/design";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "@/design";
import { hasRoleColor } from "@/design/tint";
import { type, weight } from "@/theme";

/**
 * A compact pill: a filter, a choice in a row of choices. `selected` marks the
 * chosen one in a set, `tone="brand"` a chip that is on (an active filter).
 * `icon` trails the label (an xmark on a removable chip).
 *
 * Skins: `filled` (a quiet fill a step deeper than a soft card, surfaceInset),
 * `outlined` (a panel with a hairline edge).
 * The selected one takes the theme's `selected` colors, or `tint`'s role
 * colors when the choice means money in or out and the theme has them.
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
  tint,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  tone?: "brand";
  icon?: SFSymbol;
  accessibilityLabel?: string;
  /** Sits on a card: a filled chip takes the surface so it stands off a quiet card fill. */
  onCard?: boolean;
  /** A long label (a question to ask) wraps to a second line instead of being cut. */
  wrap?: boolean;
  /** The role a selected chip wears (Money in: income). */
  tint?: TintRole;
}) {
  const d = useTheme();
  const c = d.color;
  const filled = d.skin.chip === "filled";
  const on = selectedColors(c, tint);
  const bg = selected ? on.fill : tone === "brand" ? c.brandSoft : filled ? (onCard ? c.surface : c.surfaceInset) : c.surface;
  const fg = selected ? on.ink : tone === "brand" ? c.brandInk : c.content;
  const bordered = !filled && !selected && tone !== "brand";
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
        { backgroundColor: bg, borderRadius: d.radius.pill, opacity: pressed ? 0.6 : 1 },
        bordered && { borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
        !icon && { paddingRight: 12 },
        wrap && styles.wrap,
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

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, maxWidth: 260, paddingLeft: 12, paddingRight: 10 },
  label: { flexShrink: 1 },
  wrap: { maxWidth: "100%", paddingVertical: 6 },
});
