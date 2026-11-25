import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { goalsApi, invalidateGoals, useBalances, useGoals } from "@/api/goals";
import { InstIcon } from "@/components/accounts/InstIcon";
import { TrendChart } from "@/components/accounts/TrendChart";
import { goalProgressColor, GoalTile, StatTiles } from "@/components/goals/GoalParts";
import { useTheme as useDesign } from "@/design";
import { formatMoney, formatStoredDay } from "@/lib/format";
import { resolveGoalTarget } from "@lasagna/core/goal-target";
import { openEditGoal, takeGoalDeleted, takeNewlyReached } from "@/lib/goal-sheets";
import { accountTypeName, canMarkComplete, heroLine, heroTiles, linkedAccounts, progressOf, shownCategory, type Goal } from "@/lib/goals";
import { HIDDEN_AMOUNT, useAmountsHidden } from "@/lib/hide-amounts";
import { openPath } from "@/lib/navigation";
import { drawableRange, filterByRange, type Range } from "@/lib/trend";
import { figures, icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, CardHeader, CardSkeleton, TextLink } from "@/ui/Card";
import { celebrate, committed, failed } from "@/ui/feedback";
import { ScopePills } from "@/components/transactions/ScopeRow";
import { Divider } from "@/ui/Form";
import { HeroAmount } from "@/ui/HeroAmount";
import { SavingsProgress } from "@/ui/Progress";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { Sparkle } from "@/ui/Sparkle";
import { EmptyState, ErrorState } from "@/ui/State";
import { Track } from "@/ui/Track";
import { pressFeedback } from "@/ui/press";
import { errorText } from "@/api/client";

/**
 * One goal (/goals/:id, savings-goal.tsx on the web): the hero (jar or bar,
 * saved of target, the pace and its projected date, the figures), its
 * progress over time, and the accounts behind it. Edit opens the Edit goal
 * sheet, which holds Delete. `edit`: the ?edit=1 link (a card's "Plan monthly
 * contribution"), which opens the sheet on the monthly plan.
 */
