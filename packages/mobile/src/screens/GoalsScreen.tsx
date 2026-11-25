import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { insightsApi } from "@/api/home";
import { goalsApi, invalidateGoals, useGoals } from "@/api/goals";
import { ActionGroup } from "@/components/actions/ActionGroup";
import { useActionVerbs } from "@/components/actions/useActionVerbs";
import { GoalCard } from "@/components/goals/GoalCard";
import { goalColor, GoalTile } from "@/components/goals/GoalParts";
import { useTheme as useDesign } from "@/design";
import { openChat } from "@/lib/chat";
import { formatMoney } from "@/lib/format";
import { openEditGoal, openNewGoal, takeNewlyReached } from "@/lib/goal-sheets";
import { completedLine, goalsSummary, progressOf, reallocatePrompt, savingsActions, suggestedPresets, type Goal } from "@/lib/goals";
import { HIDDEN_AMOUNT, useAmountsHidden } from "@/lib/hide-amounts";
import { openPath } from "@/lib/navigation";
import { figures, icon, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Card, CardSkeleton } from "@/ui/Card";
import { celebrate, committed, failed } from "@/ui/feedback";
import { Divider, SectionHeader } from "@/ui/Form";
import { HeroAmount } from "@/ui/HeroAmount";
import { SavingsProgress } from "@/ui/Progress";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { Sparkle } from "@/ui/Sparkle";
import { EmptyState, ErrorState } from "@/ui/State";
import { pressFeedback } from "@/ui/press";

/**
 * Am I on track (/goals, goals.tsx on the web): saved toward every goal, a
 * card per goal, the page's savings actions, kinds to start, then the
 * finished goals folded away. `+` starts a new goal.
 */
