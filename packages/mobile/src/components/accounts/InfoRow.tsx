import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { figures, icon, space, themedStyles, type, useTheme } from "@/theme";
import { pressFeedback } from "@/ui/press";

/**
 * A fact in a card: its label, its value at the trailing edge, and a chevron
 * when the row opens something. `money` sets the value in figures.
 */
export function InfoRow({
  label,
  value,
  onPress,
  money,
  muted,
  color,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  money?: boolean;
  /** A value that is a placeholder ("Not set"). */
  muted?: boolean;
  color?: string;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const body = (
    <>
      <Text style={[styles.label, { color: t.contentSecondary }]}>{label}</Text>
      <Text style={[styles.value, money && { ...figures }, { color: color ?? (muted ? t.contentMuted : t.content) }]} numberOfLines={2}>
        {value}
      </Text>
      {onPress ? <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" /> : null}
    </>
  );
  if (!onPress)
    return (
      <View style={styles.row} accessible accessibilityLabel={accessibilityLabel ?? `${label}, ${value}`}>
        {body}
      </View>
    );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}, ${value}`}
      style={({ pressed }) => [styles.row, pressFeedback(t, pressed)]}
    >
      {body}
    </Pressable>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: space.rowInset, paddingVertical: 10 },
    label: { ...type.callout, flexShrink: 0, maxWidth: "50%" },
    value: { ...type.callout, flex: 1, textAlign: "right" },
  }),
);
