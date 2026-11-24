import type { TintRole } from "@lasagna/design";
import { SymbolView } from "expo-symbols";
import { createContext, memo, useContext, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTheme as useDesign } from "@/design";
import type { TxnFilters } from "@/lib/txn-filters";
import { space, themedStyles, useTheme } from "@/theme";
import { useHeroRole } from "@/ui/Card";
import { Chip, raisedColors } from "@/ui/Chip";
import { pressScale } from "@/ui/press";

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
 * surface so they stand off the card's fill. At large text the pills stay on
 * one line that scrolls sideways, each label whole, with a soft fade where the
 * row runs on: a row never breaks into one pill per line. `scroll` rows (a long
 * set) scroll edge to edge at every size.
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
  /** A long set (the Actions page's areas): one line that scrolls sideways, edge to edge. At large text it wraps like every other pill row, so no pill is cut off at the edge. */
  scroll?: boolean;
}) {
  const large = useWindowDimensions().fontScale > 1.3;
  const scrolls = scroll || large;
  const t = useTheme();
  const d = useDesign();
  const hero = useHeroRole();
  // The color behind the row, for its edge fade: the page, or the card it sits in (a hero's own tint).
  const behind = !onCard ? t.canvas : hero ? d.color.tint[hero].fill : d.skin.card === "soft" ? d.color.surfaceMuted : d.color.surface;
  // The trailing control lines up with the first line of pills, at the pills' own height, whatever the text
  // size: the first pill reports its height, and the trailing control is centered in a box that tall.
  const [pillHeight, setPillHeight] = useState<number | null>(null);
  // At large text a chip may take the whole row (and a second line) rather than its usual cap, so a long label is never cut.
  const pills = options.map((o, i) => {
    const chip = <Chip key={o.value} label={o.label} selected={o.value === value} tint={o.tint} onCard={onCard} uncapped={large} onPress={() => onChange(o.value)} />;
    return i === 0 ? (
      <View key={o.value} onLayout={(e) => setPillHeight(Math.round(e.nativeEvent.layout.height * 10) / 10)}>
        {chip}
      </View>
    ) : (
      chip
    );
  });
  return (
    <View style={styles.row}>
      {scrolls ? (
        <View style={trailing ? styles.scrollBox : styles.edge}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.line, trailing ? styles.tailLine : styles.edgeLine]}
            accessibilityRole="radiogroup"
            accessibilityLabel={accessibilityLabel}
          >
            {pills}
          </ScrollView>
          {/* Where the row runs on past the edge, it fades into what is behind it, so it reads as more to scroll, not as cut. */}
          <EdgeFade color={behind} />
        </View>
      ) : (
        <View style={styles.pills} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
          {pills}
        </View>
      )}
      {trailing ? (
        <PillHeightContext.Provider value={pillHeight}>
          <View style={[styles.trailing, pillHeight ? { height: pillHeight } : null]}>{trailing}</View>
        </PillHeightContext.Provider>
      ) : null}
    </View>
  );
}

/** A soft fade at a scrolling pill row's end, from transparent into the color behind the row. */
function EdgeFade({ color }: { color: string }) {
  return (
    <View pointerEvents="none" style={styles.fade}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="pill-fade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#pill-fade)" />
      </Svg>
    </View>
  );
}

/** The height of the pills beside a trailing control, so a round control matches them exactly. */
const PillHeightContext = createContext<number | null>(null);

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
  // The raised pill skin: the same family as the pills beside it (rest on the card fill with a hairline, on in the brand with an edge shadow, press shrinks).
  const raised = d.skin.pill === "raised";
  const onColors = raisedColors(c);
  const k = useControlScale();
  // Beside pills, exactly their height (a circle as tall as the pill next to it); alone, it grows with the text.
  const pill = useContext(PillHeightContext);
  const size = pill ?? 32 * k;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={on ? "Filters, on" : "Filters"}
      // 32pt to look at, 44pt to touch, like the chips beside it.
      hitSlop={6}
      style={({ pressed }) =>
        raised
          ? [
              styles.filters,
              { width: size, height: size, borderRadius: d.radius.pill },
              on
                ? { backgroundColor: onColors.fill, boxShadow: `0 2px 0 ${onColors.edge}` }
                : { backgroundColor: pressed ? c.surfaceInset : c.surfaceMuted, borderWidth: 1, borderColor: c.hairline },
              pressScale(pressed),
            ]
          : [
              styles.filters,
              { width: size, height: size },
              { backgroundColor: on ? c.brandInk : filled ? c.surfaceInset : c.surface, borderRadius: d.radius.pill, opacity: pressed ? 0.6 : 1 },
              !filled && !on && { borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
            ]
      }
    >
      <SymbolView
        name="line.3.horizontal.decrease"
        size={d.icon.size.sm * Math.max(1, size / 32)}
        weight="bold"
        tintColor={on ? (raised ? onColors.ink : c.onBrand) : c.content}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // Top-aligned: when the pills wrap, the trailing control stays beside the first line, not centered on the block.
    row: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    trailing: { flexDirection: "row", alignItems: "center", gap: 8 },
    pills: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 },
    line: { flexDirection: "row", gap: 8 },
    // Runs to the screen's edges, past the page's gutter.
    edge: { flex: 1, marginHorizontal: -space.screen, flexGrow: 1 },
    edgeLine: { paddingHorizontal: space.screen },
    // Beside a trailing control: runs from the page's left edge up to the control.
    scrollBox: { flex: 1, marginLeft: -space.screen },
    tailLine: { paddingLeft: space.screen, paddingRight: 16 },
    fade: { position: "absolute", top: 0, bottom: 0, right: 0, width: 20 },
    filters: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  }),
);