export default function GoalsScreen({ root }: { root: boolean }) {
  const t = useTheme();
  const d = useDesign();
  const qc = useQueryClient();
  const hidden = useAmountsHidden();
  const goals = useGoals();
  const insights = useQuery({ queryKey: ["insights"], queryFn: insightsApi.list });
  const verbs = useActionVerbs();
  const [showCompleted, setShowCompleted] = useState(false);

  const list = goals.data?.goals;
  const s = useMemo(() => goalsSummary(list ?? []), [list]);
  const suggested = useMemo(() => suggestedPresets(list ?? []), [list]);
  const actions = useMemo(() => savingsActions(insights.data?.insights ?? []), [insights.data]);
  const doneHere = verbs.done.filter((r) => r.type === "savings");

  // A goal that reached its target since it was last seen: the screen's one celebration.
  useEffect(() => {
    if (!list) return;
    void takeNewlyReached(list).then((fresh) => {
      if (fresh.length > 0) celebrate(fresh.length === 1 ? `${fresh[0].name} reached its target` : `${fresh.length} goals reached their targets`);
    });
  }, [list]);

  const open = useCallback((g: Goal) => openPath(`/goals/${g.id}`), []);
  const edit = useCallback((g: Goal) => openEditGoal(g.id), []);
  const plan = useCallback((g: Goal) => openEditGoal(g.id, "monthly"), []);
  const reallocate = useCallback((g: Goal) => {
    Alert.alert("Ask about this goal's money?", "This starts a chat about where to put the money that was going to this goal.", [
      { text: "Cancel", style: "cancel" },
      { text: "Ask", onPress: () => openChat(reallocatePrompt(g)) },
    ]);
  }, []);
  const remove = useCallback(
    (g: Goal) => {
      Alert.alert(`Delete "${g.name}"?`, "This permanently removes the goal. Linked accounts are not affected.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete goal",
          style: "destructive",
          onPress: async () => {
            try {
              await goalsApi.remove(g.id);
            } catch {
              failed(`Couldn't delete ${g.name}. Try again.`);
              return;
            }
            invalidateGoals(qc);
            committed(`Deleted ${g.name}`);
          },
        },
      ]);
    },
    [qc],
  );

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([goals.refetch(), insights.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  const nothingYet = !!list && list.length === 0;
  const noActive = !!list && s.active.length === 0;

  return (
    <>
      {/* The chrome contract: the page's create verb. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New goal" onPress={() => openNewGoal()} />
      </Stack.Toolbar>

      <ScreenScroll title="Goals" root={root} refreshing={pulling} onRefresh={() => void onPull()}>
        {goals.isPending ? (
          <>
            <CardSkeleton lines={4} />
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
          </>
        ) : goals.isError && !list ? (
          <ErrorState title="Couldn't load your goals" error={goals.error} onRetry={() => void goals.refetch()} />
        ) : nothingYet ? (
          // The approved empty state: the sleeping mascot where the theme has one, and the screen's one note.
          <EmptyState
            icon="target"
            title="No goals yet"
            body={
              d.mascot
                ? `Pick something you're saving for, like a trip or a rainy day fund. ${d.mascot.name} will wake up and help you get there.`
                : "Setting financial goals is the first step toward achieving them. Create a goal to start tracking your progress."
            }
            action={{ title: d.mascot ? "Set a goal" : "Create your first goal", onPress: () => openNewGoal() }}
            note="most people start with a rainy day fund"
          />
        ) : (
          <>
            {/* 2. Hero: saved toward every active goal. */}
            {noActive ? (
              <Card>
                <EmptyState
                  compact
                  icon="target"
                  title="No active goals"
                  body="Everything you have set is finished. Start another whenever you are ready."
                  action={{ title: "Create a goal", onPress: () => openNewGoal() }}
                />
              </Card>
            ) : s.target > 0 ? (
              <SummaryHero s={s} hidden={hidden} />
            ) : null}

            {/* 3. Your goals. */}
            {s.active.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader>Your goals</SectionHeader>
                {s.active.map((g) => (
                  <GoalCard key={g.id} goal={g} hidden={hidden} onOpen={open} onEdit={edit} onDelete={remove} onPlan={plan} onReallocate={reallocate} />
                ))}
              </View>
            ) : null}

            {/* The page's savings actions, only when there are some. */}
            {actions.length > 0 || doneHere.length > 0 ? (
              <ActionGroup title="Actions" rows={actions} done={doneHere} onComplete={verbs.complete} onSnooze={verbs.snooze} onDismiss={verbs.dismiss} />
            ) : null}

            {/* Kinds to start, each opening the New goal sheet on its fields. */}
            {suggested.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader>Suggested</SectionHeader>
                <Card style={styles.listCard}>
                  {suggested.map((p, i) => (
                    <Fragment key={p.category}>
                      {i > 0 ? <Divider inset={space.rowInset + 48} /> : null}
                      <Pressable
                        onPress={() => openNewGoal(p.category)}
                        accessibilityRole="button"
                        accessibilityLabel={`Add a ${p.name} goal`}
                        style={({ pressed }) => [styles.row, pressFeedback(t, pressed)]}
                      >
                        <GoalTile iconKey={p.icon} color={goalColor(t, p.category)} size={36} variant="soft" />
                        <Text style={[styles.rowTitle, { flex: 1, color: t.content }]} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
                      </Pressable>
                    </Fragment>
                  ))}
                </Card>
              </View>
            ) : null}

            {/* Finished goals, folded. */}
            {s.completed.length > 0 ? (
              <Card style={styles.listCard}>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setShowCompleted((v) => !v);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showCompleted }}
                  accessibilityLabel={`Completed, ${s.completed.length} goal${s.completed.length === 1 ? "" : "s"}`}
                  style={({ pressed }) => [styles.disclosure, pressFeedback(t, pressed)]}
                >
                  <Text style={[styles.disclosureTitle, { color: t.content }]}>Completed</Text>
                  <Text style={[styles.count, { color: t.contentMuted }]}>{s.completed.length}</Text>
                  <SymbolView
                    name="chevron.down"
                    size={icon.sm}
                    weight="semibold"
                    tintColor={t.contentMuted}
                    style={{ transform: [{ rotate: showCompleted ? "180deg" : "0deg" }] }}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </Pressable>
                {showCompleted
                  ? s.completed.map((g) => {
                      const p = progressOf(g);
                      return (
                        <Fragment key={g.id}>
                          <Divider />
                          <Pressable
                            onPress={() => open(g)}
                            accessibilityRole="button"
                            accessibilityLabel={`${g.name}, ${completedLine(g)}, ${formatMoney(p.current, true)} saved`}
                            style={({ pressed }) => [styles.row, pressFeedback(t, pressed)]}
                          >
                            <GoalTile iconKey={g.icon} color={t.brand} size={32} variant="soft" />
                            <View style={{ flex: 1, gap: 1 }}>
                              <View style={styles.nameRow}>
                                <Text style={[styles.rowTitle, { color: t.contentSecondary }]} numberOfLines={1}>
                                  {g.name}
                                </Text>
                                {p.reached ? <Sparkle size={14} /> : null}
                              </View>
                              <Text style={[styles.rowDetail, { color: t.contentMuted }]}>{completedLine(g)}</Text>
                            </View>
                            <Text style={[styles.rowAmount, { color: t.contentSecondary }]}>{formatMoney(p.current, true)}</Text>
                            <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
                          </Pressable>
                        </Fragment>
                      );
                    })
                  : null}
              </Card>
            ) : null}
          </>
        )}
      </ScreenScroll>
    </>
  );
}

