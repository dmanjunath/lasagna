import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import type { ColorRoles } from "@lasagna/design";
import { verdictFill } from "@/design/meaning";
import { goalStatus, goalSymbol, progressOf, type Goal, type StatTile } from "@/lib/goals";
import { goalAccent } from "@/lib/home";
import { figures, icon as iconSize, themedStyles, type, useTheme, weight, type Palette } from "@/theme";
import { Card } from "@/ui/Card";

/** A goal's accent (goal-shared.tsx goalAccent): brand for a safety net or a reached goal, else a chart color. */
export function goalColor(t: Palette, category: string, name = "", reached = false): string {
  const a = goalAccent(category, name);
  return reached || a === "brand" ? t.brand : t.viz[a];
}

/**
 * The color of a goal's progress (its bar, its jar's fill): the status when
 * the goal has one (on track basil, slipping yellow, off track sauce), so the
 * one in trouble stands out: meaningful color over the category colors
 * (owner, 2026-11-23). With nothing to judge, its own accent.
 */
export function goalProgressColor(t: Palette, c: ColorRoles, g: Goal, now?: Date): string {
  const status = goalStatus(g, now);
  return status ? verdictFill(c, status) : goalColor(t, g.category, g.name, progressOf(g).reached);
}

/**
 * A goal's icon tile. `solid` (a goal's own tile, as on the web's cards): the
 * accent fill with the glyph on it. `soft` (a kind to pick): the theme's own
 * soft pair for the accent (brand's soft, or the category pair at the chart
 * color's index), never a computed wash, which reads gray on a cream or dark
 * card. Decorative.
 */
export function GoalTile({ iconKey, color, size = 40, variant = "solid" }: { iconKey: string | null; color: string; size?: number; variant?: "solid" | "soft" }) {
  const t = useTheme();
  const d = useDesign();
  const solid = variant === "solid";
  const cats = d.color.category;
  const pair = color === t.brand ? { fill: t.brandSoft, ink: t.brandInk } : (cats[t.viz.indexOf(color)] ?? cats[0]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { width: size, height: size, borderRadius: size >= 44 ? d.radius.md : d.radius.sm, backgroundColor: solid ? color : pair.fill }]}
    >
      <SymbolView name={goalSymbol(iconKey)} size={size >= 44 ? iconSize.lg : iconSize.md} weight="semibold" tintColor={solid ? t.brandFg : pair.ink} />
    </View>
  );
}

/** The hero's figures as small cards in a row (wrapping at large text). */
export function StatTiles({ tiles, onAction }: { tiles: StatTile[]; onAction?: (tile: StatTile) => void }) {
  const t = useTheme();
  // Large text: one tile per line, so no figure or label is cut.
  const full = useWindowDimensions().fontScale > 1.3;
  return (
    <View style={styles.tiles}>
      {tiles.map((tile) => {
        const body = (
          <>
            <Text style={[styles.tileLabel, { color: t.contentMuted }]} numberOfLines={1}>
              {tile.label}
            </Text>
            <Text style={[styles.tileValue, { color: tile.accent || tile.action ? t.brandInk : t.content }]} numberOfLines={1} adjustsFontSizeToFit>
              {tile.value}
            </Text>
            {tile.caption ? (
              <Text style={[styles.tileCaption, { color: t.contentMuted }]} numberOfLines={2}>
                {tile.caption}
              </Text>
            ) : null}
          </>
        );
        return (
          <View key={tile.key} style={[styles.tileSlot, full && { flexBasis: "100%" }]}>
            {tile.action && onAction ? (
              <Pressable onPress={() => onAction(tile)} accessibilityRole="button" accessibilityLabel={`${tile.label}, ${tile.value}`} style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.6 : 1 }]}>
                <Card nested style={[styles.tileCard, { borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed", borderColor: t.lineStrong }]}>
                  {body}
                </Card>
              </Pressable>
            ) : (
              <Card nested style={styles.tileCard}>
                <View accessible accessibilityLabel={`${tile.label}, ${tile.value}${tile.caption ? `, ${tile.caption}` : ""}`}>{body}</View>
              </Card>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    tile: { alignItems: "center", justifyContent: "center" },
    tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tileSlot: { flexGrow: 1, flexBasis: 96 },
    tileCard: { padding: 12, gap: 3, flex: 1 },
    tileLabel: { ...type.caption, ...weight.semibold },
    tileValue: { ...type.amountM, ...figures },
    tileCaption: { ...type.caption, ...weight.medium },
  }),
);