export default function GoalDetailScreen({ id, edit }: { id: string; edit: boolean }) {
  const t = useTheme();
  const qc = useQueryClient();
  const hidden = useAmountsHidden();
  const goals = useGoals();
  const balances = useBalances();
  const history = useQuery({ queryKey: ["goal-history", id], queryFn: () => goalsApi.history(id) });
  const g = goals.data?.goals.find((x) => x.id === id) ?? null;
  const [busy, setBusy] = useState(false);

  // Deleted from its sheet: step back off the goal.
  useFocusEffect(
    useCallback(() => {
      if (takeGoalDeleted(id)) router.back();
    }, [id]),
  );

  const opened = useRef(false);
  useEffect(() => {
    if (edit && g && !opened.current) {
      opened.current = true;
      openEditGoal(id, "monthly");
    }
  }, [edit, g, id]);

  // Reached since it was last seen: the screen's celebration.
  useEffect(() => {
    if (!g) return;
    void takeNewlyReached([g]).then((fresh) => {
      if (fresh.length > 0) celebrate(`${g.name} reached its target`);
    });
  }, [g]);

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([goals.refetch(), balances.refetch(), history.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  if (goals.isPending) {
    return (
      <ScreenScroll title="" header={<Skeleton width="55%" height={30} style={styles.titleSkeleton} />}>
        <CardSkeleton lines={6} />
        <CardSkeleton lines={3} />
      </ScreenScroll>
    );
  }
  if (goals.isError && !goals.data) {
    return (
      <>
        <Stack.Screen options={{ title: "", headerTransparent: false, headerBackground: undefined, headerTitle: undefined }} />
        <ErrorState title="Couldn't load this goal" body={`Your goal is still here. ${errorText(goals.error)}`} onRetry={() => void goals.refetch()} />
      </>
    );
  }
  if (!g) {
    return (
      <>
        <Stack.Screen options={{ title: "", headerTransparent: false, headerBackground: undefined, headerTitle: undefined }} />
        <EmptyState
          gutter
          icon="target"
          art={false}
          title="Goal not found"
          body="We couldn't find this goal. It may have been deleted."
          action={{ title: "Back to goals", onPress: () => (router.canGoBack() ? router.back() : openPath("/goals", "tab")) }}
        />
      </>
    );
  }

  const p = progressOf(g);
  const archived = g.status === "completed";
  const category = shownCategory(g);
  const derivation = resolveGoalTarget(g.category, g.details)?.derivation ?? null;
  const linked = linkedAccounts(g, balances.data?.balances ?? []);

  const setStatus = async (status: "active" | "completed", undoTo?: "active" | "completed") => {
    setBusy(true);
    try {
      await goalsApi.update(g.id, { status });
    } catch {
      failed("Couldn't update this goal. Try again.");
      return;
    } finally {
      setBusy(false);
    }
    invalidateGoals(qc);
    committed(status === "completed" ? `Marked ${g.name} complete` : `Reopened ${g.name}`, undoTo ? () => void setStatus(undoTo) : undefined);
  };

  const markComplete = () =>
    Alert.alert(
      `Mark "${g.name}" complete?`,
      p.reached
        ? "It moves to your completed list as a finished goal. You can reactivate it anytime."
        : `It's at ${Math.round(p.raw)}% and will be archived at its current amount. You can reactivate it anytime.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Mark complete", onPress: () => void setStatus("completed", "active") },
      ],
    );
  const reactivate = () => {
    if (!p.reached) return void setStatus("active", "completed");
    Alert.alert("Reopen this goal?", "It's still fully funded, so it will show as reached until its balance drops or you raise the target.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reopen goal", onPress: () => void setStatus("active", "completed") },
    ]);
  };

  return (
    <>
      {/* The chrome contract: the page's main verb. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Edit goal" onPress={() => openEditGoal(g.id)}>
          Edit
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <ScreenScroll title={g.name} refreshing={pulling} onRefresh={() => void onPull()}>
        {category || archived ? (
          <View style={styles.meta}>
            {category ? <Text style={[styles.metaText, { color: t.contentMuted }]}>{category}</Text> : null}
            {archived ? (
              <View style={[styles.badge, { backgroundColor: t.brandSoft }]}>
                <SymbolView name="checkmark" size={icon.xs} weight="bold" tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" />
                <Text style={[styles.badgeText, { color: t.brandInk }]}>Completed</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Hero goal={g} hidden={hidden} derivation={derivation} />

        {canMarkComplete(g) ? (
          <Button title="Mark complete" icon="checkmark" iconLeading loading={busy} onPress={markComplete} />
        ) : archived ? (
          <Button title="Reactivate" variant="secondary" loading={busy} onPress={reactivate} />
        ) : null}

        {(history.data?.history.length ?? 0) >= 2 ? <ProgressCard points={history.data!.history} hidden={hidden} /> : null}

        {/* The accounts behind it, each opening its own page. */}
        <Card style={styles.listCard}>
          <View style={styles.cardHead}>
            <CardHeader title={linked.length > 0 ? `Linked accounts, ${linked.length}` : "Linked accounts"} link={{ title: "Manage", label: "Manage linked accounts", onPress: () => openEditGoal(g.id, "accounts") }} />
          </View>
          {balances.isPending ? (
            <View style={styles.pad}>
              <Skeleton height={44} />
            </View>
          ) : linked.length > 0 ? (
            linked.map((a, i) => (
              <Fragment key={a.accountId}>
                {i > 0 ? <Divider inset={space.rowInset + 48} /> : null}
                <Pressable
                  onPress={() => openPath(`/accounts/${a.accountId}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.name}${a.mask ? ` ending ${a.mask}` : ""}, ${formatMoney(parseFloat(a.balance ?? "0"), true)}`}
                  style={({ pressed }) => [styles.row, pressFeedback(t, pressed)]}
                >
                  <InstIcon institution={a.institutionName ?? a.name} manual={a.institutionId === "manual" || !a.institutionName} size={36} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={[styles.rowTitle, { color: t.content }]} numberOfLines={1}>
                      {a.name}
                      {a.mask ? <Text style={{ color: t.contentMuted }}>{` ••${a.mask}`}</Text> : null}
                    </Text>
                    <Text style={[styles.rowDetail, { color: t.contentMuted }]} numberOfLines={1}>
                      {`${accountTypeName(a.type)}${a.asOf ? `, updated ${formatStoredDay(a.asOf)}` : ""}`}
                    </Text>
                  </View>
                  <Text style={[styles.rowAmount, { color: t.content }]}>{formatMoney(parseFloat(a.balance ?? "0"), true)}</Text>
                  <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
                </Pressable>
              </Fragment>
            ))
          ) : (
            <View style={[styles.manual, { borderColor: t.lineStrong, backgroundColor: t.canvasSunken }]}>
              <SymbolView name="banknote" size={icon.md} tintColor={t.contentMuted} accessibilityElementsHidden importantForAccessibility="no" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.manualTitle, { color: t.content }]}>Tracked manually</Text>
                <Text style={[styles.rowDetail, { color: t.contentMuted }]}>Not linked to any accounts. Link one to auto-track progress, or edit the amount by hand.</Text>
              </View>
            </View>
          )}
        </Card>
      </ScreenScroll>
    </>
  );
}

/** The goal's hero: the jar beside the figures, or a bar under them, then the status line and the tiles. */
function Hero({ goal: g, hidden, derivation }: { goal: Goal; hidden: boolean; derivation: string | null }) {
  const t = useTheme();
  const d = useDesign();
  const jar = d.skin.progress === "jar";
  const celebrates = d.skin.celebration === "sparkle";
  // Large text: the jar, the figure and the percent each take their own line.
  const stacked = useWindowDimensions().fontScale > 1.3;
  const p = progressOf(g);
  const color = goalProgressColor(t, d.color, g);
  const saved = formatMoney(p.current, true);
  const target = formatMoney(p.target, true);
  const tiles = useMemo(() => heroTiles(g), [g, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card
      hero="goal"
      style={{ gap: 12 }}
      wash={`radial-gradient(120% 95% at 100% 0%, ${p.reached ? t.brandSoft : t.infoSoft}, transparent 58%), radial-gradient(90% 80% at 0% 10%, ${t.brandSofter}, transparent 60%)`}
    >
      <View style={[styles.heroTop, stacked && styles.heroStacked]}>
        {jar ? <SavingsProgress pct={p.reached ? 100 : p.pct} color={color} size={64} /> : <GoalTile iconKey={g.icon} color={color} size={48} />}
        <View style={stacked ? { gap: 4 } : { flex: 1, gap: 4 }}>
          <Text style={[styles.heroLabel, { color: d.color.tint.goal.ink }]} accessibilityRole="header">
            Saved toward goal
          </Text>
          <HeroAmount label={`Saved toward goal, ${hidden ? "hidden" : `${saved} of ${target}`}`}>
            <Text style={[styles.heroFigure, { color: t.content }]} numberOfLines={stacked ? undefined : 1} adjustsFontSizeToFit={!stacked}>
              {hidden ? HIDDEN_AMOUNT : saved}
              {stacked ? null : <Text style={[styles.heroOf, { color: t.contentMuted }]}>{` of ${target}`}</Text>}
            </Text>
            {stacked ? <Text style={[styles.heroOf, { color: t.contentMuted }]}>{`of ${target}`}</Text> : null}
          </HeroAmount>
        </View>
        {p.reached ? (
          <View style={[styles.reached, { backgroundColor: t.brandSoft }]}>
            {celebrates ? <Sparkle size={14} /> : <SymbolView name="checkmark" size={icon.xs} weight="bold" tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" />}
            <Text style={[styles.reachedText, { color: t.brandInk }]}>Reached</Text>
          </View>
        ) : (
          <Text style={[styles.heroPct, { color: t.contentSecondary }]}>{`${Math.round(p.pct)}%`}</Text>
        )}
      </View>
      {jar ? null : <Track pct={p.reached ? 100 : Math.max(p.pct, 2)} color={color} height={12} />}
      <View style={{ gap: 4 }}>
        {heroLine(g) ? <Text style={[styles.status, { color: p.reached ? t.content : t.contentSecondary }]}>{heroLine(g)}</Text> : null}
        {derivation ? <Text style={[styles.derivation, { color: t.contentMuted }]}>{derivation}</Text> : null}
      </View>
      <StatTiles tiles={tiles} onAction={() => openEditGoal(g.id, "date")} />
    </Card>
  );
}

/** Saved over time, labeled and scrubbable, with its range. Amounts hidden: the shape only. */
function ProgressCard({ points, hidden }: { points: Array<{ date: string; value: number }>; hidden: boolean }) {
  const [range, setRange] = useState<Range>(() => drawableRange(points, "All"));
  const shown = useMemo(() => {
    const f = filterByRange(points, range);
    return f.length >= 2 ? f : points;
  }, [points, range]);
  return (
    <Card style={{ gap: 10 }}>
      <CardHeader title="Progress" />
      <TrendChart points={shown} range={range} hidden={hidden} onScrub={() => {}} label="Saved toward goal" />
      <ScopePills<Range>
        onCard
        accessibilityLabel="History range"
        value={range}
        onChange={setRange}
        options={[
          { value: "1M", label: "1M" },
          { value: "6M", label: "6M" },
          { value: "1Y", label: "1Y" },
          { value: "All", label: "All" },
        ]}
      />
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    titleSkeleton: { marginHorizontal: space.card, marginVertical: 4 },
    meta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: space.card, marginTop: -6 },
    metaText: { ...type.subhead, ...weight.medium },
    badge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { ...type.caption, ...weight.semibold },
    heroTop: { flexDirection: "row", alignItems: "center", gap: 14 },
    heroStacked: { flexDirection: "column", alignItems: "flex-start", gap: 8 },
    heroLabel: { ...type.subhead, ...weight.semibold },
    heroFigure: { ...type.amountXL },
    heroOf: { ...type.headline, ...weight.semibold },
    heroPct: { ...type.amountL },
    reached: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
    reachedText: { ...type.subhead, ...weight.bold },
    status: { ...type.subhead, ...weight.semibold, fontVariant: ["tabular-nums"] },
    derivation: { ...type.footnote },
    listCard: { padding: 0, paddingBottom: 6 },
    cardHead: { paddingHorizontal: space.card, paddingTop: space.card, paddingBottom: 6 },
    pad: { paddingHorizontal: space.card, paddingBottom: 10 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: space.rowInset, paddingVertical: 8 },
    rowTitle: { ...type.callout, ...weight.semibold },
    rowDetail: { ...type.footnote },
    rowAmount: { ...type.subhead, ...figures },
    manual: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: space.card, marginBottom: 10, padding: 14, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed" },
    manualTitle: { ...type.subhead, ...weight.semibold },
  }),
);
