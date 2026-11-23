import { useQuery } from "@tanstack/react-query";
import { toActionRow } from "@web/lib/action-rows";
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { insightsApi } from "@/api/home";
import { ActionGroup, ActionGroupSkeleton } from "@/components/actions/ActionGroup";
import { CaughtUpCard } from "@/components/actions/CaughtUpCard";
import { useActionVerbs } from "@/components/actions/useActionVerbs";
import { ALL_AREAS, areaFilters, bandOf, bandRows, canRefresh, inArea, updatedLine } from "@/lib/actions";
import { ScopePills } from "@/components/transactions/ScopeRow";
import { space, themedStyles, type, useTheme } from "@/theme";
import { TextLink } from "@/ui/Card";
import { failed } from "@/ui/feedback";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { EmptyState, ErrorState } from "@/ui/State";

/**
 * Every open action (/insights), pushed from Home's "See all" and the drawer:
 * the area rail, then the actions by how pressing they are, then the closing
 * card, then when they were made and Refresh (a paid rewrite, which asks first).
 */
export default function ActionsScreen() {
  const t = useTheme();
  const q = useQuery({ queryKey: ["insights"], queryFn: insightsApi.list });
  const verbs = useActionVerbs();
  const [area, setArea] = useState(ALL_AREAS);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(() => (q.data?.insights ?? []).map(toActionRow), [q.data]);
  const filters = useMemo(() => areaFilters(rows), [rows]);
  // A filter whose last action has gone falls back to All.
  useEffect(() => {
    if (area !== ALL_AREAS && !filters.some((f) => f.value === area)) setArea(ALL_AREAS);
  }, [filters, area]);
  const shown = rows.filter((r) => inArea(r, area));
  const bands = bandRows(shown);
  const doneHere = verbs.done.filter((r) => inArea(r, area));
  const lastGenerated = q.data?.lastActionsGeneratedAt ?? null;
  const refreshReady = canRefresh(lastGenerated);

  // Rewrites the actions from the latest numbers. It costs money, so it asks first.
  const confirmRefresh = () =>
    Alert.alert("Refresh your actions?", "This rewrites your actions from your latest numbers. You can do this once every 3 hours.", [
      { text: "Cancel", style: "cancel" },
      { text: "Refresh", isPreferred: true, onPress: () => void refresh() },
    ]);
  const refresh = async () => {
    setRefreshing(true);
    try {
      // The detected savings are throttled on their own clock, so a refusal there must not stop the rest.
      await insightsApi.refreshSpendCuts().catch(() => {});
      await insightsApi.generate();
      await q.refetch();
    } catch {
      failed("Couldn't refresh your actions. Try again later.");
    } finally {
      setRefreshing(false);
    }
  };

  const onPull = async () => {
    setPulling(true);
    try {
      await q.refetch();
    } finally {
      setPulling(false);
    }
  };

  const updated = updatedLine(lastGenerated);
  const total = rows.length;

  return (
    <>
      <ScreenScroll title="Actions" refreshing={pulling} onRefresh={() => void onPull()}>
        {q.isPending || refreshing ? (
          <>
            <ActionGroupSkeleton rows={2} hero />
            <ActionGroupSkeleton rows={3} />
          </>
        ) : q.isError ? (
          <ErrorState title="Couldn't load your actions" body="Check your connection and try again." onRetry={() => void q.refetch()} />
        ) : total === 0 && verbs.done.length === 0 ? (
          lastGenerated ? (
            <CaughtUpCard celebrate title="You're all caught up" body="New actions show up here as your accounts, spending and goals change." />
          ) : (
            <EmptyState
              icon="sparkles"
              title="No actions yet"
              body="Actions come from your accounts, spending and goals."
              action={{ title: "Generate actions", onPress: confirmRefresh }}
            />
          )
        ) : (
          <>
            {filters.length > 1 ? <ScopePills scroll accessibilityLabel="Filter actions by area" value={area} onChange={setArea} options={filters} /> : null}
            {/* The first band is the screen's hero. */}
            {bands.map((b, i) => (
              <ActionGroup
                key={b.key}
                hero={i === 0}
                title={b.title}
                count={b.rows.length}
                rows={b.rows}
                done={doneHere.filter((r) => bandOf(r) === b.key)}
                onComplete={verbs.complete}
                onSnooze={verbs.snooze}
                onDismiss={verbs.dismiss}
              />
            ))}
            {/* A band emptied on this visit still shows what was done in it. */}
            {doneHere.some((r) => !bands.some((b) => b.key === bandOf(r))) ? (
              <ActionGroup
                title="Done"
                rows={[]}
                done={doneHere.filter((r) => !bands.some((b) => b.key === bandOf(r)))}
                onComplete={verbs.complete}
                onSnooze={verbs.snooze}
                onDismiss={verbs.dismiss}
              />
            ) : null}
            {area === ALL_AREAS ? (
              total === 0 ? (
                <CaughtUpCard celebrate title="You're all caught up" body="New actions show up here as your accounts, spending and goals change." />
              ) : (
                <CaughtUpCard celebrate={false} title="That's everything for now" body="New actions show up here as your accounts, spending and goals change." />
              )
            ) : null}
            {/* When the list was made, and the way to make it again. No overflow menu: it sits where it applies. */}
            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: t.contentMuted }]} accessibilityLiveRegion="polite">
                {refreshing
                  ? "Refreshing your actions."
                  : [updated ? `${updated}.` : null, q.data?.refreshing ? "New actions are on the way and can take up to a day." : refreshReady ? null : "You can refresh once every 3 hours."].filter(Boolean).join(" ")}
              </Text>
              {/* A refresh the server already has under way can't be asked for again. */}
              <TextLink title="Refresh" label="Refresh actions" disabled={refreshing || !refreshReady || q.isPending || !!q.data?.refreshing} onPress={confirmRefresh} />
            </View>
          </>
        )}
      </ScreenScroll>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // Lines up with the cards' text, as the Journey footnote does.
    footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: space.card, paddingBottom: 8 },
    footerText: { ...type.footnote, flex: 1 },
  }),
);
