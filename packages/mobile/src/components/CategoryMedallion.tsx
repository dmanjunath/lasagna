import type { TintRole } from "@lasagna/design";
import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import type { CategoryDisplay } from "@/lib/taxonomy";
import { icon, themedStyles } from "@/theme";

/** A stable tile color for a category: its name picks one of the theme's eight category tones. */
export function categoryToneIndex(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return h % 8;
}

/**
 * The category's tile. Skins: `tinted` (a rounded square in the category's
 * tone), `neutral` (a round, quiet fill for every category). Income takes the
 * positive tone in both. `role`: a tile that stands for a kind of money (an
 * account's type) is neutral in both skins, not a tone hashed from its name:
 * only a category's own tile carries color (owner decision 2026-11-23).
 */
export function CategoryMedallion({ display, income, role }: { display: CategoryDisplay; income?: boolean; role?: TintRole }) {
  const d = useDesign();
  const neutral = d.skin.categoryTile === "neutral";
  const tone = income
    ? { fill: d.color.positiveSoft, ink: d.color.positive }
    : neutral || role
      ? // The faint content wash, not the sunken well: a well reads as a black hole on a dark card.
        { fill: d.palette.faintFill, ink: d.color.contentSecondary }
      : d.color.category[categoryToneIndex(display.label)];
  return (
    <View style={[styles.m, { backgroundColor: tone.fill, borderRadius: neutral ? d.radius.pill : d.radius.sm }]}>
      {display.emoji ? (
        <Text style={styles.emoji}>{display.emoji}</Text>
      ) : (
        <SymbolView name={display.symbol} size={icon.md} weight="semibold" tintColor={tone.ink} />
      )}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  m: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  // An emoji glyph, sized to match the symbol beside it: not text, so outside the type scale.
  emoji: { fontSize: icon.md },
}));
