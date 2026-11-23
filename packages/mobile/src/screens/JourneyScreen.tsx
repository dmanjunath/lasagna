import { useQuery } from "@tanstack/react-query";
import type { FinancialPath } from "@web/lib/api";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { Fragment, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { authApi } from "@/api/auth";
import { pathApi } from "@/api/home";
import { useAuth } from "@/auth/AuthProvider";
import { Legend, Rail } from "@/components/home/JourneyCard";
import { StepRow } from "@/components/journey/JourneyParts";
import { useStepMark } from "@/components/journey/useStepMark";
import { openChat } from "@/lib/chat";
import { maskCurrencyInText, useAmountsHidden } from "@/lib/hide-amounts";
import { onboardingResume } from "@/lib/home";
import { currentStep, journeySummary, levelStateOf, needsNumbers, offPathLine, updatedLine } from "@/lib/journey";
import { openPath, pushInTab } from "@/lib/navigation";
import { figures, icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, CardSkeleton, TextLink } from "@/ui/Card";
import { failed } from "@/ui/feedback";
import { Divider, SectionHeader } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { EmptyState, ErrorState } from "@/ui/State";

/** A step's own screen, pushed in the current tab. */
export const openStep = (id: string) => pushInTab(`/financial-level/${encodeURIComponent(id)}`);

/**
 * Where you are on your financial path (/financial-level, financial-level.tsx
 * on the web): the climb (the step you stand on, the rail, the retirement
 * verdict), every step on the path, and the ones off it. A step opens its own
 * screen, which replaces the web's inline accordion. `step` is the web's
 * ?step= link: that step opens once the path is in.
 */
export default function JourneyScreen({ step: asked }: { step?: string }) {
  const t = useTheme();
  useAmountsHidden(); // step names carry amounts
  const path = useQuery({ queryKey: ["financial-path"], queryFn: pathApi.get });
  const { user } = useAuth();
  const canMark = !user?.isDemo;
  const { mark, busy } = useStepMark();
  const [offOpen, setOffOpen] = useState(false);

  // A ?step= link opens that step once, if it is on the path.
  const opened = useRef(false);
  useEffect(() => {
    if (!asked || opened.current || !path.data) return;
    opened.current = true;
    if (path.data.steps.some((s) => s.id === asked)) openStep(asked);
  }, [asked, path.data]);

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await path.refetch();
    } finally {
      setPulling(false);
    }
  };

  const body = () => {
    if (path.isPending) {
      return (
        <>
          <Skeleton width="70%" height={14} style={styles.lineSkeleton} />
          <CardSkeleton lines={4} />
          <CardSkeleton lines={6} />
        </>
      );
    }
    if (path.isError && !path.data) {
      return (
        <ErrorState
          title="We couldn't load your path"
          body="Your steps and everything you have marked are safe. This is on our side, so trying again usually works."
          onRetry={() => void path.refetch()}
        />
      );
    }
    const data = path.data!;
    if (needsNumbers(data.summary)) return <NeedsNumbers />;
    return <Path data={data} canMark={canMark} busyId={busy?.id ?? null} onPutBack={(off) => void mark(off, "pending", "not_applicable")} offOpen={offOpen} setOffOpen={setOffOpen} />;
  };

  return (
    <ScreenScroll title="Financial journey" refreshing={pulling} onRefresh={() => void onPull()}>
      {body()}
    </ScreenScroll>
  );
}

/** Nothing to build steps from: finish setup, or connect a bank. */
function NeedsNumbers() {
  const { user, refresh } = useAuth();
  const resume = onboardingResume(user);
  const finishSetup = async () => {
    // Onboarding put off with "Finish later" picks up where it stopped. Finished, the figures live in Settings.
    if (!resume) return openPath("/profile#income");
    try {
      await authApi.onboardingDeferred(false);
      await refresh();
    } catch {
      failed("Couldn't open setup. Try again.");
    }
  };
  return (
    <EmptyState
      icon="flag.checkered"
      title="Let's get your numbers"
      body="Add your income and accounts and we'll build the steps that apply to you."
      action={{ title: "Finish setup", onPress: () => void finishSetup() }}
      secondary={{ title: "Connect a bank", onPress: () => openPath("/accounts?autoLink=true") }}
    />
  );
}