/** Saved toward every active goal, against their targets, with one count of goals reached (W-17). */
function SummaryHero({ s, hidden }: { s: ReturnType<typeof goalsSummary>; hidden: boolean }) {
  const t = useTheme();
  const d = useDesign();
  const jar = d.skin.progress === "jar";
  const ink = d.color.tint.goal.ink;
  const stacked = useWindowDimensions().fontScale > 1.3;
  const saved = formatMoney(s.saved, true);
  const target = formatMoney(s.target, true);
  return (
    <Card hero="goal" style={{ gap: 10 }} wash={`radial-gradient(120% 90% at 100% 0%, ${t.infoSoft}, transparent 56%), radial-gradient(90% 80% at 0% 10%, ${t.accentSofter}, transparent 60%)`}>
      <View style={[styles.heroRow, stacked && { flexDirection: "column", alignItems: "flex-start" }]}>
        {jar ? <SavingsProgress pct={s.pct} color={t.brand} size={54} /> : null}
        <View style={stacked ? { gap: 4 } : { flex: 1, gap: 4 }}>
          <Text style={[styles.heroLabel, { color: ink }]} accessibilityRole="header">
            Saved toward goals
          </Text>
          <HeroAmount label={`Saved toward goals, ${hidden ? "hidden" : `${saved} of ${target}`}`}>
            <Text style={[styles.heroFigure, { color: t.content }]} numberOfLines={stacked ? undefined : 1} adjustsFontSizeToFit={!stacked}>
              {hidden ? HIDDEN_AMOUNT : saved}
              {stacked ? null : <Text style={[styles.heroOf, { color: t.contentMuted }]}>{` of ${target}`}</Text>}
            </Text>
            {stacked ? <Text style={[styles.heroOf, { color: t.contentMuted }]}>{`of ${target}`}</Text> : null}
          </HeroAmount>
        </View>
      </View>
      {jar ? null : <SavingsProgress pct={Math.max(s.pct, 2)} color={t.brand} />}
      <View style={styles.heroFoot}>
        <Text style={[styles.heroPct, { color: t.content }]}>{`${s.pct}% of all targets`}</Text>
        <Text style={[styles.heroGo, { color: t.contentMuted }]}>{`${formatMoney(s.remaining, true)} to go`}</Text>
      </View>
      <View style={styles.stats}>
        <Card nested style={styles.stat}>
          <View accessible accessibilityLabel={`Reached, ${s.reached} of ${s.total} goals`}>
            <Text style={[styles.statLabel, { color: t.contentMuted }]}>Reached</Text>
            <Text style={[styles.statValue, { color: t.brandInk }]}>{s.reached}</Text>
            <Text style={[styles.statCaption, { color: t.contentMuted }]}>{`of ${s.total} goal${s.total === 1 ? "" : "s"}`}</Text>
          </View>
        </Card>
        <Card nested style={styles.stat}>
          <View accessible accessibilityLabel={`Average progress, ${s.avgPct}% across active goals`}>
            <Text style={[styles.statLabel, { color: t.contentMuted }]}>Avg. progress</Text>
            <Text style={[styles.statValue, { color: t.content }]}>{`${s.avgPct}%`}</Text>
            <Text style={[styles.statCaption, { color: t.contentMuted }]}>across active goals</Text>
          </View>
        </Card>
      </View>
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    section: { gap: 6 },
    listCard: { padding: 0 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: space.rowInset, paddingVertical: 8 },
    rowTitle: { ...type.callout, ...weight.semibold, flexShrink: 1 },
    rowDetail: { ...type.footnote, ...weight.medium },
    rowAmount: { ...type.subhead, ...figures },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    disclosure: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, paddingHorizontal: space.card },
    disclosureTitle: { ...type.headline, flex: 1 },
    count: { ...type.subhead, ...figures },
    heroRow: { flexDirection: "row", alignItems: "center", gap: 14 },
    heroLabel: { ...type.subhead, ...weight.semibold },
    heroFigure: { ...type.amountXL },
    heroOf: { ...type.headline, ...weight.semibold },
    heroFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" },
    heroPct: { ...type.footnote, ...weight.bold, fontVariant: ["tabular-nums"] },
    heroGo: { ...type.footnote, ...weight.semibold, fontVariant: ["tabular-nums"] },
    stats: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    stat: { flexGrow: 1, flexBasis: 120, padding: 12, gap: 2 },
    statLabel: { ...type.caption, ...weight.semibold },
    statValue: { ...type.amountM },
    statCaption: { ...type.caption, ...weight.medium },
  }),
);
