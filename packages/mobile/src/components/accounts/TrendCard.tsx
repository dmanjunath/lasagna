import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { formatMoney, formatStoredDay } from "@/lib/format";
import { HIDDEN_AMOUNT } from "@/lib/hide-amounts";
import { chartDay, drawableRange, filterByRange, signedPct, type Range, type TrendPoint } from "@/lib/trend";
import { useTheme as useDesign } from "@/design";
import { hasRoleColor } from "@/design/tint";
import { ScopePills } from "@/components/transactions/ScopeRow";
import { icon, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { Card, TextLink } from "@/ui/Card";
import { HeroAmount } from "@/ui/HeroAmount";
import { Skeleton } from "@/ui/Skeleton";
import { CHART_H, TrendChart } from "./TrendChart";

/**
 * A figure and its history (the web's NetWorthTrendCard, and the account
 * page's balance hero): a quiet label, the figure, one line saying how it
 * moved over the range on screen, the chart, and the range under it. Scrubbing
 * the chart re-dates the figure and the line. `owed`: a debt, shown unsigned
 * in the negative ink, where going down is the good direction.
 */
export function TrendCard({
  title,
  badge,
  value,
  history,
  historyLoading,
  historyError,
  onRetry,
  owed = false,
  hidden,
  since,
  fallback,
  empty,
  lead,
  children,
}: {
  title: string;
  badge?: ReactNode;
  value: number;
  history: TrendPoint[];
  historyLoading: boolean;
  historyError: boolean;
  onRetry: () => void;
  owed?: boolean;
  hidden: boolean;
  /** "since <date>" after the change (net worth), else "over this period". */
  since?: boolean;
  /** The line under the figure when there is no change to state ("Synced 3h ago"). */
  fallback?: string;
  /** What to say when there is too little history to draw. */
  empty: { title: string; body: string };
  /** Above the label: what the figure belongs to (an account's institution). */
  lead?: ReactNode;
  /** Under the range: a meta line, an action. */
  children?: ReactNode;
}) {
  const t = useTheme();
  const { fontScale } = useWindowDimensions();
  // What the figure is: a debt wears the spending tint, anything owned the net worth one.
  const c = useDesign().color;
  const role = owed ? "spend" : "wealth";
  const tint = c.tint[role];
  const line = hasRoleColor(c, role) ? tint.accent : c.tint.wealth.accent;
  const [range, setRange] = useState<Range>(() => drawableRange(history, "6M"));
  const picked = useRef(false);
  // History lands after the first paint: a range that cannot draw moves to one that can, until the reader picks one.
  useEffect(() => {
    if (picked.current) return;
    setRange((cur) => (filterByRange(history, cur).length >= 2 ? cur : drawableRange(history, cur)));
  }, [history]);
  const [scrub, setScrub] = useState<number | null>(null);

  const points = useMemo(() => filterByRange(history, range), [history, range]);
  const hasChart = points.length >= 2;
  const hasRanges = history.length >= 2;
  const hovered = hasChart && scrub !== null ? points[scrub] : null;
  const shown = hovered ? hovered.value : value;
  const start = hasChart ? points[0] : null;
  const delta = start ? shown - start.value : null;
  const pct = start && start.value !== 0 ? ((delta ?? 0) / Math.abs(start.value)) * 100 : null;
  const showDelta = delta !== null && (hovered !== null || delta !== 0 || !fallback);
  const up = (delta ?? 0) >= 0;
  const good = owed ? !up : up;
  const tone = good ? t.positive : t.negative;
  const figure = formatMoney(owed ? Math.abs(shown) : shown, true);

  // One line whatever the date or amount (owner, "Charts never wrap"): short days, and the period truncates last.
  // At large text sizes the change stays whole and the period goes ("since …"); a scrubbed day still shows, briefly.
  const large = fontScale > 1.3;
  const scrubDay = hovered && hovered.date !== start?.date ? chartDay(hovered.date) : "";
  const when = scrubDay ? (large ? scrubDay : `on ${scrubDay}, `) : "";
  const period = large ? "" : since && start ? `since ${chartDay(start.date)}` : "over this period";
  const deltaText = hidden ? (pct !== null ? `(${signedPct(pct)})` : "") : `${up ? "+" : "−"}${formatMoney(Math.abs(delta ?? 0), true)}${pct !== null ? ` (${signedPct(pct)})` : ""}`;

  return (
    <Card
      hero={role}
      style={{ gap: 4 }}
      wash={`radial-gradient(120% 90% at 100% 0%, ${t.infoSoft}, transparent 56%), radial-gradient(90% 70% at 0% 4%, ${owed ? t.brandSofter : t.accentSofter}, transparent 60%)`}
    >
      {lead}
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: tint.ink }]} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {badge}
      </View>
      {/* A tap on the hero hides or shows every amount. */}
      <HeroAmount label={`${title}, ${hidden ? "hidden" : figure}${hovered ? ` on ${formatStoredDay(hovered.date, { year: "numeric" })}` : ""}`}>
        <Text style={[styles.figure, { color: owed && !hidden ? t.negative : t.content }]} numberOfLines={1} adjustsFontSizeToFit>
          {hidden ? HIDDEN_AMOUNT : figure}
        </Text>
      </HeroAmount>
      {historyLoading && !hasChart ? (
        <Skeleton width={200} height={14} />
      ) : showDelta && delta !== null ? (
        <View style={styles.deltaRow} accessible accessibilityLabel={`${up ? "Up" : "Down"} ${deltaText}, ${when}${period}`}>
          <SymbolView name={up ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill"} size={icon.xs} tintColor={tone} accessibilityElementsHidden importantForAccessibility="no" />
          {deltaText ? <Text style={[styles.delta, { color: tone }]} numberOfLines={1}>{deltaText}</Text> : null}
          {when || period ? (
            <Text style={[styles.period, styles.periodShrink, { color: t.contentMuted }]} numberOfLines={1}>
              {when ? <Text style={[weight.semibold, { color: t.content }]}>{when}</Text> : null}
              {period}
            </Text>
          ) : null}
        </View>
      ) : fallback ? (
        <Text style={[styles.period, { color: t.contentMuted }]}>{fallback}</Text>
      ) : null}

      <View style={styles.chartSlot}>
        {hasChart ? (
          <TrendChart points={points} range={range} hidden={hidden} onScrub={setScrub} label={title} color={line} />
        ) : historyLoading ? (
          <Skeleton height={CHART_H} />
        ) : historyError ? (
          <View style={[styles.placeholder, { borderColor: t.lineStrong, backgroundColor: t.canvasSunken }]} accessibilityLiveRegion="polite">
            <Text style={[styles.phTitle, { color: t.content }]}>Couldn't load the trend</Text>
            <TextLink title="Try again" onPress={onRetry} />
          </View>
        ) : (
          <View style={[styles.placeholder, { borderColor: t.lineStrong, backgroundColor: t.canvasSunken }]}>
            <Text style={[styles.phTitle, { color: t.content }]}>{hasRanges ? "Nothing in this range" : empty.title}</Text>
            <Text style={[styles.phBody, { color: t.contentMuted }]}>{hasRanges ? "Pick a longer range to see the trend." : empty.body}</Text>
          </View>
        )}
      </View>
      {hasRanges ? (
        <View style={{ marginTop: 10 }}>
          <ScopePills<Range>
            onCard
            accessibilityLabel="Time range"
            value={range}
            onChange={(r) => {
              picked.current = true;
              setRange(r);
            }}
            options={[
              { value: "1M", label: "1M" },
              { value: "6M", label: "6M" },
              { value: "1Y", label: "1Y" },
              { value: "All", label: "All" },
            ]}
          />
        </View>
      ) : null}
      {children}
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    labelRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    label: { ...type.subhead, ...weight.semibold, flexShrink: 1 },
    figure: { ...type.amountXL },
    deltaRow: { flexDirection: "row", alignItems: "center", columnGap: 5 },
    delta: { ...type.subhead, ...weight.bold },
    period: { ...type.subhead, ...weight.medium },
    periodShrink: { flexShrink: 1 },
    chartSlot: { marginTop: 12 },
    placeholder: { minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed", borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: 4, padding: 16 },
    phTitle: { ...type.subhead, ...weight.semibold, textAlign: "center" },
    phBody: { ...type.footnote, textAlign: "center" },
  }),
);