function Path({
  data,
  canMark,
  busyId,
  onPutBack,
  offOpen,
  setOffOpen,
}: {
  data: FinancialPath;
  canMark: boolean;
  busyId: string | null;
  onPutBack: (off: { id: string; title: string }) => void;
  offOpen: boolean;
  setOffOpen: (fn: (v: boolean) => boolean) => void;
}) {
  const t = useTheme();
  const { steps, offPath, currentStepId, summary } = data;
  const s = journeySummary(data);
  const here = currentStep(data);
  const count = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;

  return (
    <>
      {/* The climb. */}
      <Card hero="income" wash={`radial-gradient(95% 80% at 0% 8%, ${t.brandSofter}, transparent 60%)`} style={styles.hero}>
        <View style={styles.level} accessible accessibilityLabel={`Step ${s.allComplete ? s.total : (here?.order ?? 1)} of ${steps.length}`}>
          <Text style={[styles.numeral, { color: t.brandInk }]}>{s.allComplete ? steps.length : (here?.order ?? 1)}</Text>
          <Text style={[styles.of, { color: t.contentMuted }]}>{`of ${steps.length}`}</Text>
        </View>
        {!s.allComplete && here ? (
          <View style={{ gap: 4 }}>
            <Text style={[styles.heroStep, { color: t.content }]}>{maskCurrencyInText(here.title)}</Text>
            {!summary.retirement && summary.retirementAgeSet ? <Text style={[styles.heroMeta, { color: t.contentMuted }]}>{`FI target age ${summary.retirementAge}`}</Text> : null}
          </View>
        ) : null}
        {steps.length > 0 ? (
          <View style={{ gap: 10 }}>
            <Rail states={s.states} onHero />
            <View style={styles.legend}>
              <Legend onHero state="done" label={`${s.done} done`} />
              {!s.allComplete ? <Legend onHero state="current" label="You are here" /> : null}
              {s.ongoing > 0 ? <Legend onHero state="ongoing" label={`${s.ongoing} ongoing`} /> : null}
              {s.future > 0 ? <Legend onHero state="future" label={`${s.future} ahead`} /> : null}
            </View>
          </View>
        ) : null}
        {summary.retirement ? <Verdict retirement={summary.retirement} /> : null}
      </Card>

      {s.allComplete ? (
        <Card style={{ gap: 12 }}>
          <View style={{ gap: 4 }}>
            <Text style={[styles.cardTitle, { color: t.content }]} accessibilityRole="header">
              Every step done
            </Text>
            <Text style={[styles.lead, { color: t.contentMuted }]}>Time to fine-tune your plan.</Text>
          </View>
          <Button
            title="Ask what's next"
            variant="tinted"
            size="compact"
            icon="arrow.right"
            style={{ alignSelf: "flex-start" }}
            onPress={() => openChat(`I've finished all ${steps.length} steps on my financial path. What should I focus on next?`)}
          />
        </Card>
      ) : null}

      {/* Every step, each opening its own screen. */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <SectionHeader style={{ flex: 1 }}>{`Your ${count}`}</SectionHeader>
          <View style={styles.why}>
            <TextLink title="Why these steps?" onPress={() => pushInTab("/journey-why")} />
          </View>
        </View>
        <Text style={[styles.sectionLead, { color: t.contentMuted }]}>Earlier steps usually pay off most, but you can work them in any order.</Text>
        <Card style={styles.listCard}>
          {steps.map((step, i) => (
            <Fragment key={step.id}>
              {i > 0 ? <Divider inset={space.rowInset + 52} /> : null}
              <StepRow step={step} state={levelStateOf(step, currentStepId)} onPress={() => openStep(step.id)} />
            </Fragment>
          ))}
        </Card>
      </View>

      {/* Off the path: folded under one row, each offered back. */}
      {offPath.length > 0 ? (
        <Card style={styles.listCard}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setOffOpen((v) => !v);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: offOpen }}
            accessibilityLabel={`Not on your path, ${offPath.length} ${offPath.length === 1 ? "step" : "steps"}`}
            style={({ pressed }) => [styles.disclosure, pressed && { backgroundColor: t.canvasSunken }]}
          >
            <Text style={[styles.disclosureTitle, { color: t.content }]}>Not on your path</Text>
            <Text style={[styles.count, { color: t.contentMuted }]}>{offPath.length}</Text>
            <SymbolView
              name="chevron.down"
              size={icon.sm}
              weight="semibold"
              tintColor={t.contentMuted}
              style={{ transform: [{ rotate: offOpen ? "180deg" : "0deg" }] }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Pressable>
          {offOpen
            ? offPath.map((off) => {
                const line = offPathLine(off);
                return (
                  <Fragment key={off.id}>
                    <Divider />
                    <View style={styles.offRow}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={[styles.offTitle, { color: t.contentSecondary }]}>{maskCurrencyInText(off.title)}</Text>
                        {line ? <Text style={[styles.offLine, { color: t.contentMuted }]}>{maskCurrencyInText(line)}</Text> : null}
                      </View>
                      {canMark ? (
                        <Button
                          title="Put back"
                          variant="plain"
                          size="compact"
                          loading={busyId === off.id}
                          disabled={busyId !== null}
                          accessibilityLabel={`Put back ${maskCurrencyInText(off.title)}`}
                          onPress={() => onPutBack(off)}
                        />
                      ) : null}
                    </View>
                  </Fragment>
                );
              })
            : null}
        </Card>
      ) : null}

      {/* When the order was last settled, and why: a footnote at the end, not meta under the title. */}
      <Text style={[styles.updated, { color: t.contentMuted }]}>{updatedLine(data.updatedAt, data.updatedReason)}</Text>
    </>
  );
}

