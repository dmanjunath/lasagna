import type { FinancialPath } from "@web/lib/api";
import { withAlpha } from "@lasagna/design";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { hasRoleColor } from "@/design/tint";
import { maskCurrencyInText, useAmountsHidden } from "@/lib/hide-amounts";
import { currentStep, journeySummary, stepDetail, type LevelState } from "@/lib/journey";
import { figures, type Palette, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, CardHeader } from "@/ui/Card";
import { Skeleton } from "@/ui/Skeleton";
import { Track } from "@/ui/Track";

/** Where the user stands on their financial path, and what to do on this step. */
export function JourneyCard({
  path,
  loading,
  onAllSteps,
  onHelp,
  onDid,
  onSetAside,
  onSetupProfile,
}: {
  path: FinancialPath | undefined;
  loading: boolean;
  onAllSteps: () => void;
  onHelp: () => void;
  onDid: () => Promise<void>;
  onSetAside: () => Promise<void>;
  onSetupProfile: () => void;
}) {
  const t = useTheme();
  useAmountsHidden(); // step copy carries amounts
  const [busy, setBusy] = useState<null | "done" | "not_applicable">(null);
  const wash = `radial-gradient(95% 80% at 0% 8%, ${t.brandSofter}, transparent 60%)`;
  const total = path?.steps.length ?? 0;
  const header = (
    <CardHeader
      title="Financial journey"
      link={{ title: total > 0 ? `See all ${total}` : "See all", label: total > 0 ? `See all ${total} steps` : "See all steps", onPress: onAllSteps }}
    />
  );

  if (loading) {
    return (
      <Card wash={wash} style={{ gap: 14 }}>
        <Skeleton width={180} height={18} />
        <Skeleton width={110} height={44} />
        <Skeleton height={36} />
        <Skeleton width="75%" height={14} />
      </Card>
    );
  }

  const step = currentStep(path);
  if (!path || !step) {
    return (
      <Card wash={wash} style={{ gap: 12 }}>
        {header}
        <Text style={[styles.body, { color: t.contentSecondary }]}>
          Tell us the basics and we'll map your next level and exactly what to do to reach it.
        </Text>
        <Button title="Set up your profile" onPress={onSetupProfile} />
      </Card>
    );
  }

  const s = journeySummary(path);
  const isComplete = step.status === "complete";
  const pct = Math.max(0, Math.min(100, Math.round(step.progress || 0)));
  const detail = stepDetail(step);
  const run = async (kind: "done" | "not_applicable", fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card wash={wash} style={{ gap: 16 }}>
      {header}
      <View style={styles.level} accessible accessibilityLabel={`Step ${s.allComplete ? s.total : step.order} of ${s.total}`}>
        <Text style={[styles.numeral, { color: t.brandInk }]}>{s.allComplete ? s.total : step.order}</Text>
        <Text style={[styles.of, { color: t.contentMuted }]}>of {s.total}</Text>
      </View>
      {s.allComplete ? <Text style={[styles.body, { color: t.contentSecondary }]}>Every layer of the stack is cleared.</Text> : null}

      {path.steps.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Rail states={s.states} />
          <View style={styles.legend}>
            <Legend state="done" label={`${s.done} done`} />
            {!s.allComplete ? <Legend state="current" label="You are here" /> : null}
            {s.ongoing > 0 ? <Legend state="ongoing" label={`${s.ongoing} ongoing`} /> : null}
            {s.future > 0 ? <Legend state="future" label={`${s.future} ahead`} /> : null}
          </View>
        </View>
      ) : null}

      {!s.allComplete ? (
        <View style={[styles.focus, { borderTopColor: t.line }]}>
          <Text style={[styles.stepTitle, { color: t.content }]}>{maskCurrencyInText(step.title)}</Text>
          {step.subtitle ? <Text style={[styles.subtitle, { color: t.contentMuted }]}>{maskCurrencyInText(step.subtitle)}</Text> : null}
          {step.description ? <Text style={[styles.body, { color: t.contentSecondary }]}>{maskCurrencyInText(step.description)}</Text> : null}
          {!isComplete && pct > 0 ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              <Track pct={pct} color={t.brand} />
              {detail ? <Text style={[styles.detail, { color: t.contentMuted }]}>{maskCurrencyInText(detail)}</Text> : null}
            </View>
          ) : null}
          <View style={styles.buttons}>
            <Button title="Walk me through this" onPress={onHelp} disabled={busy !== null} />
            {/* Only where a tick decides anything: a measured step completes itself. */}
            {step.target === null ? (
              <Button title="Mark done" variant="secondary" loading={busy === "done"} disabled={busy !== null} onPress={() => void run("done", onDid)} />
            ) : null}
            <Button
              title="Not applicable to me"
              variant="plain"
              loading={busy === "not_applicable"}
              disabled={busy !== null}
              onPress={() => void run("not_applicable", onSetAside)}
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function segmentColor(t: Palette, st: LevelState, onHero: boolean) {
  if (st === "done" || st === "current") return t.brand;
  // On the money-in hero the soft brand is the card's own fill, so an ongoing step takes a stronger wash.
  if (st === "ongoing") return onHero ? withAlpha(t.brand, 0.35) : t.brandSoft;
  return t.faintFill;
}

/** Whether a rail sits on the money-in hero and the theme tints it (Journey's top card). */
function useOnHero(onHero?: boolean): boolean {
  const c = useDesign().color;
  return !!onHero && hasRoleColor(c, "income");
}

/** One equal segment per step, colored only by state. `onHero`: the rail sits on the money-in hero. */
export function Rail({ states, onHero }: { states: LevelState[]; onHero?: boolean }) {
  const t = useTheme();
  const hero = useOnHero(onHero);
  return (
    <View style={styles.rail} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {states.map((st, i) => (
        <View
          key={i}
          style={[
            styles.seg,
            { backgroundColor: segmentColor(t, st, hero) },
            st === "current" && { borderWidth: 2, borderColor: t.panel, outlineWidth: 2, outlineColor: t.brandRing, outlineStyle: "solid" },
          ]}
        >
          {st === "current" ? <View style={[styles.dot, { backgroundColor: t.brandFg }]} /> : null}
        </View>
      ))}
    </View>
  );
}

export function Legend({ state, label, onHero }: { state: LevelState; label: string; onHero?: boolean }) {
  const t = useTheme();
  const hero = useOnHero(onHero);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: segmentColor(t, state, hero) }]}>
        {state === "current" ? <View style={[styles.swatchDot, { backgroundColor: t.brandFg }]} /> : null}
      </View>
      <Text style={[styles.legendText, { color: t.contentMuted }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  level: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  numeral: { ...type.display },
  of: { ...type.headline, ...figures },
  rail: { flexDirection: "row", gap: 6, height: 36, paddingHorizontal: 4 },
  seg: { flex: 1, maxWidth: 52, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 18, rowGap: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  swatch: { width: 11, height: 11, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  swatchDot: { width: 4, height: 4, borderRadius: 2 },
  legendText: { ...type.caption },
  focus: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, gap: 6 },
  stepTitle: { ...type.headline },
  subtitle: { ...type.footnote },
  body: { ...type.subhead },
  detail: { ...type.footnote, ...weight.semibold, fontVariant: ["tabular-nums"] },
  buttons: { marginTop: 10, gap: 8 },
}));
