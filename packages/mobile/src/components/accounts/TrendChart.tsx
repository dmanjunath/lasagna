import { clampedDomain } from "@web/lib/chart-domain";
import * as Haptics from "expo-haptics";
import { memo, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { formatMoney, formatStoredDay } from "@/lib/format";
import { nearestIndex, pickXLabels, smoothLinePath, thinLabels, tickDecimals, tickLabel, timeFractions, type Range, type TrendPoint } from "@/lib/trend";
import { useTheme as useDesign } from "@/design";
import { figures, themedStyles, type, useTheme, weight } from "@/theme";

export const CHART_H = 200;
const TOP = 16;
const BOTTOM = 28;
const RIGHT = 8;
/** Roughly an axis figure's width (footnote figures), for sizing the axis and spacing the dates. */
const CHAR_W = 8;

/**
 * A value over time as the web's NetWorthChart draws it: a smooth line over a
 * soft fill, dashed gridlines with money ticks, up to five dates under it, and
 * the latest point ringed. Dragging across it scrubs: `onScrub` gets the
 * index under the finger, and null when it lets go. With amounts hidden the
 * money axis goes and only the shape stays.
 */
function TrendChartBase({
  points,
  range,
  hidden,
  onScrub,
  label,
  color: lineColor,
}: {
  points: TrendPoint[];
  range: Range;
  hidden: boolean;
  onScrub: (i: number | null) => void;
  /** What the chart is of ("Net worth"), for VoiceOver. */
  label: string;
  /** The line's color: its card's role accent. Net worth's by default. */
  color?: string;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const lastIdx = useRef<number | null>(null);
  const wealth = useDesign().color.tint.wealth.accent;
  const color = lineColor ?? wealth;

  const { min, max, ticks } = useMemo(() => clampedDomain(points.map((p) => p.value)), [points]);
  const decimals = useMemo(() => tickDecimals(ticks, 0), [ticks]);
  const tickChars = Math.max(0, ...ticks.map((v) => tickLabel(v, decimals).length));
  // The axis is as wide as its widest label at the text size it is drawn at (capped where the labels stop growing).
  const axisScale = Math.min(Math.max(useWindowDimensions().fontScale, 1), 1.3);
  const left = hidden ? 4 : Math.round(tickChars * CHAR_W * axisScale + 14);
  const innerW = Math.max(1, width - left - RIGHT);
  const innerH = CHART_H - TOP - BOTTOM;
  // Placed by date, so a gap in the history reads as the time it covers.
  const fracs = useMemo(() => timeFractions(points), [points]);
  const xAt = (i: number) => left + (fracs[i] ?? 0) * innerW;
  const yAt = (v: number) => TOP + innerH - ((v - min) / Math.max(0.0001, max - min)) * innerH;

  const line = useMemo(
    () => (width ? smoothLinePath(points.map((p, i) => [xAt(i), yAt(p.value)])) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, width, min, max, left, fracs],
  );
  const base = (TOP + innerH).toFixed(2);
  const area = line ? `${line} L ${xAt(points.length - 1).toFixed(2)} ${base} L ${xAt(0).toFixed(2)} ${base} Z` : "";
  const xLabels = useMemo(() => thinLabels(pickXLabels(points, range, fracs), points.length, innerW, CHAR_W, fracs), [points, range, innerW, fracs]);

  const scrubTo = (x: number) => {
    if (points.length === 0) return;
    const i = nearestIndex(fracs, Math.min(1, Math.max(0, (x - left) / innerW)));
    if (i === lastIdx.current) return;
    lastIdx.current = i;
    Haptics.selectionAsync();
    setHover(i);
    onScrub(i);
  };
  const release = () => {
    lastIdx.current = null;
    setHover(null);
    onScrub(null);
  };
  // Horizontal drags scrub. A vertical one fails it, so the page still scrolls.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart((e) => scrubTo(e.x))
    .onUpdate((e) => scrubTo(e.x))
    .onFinalize(release);

  const first = points[0];
  const last = points[points.length - 1];
  const summary =
    first && last
      ? `${label} chart, ${formatMoney(first.value, true)} on ${formatStoredDay(first.date, { year: "numeric" })} to ${formatMoney(last.value, true)} on ${formatStoredDay(last.date, { year: "numeric" })}`
      : `${label} chart`;
  const marker = hover ?? points.length - 1;

  return (
    <GestureDetector gesture={pan}>
      <View
        style={{ height: CHART_H }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
      >
        {width > 0 ? (
          <>
            <Svg width={width} height={CHART_H} style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={color} stopOpacity={0.24} />
                  <Stop offset="0.55" stopColor={color} stopOpacity={0.07} />
                  <Stop offset="1" stopColor={color} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {ticks.map((v) => (
                <Line key={v} x1={left} x2={width - RIGHT} y1={yAt(v)} y2={yAt(v)} stroke={t.hairline} strokeWidth={1} strokeDasharray="2 5" />
              ))}
              <Path d={area} fill="url(#trend-area)" />
              <Path d={line} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              {hover !== null ? (
                <Line x1={xAt(hover)} x2={xAt(hover)} y1={TOP} y2={TOP + innerH} stroke={t.contentMuted} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 4" />
              ) : null}
              {last ? (
                <>
                  <Circle cx={xAt(marker)} cy={yAt(points[marker].value)} r={hover !== null ? 14 : 11} fill={color} fillOpacity={hover !== null ? 0.16 : 0.12} />
                  <Circle cx={xAt(marker)} cy={yAt(points[marker].value)} r={5.5} fill={color} stroke={t.panel} strokeWidth={3} />
                </>
              ) : null}
            </Svg>
            {hidden
              ? null
              : ticks.map((v) => (
                  <Text key={v} style={[styles.tick, { top: yAt(v) - 9, width: left - 8, color: t.contentMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {tickLabel(v, decimals)}
                  </Text>
                ))}
            {xLabels.map(({ idx, label: l }) => {
              const end = idx === points.length - 1;
              const start = idx === 0;
              const w = 72;
              const x = xAt(idx);
              return (
                <Text
                  key={`${idx}-${l}`}
                  style={[styles.date, { left: start ? x : end ? x - w : x - w / 2, width: w, textAlign: start ? "left" : end ? "right" : "center", color: t.contentMuted }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                >
                  {l}
                </Text>
              );
            })}
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
}

export const TrendChart = memo(TrendChartBase);

const styles = themedStyles(() =>
  StyleSheet.create({
    // The axes are read, not decoration: footnote size in the muted ink, which holds 4.5:1 on a card and on a tinted hero.
    tick: { ...type.footnote, ...weight.medium, ...figures, position: "absolute", left: 0, textAlign: "right" },
    date: { ...type.footnote, ...weight.medium, ...figures, position: "absolute", bottom: 0 },
  }),
);