/** What the retirement simulation concluded, and the way to the run behind it. */
function Verdict({ retirement }: { retirement: NonNullable<FinancialPath["summary"]["retirement"]> }) {
  const t = useTheme();
  // The simulation's three bands as meaningful color (owner, 2026-11-23): on track basil, needs
  // attention yellow, at risk sauce. The verdict is the server's verdictFor, never recomputed here.
  const v = retirement.verdict;
  const on = v === "on_track";
  const age = retirement.retirementAge;
  const text = on ? `On track to retire at ${age}` : v === "needs_attention" ? `Retiring at ${age} needs attention` : `Retiring at ${age} is at risk`;
  const ink = on ? t.brandInk : v === "needs_attention" ? t.caution : t.negative;
  const fill = on ? t.brandSoft : v === "needs_attention" ? t.cautionSoft : t.negativeSoft;
  return (
    <View style={[styles.verdictBand, { borderTopColor: t.line }]}>
      <Pressable
        onPress={() => openPath("/retirement")}
        accessibilityRole="link"
        accessibilityLabel={`${text}. Opens Retirement`}
        hitSlop={{ top: 6, bottom: 6 }}
        style={({ pressed }) => [styles.verdict, { backgroundColor: fill, opacity: pressed ? 0.6 : 1 }]}
      >
        <SymbolView name={on ? "checkmark" : v === "needs_attention" ? "exclamationmark.circle" : "exclamationmark.triangle"} size={icon.xs} weight="bold" tintColor={ink} accessibilityElementsHidden importantForAccessibility="no" />
        <Text style={[styles.verdictText, { color: ink }]}>{text}</Text>
        <SymbolView name="chevron.right" size={icon.xs} weight="semibold" tintColor={ink} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    lineSkeleton: { marginHorizontal: space.card, marginTop: -4 },
    updated: { ...type.footnote, ...weight.medium, paddingHorizontal: space.card },
    hero: { gap: 16 },
    level: { flexDirection: "row", alignItems: "baseline", gap: 8 },
    numeral: { ...type.display },
    of: { ...type.headline, ...figures },
    heroStep: { ...type.headline },
    heroMeta: { ...type.footnote, ...weight.medium },
    legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 18, rowGap: 6 },
    verdictBand: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
    verdict: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 36, borderRadius: radius.pill, paddingHorizontal: 12 },
    verdictText: { ...type.footnote, ...weight.bold, flexShrink: 1 },
    cardTitle: { ...type.title },
    lead: { ...type.subhead, ...weight.medium },
    section: { gap: 6 },
    sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: space.card },
    why: { minHeight: 32, justifyContent: "center" },
    sectionLead: { ...type.footnote, ...weight.medium, paddingHorizontal: space.card, marginBottom: 4 },
    listCard: { padding: 0 },
    disclosure: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, paddingHorizontal: space.card },
    disclosureTitle: { ...type.headline, flex: 1 },
    count: { ...type.subhead, ...figures },
    offRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: space.rowInset, paddingVertical: 10 },
    offTitle: { ...type.callout, ...weight.semibold },
    offLine: { ...type.footnote },
  }),
);
