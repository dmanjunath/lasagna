import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { useTheme } from "@/design";
import { themedStyles, type, weight } from "@/theme";

type Variant = "primary" | "secondary" | "tinted" | "plain" | "destructive";

/**
 * The app's only button. Primary is the one filled call to action, secondary
 * the quieter alternative, tinted a forward action on a card that is not its
 * main one (the web's brand-tint secondary), plain a text button. `compact` is the size for a
 * button inside a card or row (44pt, subhead text). Destructive is the one
 * irreversible commit at the foot of a sheet (Permanently delete). `icon` trails the label,
 * or leads it with `iconLeading` (a Face ID glyph).
 *
 * Skins: `rounded` (rounded rectangle, bordered secondary), `pill` (capsule,
 * filled secondary), `chunky` (a pill standing on a darker edge that it
 * presses down into).
 */
export function Button({
  title,
  onPress,
  variant = "primary",
  size = "regular",
  icon,
  iconLeading,
  loading,
  disabled,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: "regular" | "compact";
  icon?: SFSymbol;
  iconLeading?: boolean;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const d = useTheme();
  const c = d.color;
  const skin = d.skin.button;
  const inactive = disabled || loading;
  const compact = size === "compact";
  const capsule = skin !== "rounded";
  const filledSecondary = capsule && variant === "secondary";
  const bg =
    variant === "primary" ? c.brandInk : variant === "destructive" ? c.dangerSolid : variant === "secondary" ? (filledSecondary ? c.surfaceInset : c.surface) : variant === "tinted" ? c.brandSoft : "transparent";
  const fg = variant === "primary" ? c.onBrand : variant === "destructive" ? c.onDanger : filledSecondary ? c.content : c.brandInk;
  const edge = skin === "chunky" && variant === "primary" ? (compact ? 3 : 4) : 0;
  const glyph = icon ? (
    <SymbolView name={icon} size={iconLeading ? d.icon.size.md : d.icon.size.sm} weight="semibold" tintColor={fg} accessibilityElementsHidden importantForAccessibility="no" />
  ) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        if (variant === "primary") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => {
        const down = edge && pressed && !inactive ? edge / 2 : 0;
        return [
          styles.base,
          variant !== "plain" && {
            minHeight: compact ? 44 : 50,
            borderRadius: capsule ? d.radius.pill : compact ? d.radius.sm : d.radius.md,
            paddingHorizontal: compact ? (capsule ? 14 : 12) : capsule ? 22 : 16,
          },
          { backgroundColor: bg, opacity: inactive ? 0.5 : pressed && !edge ? 0.7 : 1 },
          variant === "secondary" && !filledSecondary && { borderWidth: StyleSheet.hairlineWidth, borderColor: c.lineStrong },
          // The edge sits under the button, and pressing moves the button down into it.
          edge ? { marginBottom: edge, boxShadow: `0 ${edge - down}px 0 ${c.brandEdge}`, transform: [{ translateY: down }] } : null,
          style,
        ];
      }}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && iconLeading ? glyph : null}
          <Text style={[compact ? [type.subhead, variant === "tinted" ? weight.bold : weight.semibold] : type.headline, styles.label, { color: fg }]}>{title}</Text>
          {icon && !iconLeading ? glyph : null}
        </>
      )}
    </Pressable>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  base: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16 },
  label: { textAlign: "center", flexShrink: 1 },
}));
