import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { maskCurrencyInText } from "@/lib/hide-amounts";
import { statePillLabel, type LevelState, type PathStep } from "@/lib/journey";
import { icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Note } from "@/ui/Note";

// The journey page's pieces (pages/financial-level.tsx): a step's glyph, its
// state pill, and its row in the steps list.

// The web's lucide icons by the step's `icon` key, as SF Symbols.
const STEP_SYMBOL: Record<string, SFSymbol> = {
  shield: "shield",
  gift: "gift",
  flame: "flame",
  "heart-pulse": "heart.text.square",
  sprout: "leaf",
  "trending-up": "chart.line.uptrend.xyaxis",
  "credit-card": "creditcard",
  rocket: "flag.checkered",
  "alert-circle": "exclamationmark.circle",
  "piggy-bank": "banknote",
  layers: "square.3.layers.3d",
  target: "target",
  home: "house",
  wallet: "wallet.pass",
  percent: "percent",
  "line-chart": "chart.xyaxis.line",
  "scroll-text": "scroll",
};

export const stepSymbol = (key: string): SFSymbol => STEP_SYMBOL[key] ?? "square.3.layers.3d";

/** A step's tile: the brand fill on the step you stand on, a tick once done, quiet otherwise. */
export function StepTile({ step, state, size = 40 }: { step: Pick<PathStep, "icon">; state: LevelState; size?: number }) {
  const t = useTheme();
  const current = state === "current";
  const done = state === "done";
  const bg = current ? t.brand : done ? t.brandSoft : t.canvasSunken;
  const fg = current ? t.brandFg : done ? t.brandInk : t.contentMuted;
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: bg }]}>
      <SymbolView name={done ? "checkmark" : stepSymbol(step.icon)} size={icon.md} weight={done ? "bold" : "medium"} tintColor={fg} accessibilityElementsHidden importantForAccessibility="no" />
    </View>
  );
}

/**
 * Where a step stands, never by color alone. On the step you stand on, a
 * theme with a handwritten accent says "you're here" in its hand instead of
 * the pill: the screen's one note.
 */
export function StatePill({ state, rateShaped, onTint }: { state: LevelState; rateShaped: boolean; onTint?: boolean }) {
  const t = useTheme();
  const d = useDesign();
  const label = statePillLabel(state, rateShaped);
  if (label === "You are here" && d.skin.noteAccent === "handwritten") return <Note>you're here</Note>;
  const quiet = label === "Ahead";
  const here = label === "You are here";
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: quiet ? t.canvasSunken : here && onTint ? t.panel : t.brandSoft },
        here && { borderWidth: 1.5, borderColor: t.brandRing },
      ]}
    >
      {label === "Done" ? <SymbolView name="checkmark" size={icon.xs} weight="bold" tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" /> : null}
      {here ? <View style={[styles.dot, { backgroundColor: t.brandInk }]} /> : null}
      <Text style={[styles.pillText, { color: quiet ? t.contentMuted : t.brandInk }]}>{label}</Text>
    </View>
  );
}

/** One step in the list: its tile, number, name and state, opening its detail. Done steps carry a sparkle. */
export function StepRow({ step, state, onPress }: { step: PathStep; state: LevelState; onPress: () => void }) {
  const t = useTheme();
  const current = state === "current";
  const title = maskCurrencyInText(step.title);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Step ${step.order}, ${title}, ${statePillLabel(state, step.rateShaped)}`}
      style={({ pressed }) => [styles.row, current && { backgroundColor: t.brandSoft }, pressed && { backgroundColor: current ? t.brandSofter : t.canvasSunken }]}
    >
      {current ? <View style={[styles.bar, { backgroundColor: t.brand }]} /> : null}
      <StepTile step={step} state={state} />
      <View style={styles.body}>
        <Text style={[styles.order, { color: t.contentMuted }]}>{`Step ${step.order}`}</Text>
        <View style={styles.titleLine}>
          <Text style={[styles.title, { color: t.content }]} numberOfLines={2}>
            {title}
          </Text>
        </View>
        <View style={styles.pillLine}>
          <StatePill state={state} rateShaped={step.rateShaped} onTint={current} />
        </View>
      </View>
      <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    tile: { borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
    pill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    pillText: { ...type.caption, ...weight.semibold },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingHorizontal: space.rowInset, paddingVertical: 10 },
    bar: { position: "absolute", left: 0, top: 8, bottom: 8, width: 4, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
    body: { flex: 1, gap: 3 },
    order: { ...type.caption, ...weight.semibold },
    titleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    title: { ...type.callout, ...weight.semibold, flexShrink: 1 },
    pillLine: { flexDirection: "row", marginTop: 2 },
  }),
);
