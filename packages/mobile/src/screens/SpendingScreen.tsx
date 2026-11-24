import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useAccountsIndex } from "@/api/accounts";
import { homeApi, insightsApi } from "@/api/home";
import { spendingApi } from "@/api/spending";
import { txnApi } from "@/api/transactions";
import { ActionGroup } from "@/components/actions/ActionGroup";
import { useActionVerbs } from "@/components/actions/useActionVerbs";
import { RecentActivityCard } from "@/components/home/RecentActivityCard";
import { BreakdownCard, type Side } from "@/components/spending/BreakdownCard";
import { CashflowChart } from "@/components/spending/CashflowChart";
import { FilterChips } from "@/components/transactions/FilterChips";
import { FiltersButton, ScopePills, useControlScale } from "@/components/transactions/ScopeRow";
import { spendingActions } from "@/lib/actions";
import { formatMoney } from "@/lib/format";
import { HIDDEN_AMOUNT, useAmountsHidden } from "@/lib/hide-amounts";
import { openPath } from "@/lib/navigation";
import {
  breakdownRows,
  changeLine,
  earliestYearOf,
  monthsBackTo,
  earliestMonthOf,
  periodKey,
  periodName,
  periodRange,
  periodShort,
  periodTitle,
  savingsRate,
  scopeFromQuery,
  recentScope,
  scopeSummary,
  SORT_OPTIONS,
  stepBounds,
  stepPeriod,
  withGranularity,
  type BreakdownSort,
  type Granularity,
  type Period,
} from "@/lib/spending";
import { useCategoryDisplay, useTaxonomy } from "@/lib/taxonomy";
import { loadFilters, saveFilters } from "@/lib/filter-store";
import { EMPTY_FILTERS, filterChips, filtersToApiQuery, filtersToQuery, hasPanelFilters, isAmountActive, transactionsHref, type TxnFilters } from "@/lib/txn-filters";
import { SORTS } from "@/lib/txn-list";
import { openFilters, publishFilters, type FilterSection } from "@/lib/txn-sheets";
import { icon, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { useTheme as useDesign } from "@/design";
import { Card, CardHeader, CardSkeleton } from "@/ui/Card";
import { HeroAmount } from "@/ui/HeroAmount";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { EmptyState, ErrorState } from "@/ui/State";

const RECENT = 5;
// The universal filter, less what this page owns itself: the window (the
// stepper), the order (the breakdown's pills), money in or out (Spent is out
// by definition) and Excluded (an excluded row never counts in a total).
const SECTIONS: FilterSection[] = ["views", "sort", "accounts", "categories", "merchants", "amount", "status"];
const DEFAULT_SORT: BreakdownSort = "amount:desc";

/**
 * Where the money went (/spending): the Spending tab's root, and pushed when a
 * link elsewhere opens it. `query` is the link's scope (period, categories).
 * Order, per the page chrome contract: scope row (month or year, the period,
 * Filters) and its chips, the hero, the page's actions, the breakdown, then
 * the recent transactions.
 */
export default function SpendingScreen({ query, root }: { query?: string; root: boolean }) {
  const t = useTheme();
  const spendInk = useDesign().color.tint.spend.ink;
  const hidden = useAmountsHidden();
  const displayOf = useCategoryDisplay();
  const taxonomy = useTaxonomy();
  const { list: accounts } = useAccountsIndex();
  const arrived = useMemo(() => scopeFromQuery(query), [query]);
  const [period, setPeriod] = useState<Period>(arrived.period);
  const [filter, setFilter] = useState<TxnFilters>({ ...EMPTY_FILTERS, categories: arrived.filter.include, excludeCategories: arrived.filter.exclude });
  const [side, setSide] = useState<Side>("expenses");
  const [sort, setSort] = useState<BreakdownSort>(DEFAULT_SORT);
  const filterActive = hasPanelFilters(filter);
  // Income, net and savings rate describe nothing once the rows are cut by category, merchant or amount.
  const narrowsFlow = filter.categories.length > 0 || filter.excludeCategories.length > 0 || filter.merchants.length > 0 || isAmountActive(filter);

  // The filters stay until cleared. A link names its own scope (a drill, a period), so only a bare visit picks up the last ones.
  const [restored, setRestored] = useState(!!query);
  useEffect(() => {
    if (query) return;
    let live = true;
    void loadFilters("spending").then((saved) => {
      if (!live) return;
      if (saved) setFilter({ ...saved, search: "", datePreset: "all", customStart: "", customEnd: "", kind: "all", sort: "newest", excluded: "any" });
      setRestored(true);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (restored) saveFilters("spending", filter);
  }, [filter, restored]);
  const scope = useMemo(() => filtersToApiQuery(filter), [filter]);

  // Clear all, from the chips or the sheet, also puts the order back.
  const clearOrSet = useCallback((f: TxnFilters) => {
    if (f === EMPTY_FILTERS) setSort(DEFAULT_SORT);
    setFilter(f);
  }, []);

  // The Filters sheet edits this screen's filters while it is in view.
  const publish = useCallback(
    () =>
      publishFilters({
        filters: filter,
        set: clearOrSet,
        page: "spending",
        sections: SECTIONS,
        status: ["pending", "recurring", "source"],
        // The breakdown's order lives in the sheet's Sort, so the card keeps one control row.
        sort: { value: sort, defaultValue: DEFAULT_SORT, options: SORT_OPTIONS, onChange: (v) => setSort(v as BreakdownSort) },
      }),
    [filter, sort],
  );
  useEffect(publish, [publish]);
  useFocusEffect(publish);

  // ── Data
  const range = periodRange(period);
  const key = periodKey(period);
  const summary = useQuery({
    queryKey: ["transactions", "spending-summary", range, scope],
    queryFn: () => spendingApi.summary({ ...range, scope }),
    enabled: restored,
    placeholderData: keepPreviousData,
  });
  const trend = useQuery({
    queryKey: ["transactions", "monthly-trend", period.granularity, scope],
    queryFn: () => spendingApi.trend({ granularity: period.granularity, limit: period.granularity === "month" ? 13 : undefined, scope }),
    enabled: restored,
    placeholderData: keepPreviousData,
  });
  // A year's chart shows its months (one bar for the year would say nothing).
  const yearMonths = useQuery({
    queryKey: ["transactions", "monthly-trend", "year-months", period.year, scope],
    enabled: restored && period.granularity === "year",
    queryFn: async () =>
      (await spendingApi.trend({ granularity: "month", limit: monthsBackTo(period.year), scope })).filter((p) => p.period.startsWith(`${period.year}-`)),
    placeholderData: keepPreviousData,
  });
  const chart = period.granularity === "year" ? yearMonths : trend;
  // Every year, unfiltered: the stepper's floor is the first year with money in or out.
  const years = useQuery({ queryKey: ["transactions", "monthly-trend", "years"], queryFn: () => spendingApi.trend({ granularity: "year" }) });
  const facts = useQuery({ queryKey: ["facts"], queryFn: homeApi.facts });
  const insights = useQuery({ queryKey: ["insights"], queryFn: insightsApi.list });
  // The recent list follows the breakdown's side: money out, or what the Income row counts (recentScope).
  const incomeRows = useMemo(() => (summary.data ? scopeSummary(summary.data, { include: filter.categories, exclude: filter.excludeCategories }).income : []), [summary.data, filter.categories, filter.excludeCategories]);
  const sideScope = useMemo(() => recentScope(side, filter, incomeRows), [side, filter, incomeRows]);
  const recentFilters = useMemo(
    () => filtersToQuery({ ...filter, ...sideScope, datePreset: "custom", customStart: range.startDate, customEnd: range.endDate.slice(0, 10) }),
    [filter, sideScope, range.startDate, range.endDate],
  );
  const recent = useQuery({
    queryKey: ["transactions", "spending-recent", recentFilters],
    queryFn: () => txnApi.query({ filters: recentFilters, sort: SORTS.newest, limit: RECENT }),
    enabled: restored,
    placeholderData: keepPreviousData,
  });
  const verbs = useActionVerbs();

  const earliestYear = years.isPending ? undefined : years.isError ? undefined : earliestYearOf(years.data);
  // The stepper's floor is the first month with money, not that year's January, so it never lands on a stretch of empty months.
  const firstMonths = useQuery({
    queryKey: ["transactions", "monthly-trend", "first-month", earliestYear],
    enabled: earliestYear != null,
    queryFn: () => spendingApi.trend({ granularity: "month", limit: monthsBackTo(earliestYear!) }),
  });
  const earliestMonth = earliestYear == null ? earliestYear : (firstMonths.data && earliestMonthOf(firstMonths.data)) ?? earliestYear;
  const { canBack, canForward } = stepBounds(period, earliestMonth);
  // The period is always named, its arrows disabled when there is nowhere to go. Only a household with no history at all has no stepper.
  const onlyPeriod = earliestYear === null;

  // ── The figures. While a new period loads, the hero reads it off the trend
  // (the same totals, counted the same way) when no filter applies, so the old
  // period's numbers never sit under the new period's name.
  const scoped = summary.data ? scopeSummary(summary.data, { include: filter.categories, exclude: filter.excludeCategories }) : null;
  const stale = summary.isPlaceholderData;
  const trendRow = trend.data?.find((p) => p.period === key) ?? null;
  const instant = stale && !filterActive && !trend.isPlaceholderData && trendRow;
  const spent = instant ? trendRow.expenses : (scoped?.spending ?? 0);
  const income = instant ? trendRow.income : (scoped?.incomeTotal ?? 0);
  const net = instant ? trendRow.net : (scoped?.net ?? 0);
  const rate = savingsRate(income, spent);
  const change = trend.data && !trend.isPlaceholderData ? changeLine(trend.data, key, spent, period.granularity) : null;

  const loaded = !!summary.data && !stale;
  const noData = loaded && !filterActive && summary.data.totalSpending === 0 && summary.data.totalIncome === 0;
  // An empty month inside the household's history keeps the page and its chart, so the way back is in view.
  const emptyPeriod = noData && earliestYear != null;
  const filteredEmpty = loaded && filterActive && scoped!.spending === 0 && scoped!.incomeTotal === 0;

  // ── Breakdown: the side with rows, expenses first.
  const sides: Side[] = scoped ? ([scoped.expenses.length > 0 && "expenses", scoped.income.length > 0 && "income"].filter(Boolean) as Side[]) : [];
  const shownSide: Side = sides.includes(side) ? side : (sides[0] ?? "expenses");
  const rows = useMemo(
    () => (scoped ? breakdownRows(shownSide === "income" ? scoped.income : scoped.expenses, sort, shownSide === "income") : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary.data, filter, shownSide, sort],
  );

  // The page's actions describe recent activity, so they show only on this month or last.
  const now = new Date();
  const recentMonths = [0, 1].map((back) => periodKey({ granularity: "month", year: new Date(now.getFullYear(), now.getMonth() - back, 1).getFullYear(), month: new Date(now.getFullYear(), now.getMonth() - back, 1).getMonth() }));
  const onDefaultPeriod = period.granularity === "month" && recentMonths.includes(key);
  const pageActions = useMemo(() => spendingActions(insights.data?.insights ?? []), [insights.data]);
  const doneHere = verbs.done.filter((r) => ["spending", "behavioral"].includes(r.type ?? "general"));

  // ── Drills carry the period the figure was counted over, and the category scope.
  // Everything else the page is filtered by rides along, so the list shows the same money.
  const carry = { ...filter, search: "" };
  const drill = (categoryIds: string[]) => openPath(transactionsHref({ ...carry, ...range, categories: categoryIds, excludeCategories: [] }));
  const allHref = transactionsHref({ ...filter, ...sideScope, search: "", ...range });
  const recentCount = recent.data?.summary.count ?? 0;

  const chips = useMemo(() => {
    const list = filterChips(filter, taxonomy.data?.groups ?? [], accounts);
    // A non-default breakdown order shows as a chip like any filter, removed back to largest first.
    if (sort !== DEFAULT_SORT) {
      const label = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "";
      list.push({ key: "sort", label, tone: "neutral", removeLabel: `Remove ${label} sort`, next: filter, onRemove: () => setSort(DEFAULT_SORT) });
    }
    return list;
  }, [filter, taxonomy.data, accounts, sort]);
  const step = (dir: -1 | 1) => {
    Haptics.selectionAsync();
    setPeriod((p) => stepPeriod(p, dir));
  };

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([summary.refetch(), trend.refetch(), ...(period.granularity === "year" ? [yearMonths.refetch()] : []), years.refetch(), recent.refetch(), insights.refetch(), facts.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  const money = (v: number) => formatMoney(v, true);
  // Large text leaves no room for three figures side by side, so they stack.
  const stackStats = useWindowDimensions().fontScale > 1.3;
  const largeText = stackStats;
  const unit = period.granularity === "month" ? "month" : "year";
  const stepper = (
    <View style={styles.stepper}>
      <StepButton symbol="chevron.left" label={`Previous ${unit}`} disabled={!canBack} onPress={() => step(-1)} />
      <Text style={[styles.periodText, { color: t.content }]} accessibilityRole="header" accessibilityLabel={periodTitle(period)} numberOfLines={1}>
        {periodShort(period)}
      </Text>
      <StepButton symbol="chevron.right" label={`Next ${unit}`} disabled={!canForward} onPress={() => step(1)} />
    </View>
  );
  const signedNet = hidden ? HIDDEN_AMOUNT : `${net >= 0 ? "+" : "−"}${formatMoney(Math.abs(net), true)}`;
  const noFlow = income === 0 && spent === 0;

  return (
    <>
      {/* The chrome contract: search (Transactions with its field focused). The breakdown's sort is in the Filters sheet. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Search transactions" onPress={() => openPath("/transactions?focus=search")} />
      </Stack.Toolbar>

      <ScreenScroll title="Spending" root={root} refreshing={pulling} onRefresh={() => void onPull()}>
        {/* 1. Scope: month or year, then the period between its arrows and Filters at the row's end, then the applied filters. Large text moves the period to its own row. */}
        <View style={styles.scope}>
          <ScopePills<Granularity>
            accessibilityLabel="Month or year"
            value={period.granularity}
            onChange={(g) => setPeriod((p) => withGranularity(p, g))}
            options={[
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
            ]}
            trailing={
              <View style={styles.trailing}>
                {onlyPeriod || largeText ? null : stepper}
                <FiltersButton on={filterActive} onPress={openFilters} />
              </View>
            }
          />
          {!onlyPeriod && largeText ? <View style={styles.stepperRow}>{stepper}</View> : null}
          <FilterChips chips={chips} onChange={clearOrSet} />
        </View>

        {!summary.data && summary.isPending ? (
          <>
            <CardSkeleton lines={6} />
            <CardSkeleton lines={5} />
          </>
        ) : summary.isError && !summary.data ? (
          <Card>
            <ErrorState compact title="Couldn't load your spending" body="Check your connection and try again." onRetry={() => void summary.refetch()} />
          </Card>
        ) : noData && !emptyPeriod ? (
          facts.data && facts.data.accountsConnected > 0 ? (
            // Linked, with no transactions yet: an estimate, and what it is based on.
            <Card style={{ gap: 6 }}>
              <CardHeader title="Estimated monthly spending" />
              <Text style={[styles.hero, { color: t.content }]} numberOfLines={1} adjustsFontSizeToFit>{money(facts.data.netWorth.byType.creditCards.total)}</Text>
              <Text style={[styles.change, { color: t.contentSecondary }]}>Estimated from your credit card balances.</Text>
            </Card>
          ) : (
            <EmptyState
              icon="creditcard"
              title="No spending to show yet"
              body="Connect a bank or card account to see where your money goes."
              action={{ title: "Connect a bank", onPress: () => openPath("/accounts?autoLink=true") }}
            />
          )
        ) : (
          <>
            {/* 2. Hero: what went out, the change in words, then income, net and savings rate, over the cash flow chart (a year's as its months). */}
            <Card hero="spend" style={{ gap: 14 }}>
              <View style={{ gap: 2, opacity: stale && !instant ? 0.5 : 1 }}>
                <Text style={[styles.caption, { color: spendInk }]}>Spent</Text>
                {/* The hero figure: a tap hides or shows every amount. */}
                <HeroAmount label={`Spent, ${hidden ? "hidden" : money(spent)}`}>
                  <Text style={[styles.hero, { color: t.content }]} numberOfLines={1} adjustsFontSizeToFit>{money(spent)}</Text>
                </HeroAmount>
                {change ? <Text style={[styles.change, { color: t.contentSecondary }]}>{change}</Text> : null}
              </View>
              {/* Under a category, merchant or amount filter, income, net and savings rate describe nothing: only Spent stays. */}
              {narrowsFlow ? null : (
              <View style={[styles.stats, stackStats && styles.statsStacked, { opacity: stale && !instant ? 0.5 : 1 }]}>
                <Stat label="Money in" value={hidden || income <= 0 ? money(income) : `+${money(income)}`} color={!hidden && income > 0 ? t.positive : undefined} row={!stackStats} />
                <Stat
                  row={!stackStats}
                  label="Net"
                  value={noFlow ? "—" : signedNet}
                  color={hidden || noFlow ? undefined : net >= 0 ? t.positive : t.negative}
                />
                <Stat
                  row={!stackStats}
                  label="Savings rate"
                  value={rate === null ? "—" : `${rate < 0 ? "−" : ""}${Math.abs(rate).toFixed(0)}%`}
                  color={rate !== null && rate < 0 ? t.negative : undefined}
                />
              </View>
              )}
              {chart.data && chart.data.length > 0 ? (
                <View style={{ opacity: chart.isPlaceholderData ? 0.5 : 1 }}>
                  <CashflowChart
                    periods={chart.data}
                    selected={period.granularity === "year" ? "" : key}
                    hidden={hidden}
                    spendingOnly={narrowsFlow}
                    onSelect={(k) =>
                      setPeriod(k.length === 4 ? { granularity: "year", year: Number(k), month: 0 } : { granularity: "month", year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)) - 1 })
                    }
                  />
                </View>
              ) : null}
            </Card>

            {/* 3. The page's actions, only on a recent month and only when there are some. */}
            {onDefaultPeriod && (pageActions.length > 0 || doneHere.length > 0) ? (
              <ActionGroup
                title="Actions"
                rows={pageActions}
                done={doneHere}
                onComplete={verbs.complete}
                onSnooze={verbs.snooze}
                onDismiss={verbs.dismiss}
              />
            ) : null}

            {/* 4. Breakdown. */}
            {emptyPeriod ? (
              <Card>
                <EmptyState compact title={`No spending in ${periodName(period)}`} />
              </Card>
            ) : filteredEmpty ? (
              <Card style={{ gap: 4 }}>
                <EmptyState compact title={`Nothing matches these filters in ${periodName(period)}`} />
                <Button size="compact" variant="secondary" title="Clear all" onPress={() => setFilter(EMPTY_FILTERS)} />
              </Card>
            ) : rows.length > 0 ? (
              <View style={{ opacity: stale ? 0.5 : 1 }}>
                <BreakdownCard side={shownSide} onSide={setSide} sides={sides} rows={rows} hidden={hidden} displayOf={displayOf} onDrill={drill} periodKey={period.granularity === "month" ? key : undefined} />
              </View>
            ) : null}

            {/* 5. Recent transactions in the same scope. */}
            {emptyPeriod ? null : recent.data ? (
              <RecentActivityCard
                txns={recent.data.transactions}
                title="Recent transactions"
                allTitle={recentCount > RECENT ? `See all ${recentCount}` : "See all"}
                allLabel={recentCount > RECENT ? `See all ${recentCount} transactions` : "See all transactions"}
                onAll={() => openPath(allHref)}
              />
            ) : recent.isError ? null : (
              <CardSkeleton lines={4} />
            )}
          </>
        )}
      </ScreenScroll>
    </>
  );
}

function StepButton({ symbol, label, disabled, onPress }: { symbol: "chevron.left" | "chevron.right"; label: string; disabled: boolean; onPress: () => void }) {
  const t = useTheme();
  const k = useControlScale();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      // 32pt to look at, 44pt to touch, like the pills beside it.
      hitSlop={6}
      style={({ pressed }) => [styles.stepBtn, { width: 32 * k, height: 32 * k, opacity: disabled ? 0.3 : pressed ? 0.5 : 1 }]}
    >
      <SymbolView name={symbol} size={icon.sm * k} weight="semibold" tintColor={t.content} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/** One figure under the hero. `row`: an equal share of a row, else the full width (stacked for large text). */
function Stat({ label, value, color, row }: { label: string; value: string; color?: string; row: boolean }) {
  const t = useTheme();
  return (
    // A card inside the card, so it stands off the card's fill in every skin.
    <Card nested style={[styles.stat, row && { flex: 1 }]}>
      <View accessible accessibilityLabel={`${label}, ${value === "—" ? "none" : value}`} style={{ gap: 2 }}>
        <Text style={[styles.statLabel, { color: t.contentMuted }]} numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </Text>
        <Text style={[styles.statValue, { color: color ?? t.content }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      </View>
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    scope: { gap: 8 },
    trailing: { flexDirection: "row", alignItems: "center", gap: 4 },
    stepper: { flexDirection: "row", alignItems: "center", gap: 0 },
    stepperRow: { flexDirection: "row", justifyContent: "flex-start" },
    stepBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    periodText: { ...type.subhead, ...weight.semibold, textAlign: "center" },
    caption: { ...type.subhead, ...weight.semibold },
    hero: { ...type.amountXL },
    change: { ...type.subhead },
    stats: { flexDirection: "row", gap: 8 },
    statsStacked: { flexDirection: "column" },
    stat: { paddingHorizontal: 12, paddingVertical: 10 },
    statLabel: { ...type.footnote, ...weight.semibold },
    statValue: { ...type.amountM },
  }),
);
