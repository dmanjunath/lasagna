import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { formatMoney } from "@/lib/format";
import { figures, icon, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { Track } from "@/ui/Track";

export type AllocationRow = {
  key: string;
  label: string;
  value: number;
  /** Share of the whole, in percent. */
  pct: number;
  /** The row's color, as an index into the theme's chart palette. */
  chart: number;
  /** A line under the label (Other's members). */
  detail?: string;
  /** Debt is owed: its figures take the negative ink, as on the web. */
  owed?: boolean;
};

/** "<0.1%", "38%", "41.9%". `whole`: no decimals (the debt legend). */
const pctText = (p: number, whole?: boolean) => (p <= 0 ? "0%" : p < 0.1 ? "<0.1%" : whole ? `${p.toFixed(0)}%` : `${p.toFixed(1)}%`);

/**
 * A whole split into its parts, the web's allocation pattern: one full-width
 * bar whose segments grow to their value (no text on them, the legend names
 * them), then the one legend, ranked, each row with its swatch, amount, share
 * and a bar sized against the largest. A row with `onPress` drills; the
 * selected key stays lit and the rest of the bar dims.
 */
function AllocationBase({
  rows,
  hidden,
  onPress,
  selected,
  wholePct,
  label,
}: {
  rows: AllocationRow[];
  /** Re-renders the amounts on a hide toggle. */
  hidden: boolean;
  onPress?: (key: string) => void;
  selected?: string | null;
  wholePct?: boolean;
  /** What the bar is of, for VoiceOver. */
  label: string;
}) {
  const t = useTheme();
  const d = useDesign();
  const stacked = useWindowDimensions().fontScale > 1.3;
  void hidden;
  const shown = rows.filter((r) => r.value > 0);
  if (shown.length === 0) return null;
  const max = shown.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const color = (r: AllocationRow) => t.viz[r.chart % t.viz.length];
  return (
    <View style={styles.wrap}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${label}: ${shown.map((r) => `${r.label} ${pctText(r.pct, wholePct)}`).join(", ")}`}
        style={[styles.bar, { borderRadius: d.radius.md }]}
      >
        {shown.map((r, i) => (
          <View
            key={r.key}
            style={{
              flexGrow: r.value,
              flexBasis: 0,
              minWidth: 5,
              backgroundColor: color(r),
              opacity: selected && selected !== r.key ? 0.38 : 1,
              borderTopLeftRadius: i === 0 ? d.radius.md : 3,
              borderBottomLeftRadius: i === 0 ? d.radius.md : 3,
              borderTopRightRadius: i === shown.length - 1 ? d.radius.md : 3,
              borderBottomRightRadius: i === shown.length - 1 ? d.radius.md : 3,
            }}
          />
        ))}
      </View>
      <View>
        {shown.map((r) => {
          const tappable = !!onPress;
          const amount = formatMoney(r.value, true);
          const pct = pctText(r.pct, wholePct);
          const on = selected === r.key;
          const figure = (
            <Text style={[styles.figure, { color: r.owed && !hidden ? t.negative : t.content }]} numberOfLines={1}>
              {amount}
              <Text style={[styles.pct, { color: t.contentMuted }]}>{`  ${pct}`}</Text>
            </Text>
          );
          return (
            <Pressable
              key={r.key}
              disabled={!tappable}
              onPress={() => {
                Haptics.selectionAsync();
                onPress?.(r.key);
              }}
              accessibilityRole={tappable ? "button" : "text"}
              accessibilityLabel={`${r.label}, ${amount}, ${pct}${r.owed ? ", owed" : ""}`}
              accessibilityHint={tappable ? "Shows what it is made of" : undefined}
              accessibilityState={tappable ? { selected: on } : undefined}
              style={({ pressed }) => [styles.row, (pressed || on) && { backgroundColor: on ? t.brandSofter : t.canvasSunken }]}
            >
              <View style={styles.main}>
                {/* Large text: the figure takes its own line, so the name has the row's width and never breaks mid-word. */}
                <View style={styles.head}>
                  <View style={[styles.swatch, { backgroundColor: color(r), borderRadius: 3 }]} />
                  <Text style={[styles.name, { color: t.content }]} numberOfLines={stacked ? 3 : 1}>
                    {r.label}
                  </Text>
                  {stacked ? null : figure}
                </View>
                {stacked ? figure : null}
                {r.detail ? <Text style={[styles.detail, { color: t.contentMuted }]}>{r.detail}</Text> : null}
                {shown.length > 1 ? <Track pct={(r.value / max) * 100} color={color(r)} height={6} /> : null}
              </View>
              {tappable ? (
                <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const Allocation = memo(AllocationBase);

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { gap: 10 },
    bar: { flexDirection: "row", gap: 3, height: 44, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, paddingVertical: 9, marginHorizontal: -8, borderRadius: radius.sm, minHeight: 52 },
    swatch: { width: 12, height: 12 },
    main: { flex: 1, gap: 6 },
    head: { flexDirection: "row", alignItems: "center", gap: 8 },
    name: { ...type.subhead, ...weight.semibold, flexShrink: 1, flexGrow: 1 },
    detail: { ...type.footnote },
    figure: { ...type.subhead, ...figures },
    pct: { ...type.footnote, ...weight.semibold },
  }),
);
