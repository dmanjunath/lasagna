import type { TintRole } from "@lasagna/design";
import { SymbolView } from "expo-symbols";
import { memo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import type { TxnFilters } from "@/lib/txn-filters";
import { space, themedStyles } from "@/theme";
import { Chip } from "@/ui/Chip";

const KINDS: Array<{ value: TxnFilters["kind"]; label: string; tint?: TintRole }> = [
  { value: "all", label: "All" },
  { value: "in", label: "Money in", tint: "income" },
  { value: "out", label: "Money out", tint: "spend" },
  { value: "transfer", label: "Transfers" },
];

/**
 * A page's scope as compact pills, in the Actions page's area chip style,
 * with the row's trailing control (the Filters pill) at the end. A choice
 * that means money in or out wears that role's color when it is chosen.
 * `onCard` for a row inside a card (a chart's range): the pills take the
 * surface so they stand off the card's fill. Large text wraps the pills onto
 * more lines, with the trailing control at the top, so no pill is ever clipped
 * under it. `scroll` rows (a long set) always scroll edge to edge instead.
 */
export function ScopePills<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  trailing,
  onCard,
  scroll,
}: {
  value: T;
  options: Array<{ value: T; label: string; tint?: TintRole }>;
  onChange: (v: T) => void;
  accessibilityLabel: string;
  trailing?: ReactNode;
  onCard?: boolean;
  /** A long set (the Actions page's areas): always one line that scrolls sideways, edge to edge. */
  scroll?: boolean;
}) {
  const large = useWindowDimensions().fontScale > 1.3;
  const pills = options.map((o) => <Chip key={o.value} label={o.label} selected={o.value === value} tint={o.tint} onCard={onCard} onPress={() => onChange(o.value)} />);
  return (
    <View style={[styles.row, large && !scroll && styles.rowTop]}>
      {scroll ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.edge}
          contentContainerStyle={[styles.line, styles.edgeLine]}
          accessibilityRole="radiogroup"
          accessibilityLabel={accessibilityLabel}
        >
          {pills}
        </ScrollView>
      ) : (
        <View style={styles.pills} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
          {pills}
        </View>
      )}
      {trailing}
    </View>
  );
}

/** Transactions' scope, at the top of the page (the page chrome contract): money in, out or transfers, then the Filters pill. */
function ScopeRowBase({
  kind,
  onKind,
  trailing,
}: {
  kind: TxnFilters["kind"];
  onKind: (k: TxnFilters["kind"]) => void;
  trailing?: ReactNode;
}) {
  return <ScopePills accessibilityLabel="Money in, out or transfers" value={kind} onChange={onKind} options={KINDS} trailing={trailing} />;
}

export const ScopeRow = memo(ScopeRowBase);

/** The scope row's trailing Filters pill, a round chip, filled in the brand while filters apply. Spending's scope row shares it. */
/** How much a round control beside the pills grows with Dynamic Type, so it keeps pace with the pills' text (capped). */
export function useControlScale(): number {
  return Math.min(Math.max(useWindowDimensions().fontScale, 1), 2);
}

export function FiltersButton({ on, onPress }: { on: boolean; onPress: () => void }) {
  const d = useDesign();
  const c = d.color;
  const filled = d.skin.chip === "filled";
  const k = useControlScale();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={on ? "Filters, on" : "Filters"}
      // 32pt to look at, 44pt to touch, like the chips beside it.
      hitSlop={6}
      style={({ pressed }) => [
        styles.filters,
        { width: 32 * k, height: 32 * k },
        { backgroundColor: on ? c.brandInk : filled ? c.surfaceInset : c.surface, borderRadius: d.radius.pill, opacity: pressed ? 0.6 : 1 },
        !filled && !on && { borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
      ]}
    >
      <SymbolView
        name="line.3.horizontal.decrease"
        size={d.icon.size.sm * k}
        weight="bold"
        tintColor={on ? c.onBrand : c.content}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    rowTop: { alignItems: "flex-start" },
    pills: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 },
    line: { flexDirection: "row", gap: 8 },
    // Runs to the screen's edges, past the page's gutter.
    edge: { flex: 1, marginHorizontal: -space.screen, flexGrow: 1 },
    edgeLine: { paddingHorizontal: space.screen },
    filters: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  }),
);
