import * as Haptics from "expo-haptics";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatMoney } from "@/lib/format";
import { chartScale, columnLabel, columnTitle, isCurrentKey, shortMoney, type TrendPeriod } from "@/lib/spending";
import { useTheme as useDesign } from "@/design";
import { figures, themedStyles, type, useTheme, weight } from "@/theme";

const PLOT_H = 150;
const LABEL_H = 22;
const AXIS_W = 48;
/** Columns in view at once. More scroll sideways, newest at the right. */
const VISIBLE = 6;

/**
 * Income up, spending down, one column per period on a shared zero, as the
 * web's CashflowBars draws them. A tap selects that period for the whole page.
 * The running period is drawn faded and starred, and the legend names both.
 * With amounts hidden the money axis goes and only the shapes stay.
 * `spendingOnly` (a category filter is on, so income means nothing): spending
 * bars standing up from zero, and the legend names only them.
 * `selected` may be empty (a year shown as its months): nothing is marked.
 */
function CashflowChartBase({
  periods,
  selected,
  onSelect,
  hidden,
  spendingOnly = false,
}: {
  periods: TrendPeriod[];
  selected: string;
  onSelect: (key: string) => void;
  hidden: boolean;
  spendingOnly?: boolean;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const { top, bottom, ticks } = useMemo(
    () => chartScale(spendingOnly ? periods.map((p) => ({ ...p, income: p.expenses, expenses: 0 })) : periods),
    [periods, spendingOnly],
  );
  const axisW = hidden ? 0 : AXIS_W;
  const plotW = Math.max(0, width - axisW);
  const colW = plotW / Math.max(1, Math.min(VISIBLE, periods.length));
  const yAt = (v: number) => ((top - v) / (top - bottom)) * PLOT_H;
  const zeroY = yAt(0);
  const barW = Math.min(colW * 0.56, 40);
  const tint = useDesign().color.tint;
  const incomeColor = tint.income.accent;
  const spendColor = tint.spend.accent;
  const partialKey = periods.find((p) => isCurrentKey(p.period))?.period;
  const unit = periods[0]?.period.length === 4 ? "year" : "month";

  // Keep the selected column in view (else the newest): follow the stepper.
  const visible = Math.min(VISIBLE, periods.length);
  const selIdx = periods.findIndex((p) => p.period === selected);
  const [start, setStart] = useState(0);
  useEffect(() => {
    if (!width) return;
    const target = selIdx < 0 ? periods.length - 1 : selIdx;
    const first = Math.max(0, Math.min(periods.length - visible, target - visible + 1));
    setStart(first);
    scroll.current?.scrollTo({ x: first * colW, animated: false });
    // Only the selection and the width move the window, never a scroll of the user's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selIdx, colW, periods.length]);
  // The star's note only while the running column is on screen.
  const partialIdx = partialKey ? periods.findIndex((p) => p.period === partialKey) : -1;
  const partialShown = partialIdx >= start && partialIdx < start + visible;

  return (
    <View>
      <View style={{ flexDirection: "row" }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {hidden ? null : (
          <View style={{ width: axisW, height: PLOT_H + LABEL_H }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {ticks.map((v) => (
              <Text key={v} style={[styles.tick, { top: yAt(v) - 8, color: t.contentFaint }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {shortMoney(v)}
              </Text>
            ))}
          </View>
        )}
        <View style={{ flex: 1 }}>
          {/* Gridlines, behind the scrolling columns. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {ticks.map((v) => (
              <View key={v} style={[styles.grid, { top: yAt(v), backgroundColor: v === 0 ? t.lineStrong : t.hairline }]} />
            ))}
          </View>
          <ScrollView
            ref={scroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={periods.length > VISIBLE}
            scrollEventThrottle={64}
            onScroll={(e) => {
              const first = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, colW));
              setStart((v) => (v === first ? v : first));
            }}
          >
            {periods.map((p, i) => {
              const on = p.period === selected;
              const partial = p.period === partialKey;
              const up = spendingOnly ? p.expenses : p.income;
              const upH = Math.max(up > 0 ? 2 : 0, zeroY - yAt(up));
              const downH = spendingOnly ? 0 : Math.max(p.expenses > 0 ? 2 : 0, yAt(-p.expenses) - zeroY);
              const label = columnLabel(p.period, i === 0 || p.period.endsWith("-01"));
              return (
                <Pressable
                  key={p.period}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onSelect(p.period);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${columnTitle(p.period)}${partial ? " so far" : ""}, ${spendingOnly ? "" : `income ${formatMoney(p.income, true)}, `}spending ${formatMoney(p.expenses, true)}`}
                  style={({ pressed }) => [
                    styles.col,
                    { width: colW, borderRadius: 8 },
                    on && { backgroundColor: t.faintFill },
                    pressed && !on && { backgroundColor: t.hairline },
                  ]}
                >
                  <View style={{ height: PLOT_H, width: barW, opacity: partial ? 0.5 : 1 }}>
                    <View style={[styles.bar, { top: zeroY - upH, height: upH, backgroundColor: spendingOnly ? spendColor : incomeColor, borderTopLeftRadius: 4, borderTopRightRadius: 4 }]} />
                    <View style={[styles.bar, { top: zeroY, height: downH, backgroundColor: spendColor, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }]} />
                  </View>
                  <Text style={[styles.label, { color: on ? t.content : t.contentMuted }, on && weight.semibold]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                    {partial ? `${label}*` : label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
      <View style={[styles.legend, { paddingLeft: axisW }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {spendingOnly ? null : <LegendItem color={incomeColor} label="Income" />}
        <LegendItem color={spendColor} label="Spending" />
        {partialShown ? <Text style={[styles.legendText, { color: t.contentMuted }]} maxFontSizeMultiplier={1.5}>{`* This ${unit} so far`}</Text> : null}
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  const t = useTheme();
  return (
    <View style={styles.item}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: t.contentSecondary }]} maxFontSizeMultiplier={1.5}>{label}</Text>
    </View>
  );
}

export const CashflowChart = memo(CashflowChartBase);

const styles = themedStyles(() =>
  StyleSheet.create({
    tick: { ...type.caption, ...figures, position: "absolute", left: 0, right: 6, textAlign: "right" },
    grid: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
    col: { alignItems: "center", height: PLOT_H + LABEL_H },
    bar: { position: "absolute", left: 0, right: 0 },
    label: { ...type.caption, height: LABEL_H, lineHeight: LABEL_H },
    legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 14, rowGap: 4, marginTop: 8 },
    item: { flexDirection: "row", alignItems: "center", gap: 6 },
    swatch: { width: 10, height: 10, borderRadius: 3 },
    legendText: { ...type.caption },
  }),
);
