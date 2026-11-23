import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { homeApi, insightsApi } from "@/api/home";
import { portfolioApi } from "@/api/portfolio";
import { ActionGroup } from "@/components/actions/ActionGroup";
import { useActionVerbs } from "@/components/actions/useActionVerbs";
import { Allocation } from "@/components/allocation/Allocation";
import { TickerIcon } from "@/components/allocation/TickerIcon";
import { FilterChips } from "@/components/transactions/FilterChips";
import { FiltersButton, ScopePills } from "@/components/transactions/ScopeRow";
import { useTheme as useDesign } from "@/design";
import { openAddAccount } from "@/lib/account-sheets";
import { loadFilters, saveFilters } from "@/lib/filter-store";
import { formatMoney } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { pushInTab } from "@/lib/navigation";
import { pageActions } from "@/lib/page-actions";
import {
  accountsIn,
  allocationSlices,
  cleanAccountLabel,
  collapseSmall,
  drillFrom,
  filterByAccounts,
  fmtPct,
  formatReturn,
  GROUPS,
  HOLDING_SORTS,
  holdingGain,
  holdingMeta,
  holdingsByTicker,
  OTHER,
  securityName,
  sortHoldings,
  totalOf,
  type GroupBy,
  type HoldingRow,
  type HoldingSort,
} from "@/lib/portfolio";
import { EMPTY_FILTERS, filterChips, type TxnFilters } from "@/lib/txn-filters";
import { openFilters, publishFilters } from "@/lib/txn-sheets";
import { figures, icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Card, CardSkeleton, TextLink } from "@/ui/Card";
import { Divider, SectionHeader } from "@/ui/Form";
import { HeroAmount } from "@/ui/HeroAmount";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { EmptyState, ErrorState } from "@/ui/State";

const HERE = "/portfolio";
// Liabilities are not assets: a card or loan is never a slice of the allocation.
const LIABILITIES = new Set(["loan", "credit"]);
const SORT_KEY = "lasagna-portfolio-sort";

/**
 * What you hold (/portfolio, portfolio-composition.tsx on the web): the
 * allocation by class, category, holding or account, as one bar and its
 * ranked legend (a row drills into its bucket), the page's actions, then the
 * holdings. A holding opens a sheet of the accounts that hold it. The account
 * filter is the scope row's Filters pill, the holdings' sort is the pills over
 * the list.
 */
export default function PortfolioScreen() {
  const t = useTheme();
  const d = useDesign();
  const hidden = useAmountsHidden();
  const composition = useQuery({ queryKey: ["portfolio", "composition"], queryFn: portfolioApi.composition });
  const exposure = useQuery({ queryKey: ["portfolio", "exposure"], queryFn: portfolioApi.exposure });
  const balances = useQuery({ queryKey: ["accounts", "balances"], queryFn: homeApi.balances });
  const insights = useQuery({ queryKey: ["insights"], queryFn: insightsApi.list });
  const verbs = useActionVerbs();
  const actions = useMemo(() => pageActions(insights.data?.insights ?? [], ["portfolio"]), [insights.data]);
  const doneHere = verbs.done.filter((r) => r.type === "portfolio");

  const [groupBy, setGroupBy] = useState<GroupBy>("assetClass");
  const [drill, setDrill] = useState<string | null>(null);
  // The account filter is the universal filter's Accounts section. Holdings
  // name their account by label, so its ids here are those labels.
  const [filter, setFilterState] = useState<TxnFilters>(EMPTY_FILTERS);
  const [sort, setSortState] = useState<HoldingSort>("value:desc");
  const [restored, setRestored] = useState(false);
  // Both stay until cleared.
  useEffect(() => {
    void Promise.all([loadFilters("portfolio"), AsyncStorage.getItem(SORT_KEY).catch(() => null)]).then(([f, s]) => {
      if (f) setFilterState({ ...EMPTY_FILTERS, accountIds: f.accountIds });
      if (s && HOLDING_SORTS.some((o) => o.value === s)) setSortState(s as HoldingSort);
      setRestored(true);
    });
  }, []);
  const setFilter = useCallback((f: TxnFilters) => {
    setDrill(null);
    setFilterState({ ...EMPTY_FILTERS, accountIds: f.accountIds });
  }, []);
  useEffect(() => {
    if (restored) saveFilters("portfolio", filter);
  }, [filter, restored]);
  const setSort = (s: HoldingSort) => {
    setSortState(s);
    AsyncStorage.setItem(SORT_KEY, s).catch(() => {});
  };

  const classes = composition.data?.assetClasses ?? [];
  const allAccounts = useMemo(() => accountsIn(classes), [classes]);
  // A saved account that no longer holds anything filters nothing.
  const picked = filter.accountIds.filter((a) => allAccounts.includes(a));
  const active = picked.length > 0 ? new Set(picked) : null;
  const options = useMemo(() => allAccounts.map((a) => ({ id: a, name: cleanAccountLabel(a) })), [allAccounts]);
  const publish = useCallback(
    () => publishFilters({ filters: { ...filter, accountIds: picked }, set: setFilter, page: "portfolio", sections: ["views", "accounts"], accounts: options }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, options, setFilter],
  );
  useEffect(publish, [publish]);
  useFocusEffect(publish);
  const chips = useMemo(() => filterChips({ ...filter, accountIds: picked }, [], options.map((o) => ({ ...o, mask: null }))), [filter, picked, options]);
  const filtered = useMemo(() => filterByAccounts(classes, active), [classes, active]);
  const total = totalOf(filtered, composition.data?.totalValue ?? 0);
  const holdings = useMemo(() => holdingsByTicker(filtered, total, exposure.data ?? null), [filtered, total, exposure.data]);
  const sorted = useMemo(() => sortHoldings(holdings, sort), [holdings, sort]);
  const slices = useMemo(() => collapseSmall(allocationSlices(groupBy, drill, filtered, total, holdings)), [groupBy, drill, filtered, total, holdings]);
  const drillTotal = slices.reduce((s, x) => s + x.value, 0);

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([composition.refetch(), exposure.refetch(), balances.refetch(), insights.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  const actionsGroup =
    actions.length > 0 || doneHere.length > 0 ? (
      <ActionGroup title="Actions" rows={actions} done={doneHere} here={HERE} onComplete={verbs.complete} onSnooze={verbs.snooze} onDismiss={verbs.dismiss} />
    ) : null;

  const openHolding = (h: HoldingRow) => {
    const name = securityName(h);
    pushInTab(`/holding?symbol=${encodeURIComponent(h.ticker)}&label=${encodeURIComponent(h.label)}${name ? `&name=${encodeURIComponent(name)}` : ""}`);
  };

  const body = (() => {
    if (composition.isPending || balances.isPending) {
      return (
        <>
          <CardSkeleton lines={7} />
          <CardSkeleton lines={5} />
        </>
      );
    }
    if (!composition.data) {
      return <ErrorState title="Couldn't load your portfolio" body="Check your connection and try again." onRetry={() => void composition.refetch()} />;
    }
    if (classes.length === 0) {
      // No holdings. With accounts, the split across them, then the way to holdings.
      const accts = (balances.data?.balances ?? [])
        .filter((b) => !LIABILITIES.has(b.type))
        .map((b) => ({ id: b.accountId, name: b.name, value: Math.abs(parseFloat(b.balance || "0")), type: b.type }))
        .filter((a) => a.value > 0)
        .sort((a, b) => b.value - a.value);
      const sum = accts.reduce((s, a) => s + a.value, 0);
      const TYPE_CHART: Record<string, number> = { depository: 0, investment: 1, real_estate: 2, alternative: 4 };
      return (
        <>
          {accts.length > 0 ? (
            <Card hero="wealth" style={{ gap: 14 }}>
              <View style={{ gap: 2 }}>
                <Text style={[styles.caption, { color: d.color.tint.wealth.ink }]}>Allocation by account</Text>
                <HeroAmount label={`Allocation by account, ${formatMoney(sum, true)}`}>
                  <Text style={[styles.hero, { color: t.content }]} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(sum, true)}</Text>
                </HeroAmount>
              </View>
              <Allocation label="Allocation by account" hidden={hidden} rows={accts.map((a) => ({ key: a.id, label: a.name, value: a.value, pct: sum > 0 ? (a.value / sum) * 100 : 0, chart: TYPE_CHART[a.type] ?? 6 }))} />
            </Card>
          ) : null}
          <EmptyState
            art={accts.length === 0}
            icon="building.columns"
            title={accts.length > 0 ? "Link an investment account" : "No holdings found"}
            body={accts.length > 0 ? "Connect a brokerage to see your holdings and how they are split." : "Connect your investment accounts to see your portfolio and how it is split."}
            action={{ title: accts.length > 0 ? "Link an investment account" : "Link an account", onPress: () => openAddAccount() }}
          />
        </>
      );
    }

    const biggest = holdings[0];
    const crumb = GROUPS.find((g) => g.value === groupBy)!.crumb;
    const drillLabel = drill ? (holdings.find((h) => h.ticker === drill)?.label ?? cleanAccountLabel(drill)) : null;
    return (
      <>
        {/* 1. Scope: the grouping, then the account filter as the row's Filters pill, and the filter applied. */}
        <View style={styles.scope}>
          <ScopePills<GroupBy>
            accessibilityLabel="Group by"
            value={groupBy}
            onChange={(g) => {
              setGroupBy(g);
              setDrill(null);
            }}
            options={GROUPS.map((g) => ({ value: g.value, label: g.label }))}
            trailing={allAccounts.length > 1 ? <FiltersButton on={active !== null} onPress={openFilters} /> : undefined}
          />
          <FilterChips chips={chips} onChange={setFilter} />
        </View>

        {/* 2. Hero: the value, its past yearly return, and the allocation with its one legend. */}
        <Card hero="wealth" style={{ gap: 14 }}>
          <View style={{ gap: 2 }}>
            <Text style={[styles.caption, { color: d.color.tint.wealth.ink }]}>Portfolio value</Text>
            <HeroAmount label={`Portfolio value, ${formatMoney(total, true)}`}>
              <Text style={[styles.hero, { color: t.content }]} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(total, true)}</Text>
            </HeroAmount>
            {exposure.data ? (
              // A past average is a neutral fact, not a result (owner color map, 2026-11-23): muted, never basil or sauce.
              <Text style={[styles.sub, { color: t.contentMuted }]}>{`${formatReturn(exposure.data.blendedReturn)} a year on average in the past`}</Text>
            ) : null}
            <Text style={[styles.sub, { color: t.contentMuted }]}>
              {[
                `${holdings.length} position${holdings.length === 1 ? "" : "s"}`,
                `${active?.size ?? allAccounts.length} account${(active?.size ?? allAccounts.length) === 1 ? "" : "s"}`,
                biggest ? `largest ${biggest.label} ${biggest.percentage.toFixed(1)}%` : null,
              ]
                .filter(Boolean)
                .join(", ")}
            </Text>
          </View>
          {drill ? (
            <View style={styles.crumb}>
              <TextLink title={crumb} label={`Back to ${crumb}`} onPress={() => setDrill(null)} />
              <SymbolView name="chevron.right" size={icon.xs} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
              <Text style={[styles.crumbName, { color: t.content }]} numberOfLines={1}>
                {drillLabel}
              </Text>
              <Text style={[styles.sub, { color: t.contentMuted }]}>{formatMoney(drillTotal, true)}</Text>
            </View>
          ) : null}
          <Allocation
            label="Allocation"
            hidden={hidden}
            selected={null}
            onPress={(key) => {
              if (key === OTHER) return;
              const next = drillFrom(groupBy, drill, key);
              setGroupBy(next.groupBy);
              setDrill(next.drill);
            }}
            rows={slices.map((s) => ({
              key: s.name,
              label: s.label,
              value: s.value,
              pct: s.pct,
              chart: s.chart,
              detail: s.children?.map((c) => `${c.name} ${fmtPct(c.pct)}`).join(", "),
            }))}
          />
        </Card>

        {/* 3. The page's actions. */}
        {actionsGroup}

        {/* 4. Holdings, sorted by the pills over the list. */}
        <View style={styles.section}>
          <SectionHeader>Holdings</SectionHeader>
          {holdings.length > 1 ? (
            <View>
              <ScopePills<HoldingSort> accessibilityLabel="Sort holdings" value={sort} onChange={setSort} options={HOLDING_SORTS} />
            </View>
          ) : null}
          <Card style={styles.listCard}>
            {sorted.map((h, i) => (
              <Fragment key={h.ticker}>
                {i > 0 ? <Divider /> : null}
                <HoldingItem h={h} hidden={hidden} onPress={() => openHolding(h)} />
              </Fragment>
            ))}
          </Card>
        </View>
      </>
    );
  })();

  return (
    <>
      <ScreenScroll title="Portfolio" refreshing={pulling} onRefresh={() => void onPull()}>
        {body}
      </ScreenScroll>
    </>
  );
}

/** "+$1,234 (12.3%)" or "−$56 (4.1%)", the amount masked with the others. */
function gainText(g: { amount: number; pct: number }): string {
  return `${g.amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(g.amount), true)} (${Math.abs(g.pct).toFixed(1)}%)`;
}

function HoldingItem({ h, hidden, onPress }: { h: HoldingRow; hidden: boolean; onPress: () => void }) {
  const t = useTheme();
  const stacked = useWindowDimensions().fontScale > 1.3;
  const value = formatMoney(h.totalValue, true);
  const meta = holdingMeta(h);
  const ret = h.historicalReturn;
  // Hidden amounts hide the gain too (its sign and size are money).
  const gain = hidden ? null : holdingGain(h);
  const figure = (
    <View style={stacked ? styles.figStacked : styles.fig}>
      <Text style={[styles.amount, { color: t.content }]}>{value}</Text>
      <Text style={[styles.rowFig, { color: t.contentMuted }]}>
        {`${h.percentage.toFixed(1)}%`}
        {/* Meaningful color (owner, 2026-11-23): the holding's own gain or loss is basil or sauce. A class's past average is a neutral fact, not a result. */}
        {gain ? (
          <Text style={{ color: gain.amount >= 0 ? t.positive : t.negative }}>{`  ${gainText(gain)}`}</Text>
        ) : ret !== null ? (
          // Labeled so a past average never reads as this holding's own gain.
          <Text>{`  Avg ${formatReturn(ret)} a year`}</Text>
        ) : null}
      </Text>
    </View>
  );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${h.label}, ${value}, ${h.percentage.toFixed(1)}% of the portfolio${gain ? `, ${gain.amount >= 0 ? "up" : "down"} ${gainText(gain)}` : ret !== null ? `, ${formatReturn(ret)} a year on average in the past` : ""}, ${meta}`}
      accessibilityHint="Shows the accounts that hold it"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.canvasSunken }]}
    >
      <TickerIcon ticker={h.ticker} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.name, { color: t.content }]} numberOfLines={stacked ? 2 : 1}>
          {h.label}
        </Text>
        <Text style={[styles.rowMeta, { color: t.contentMuted }]} numberOfLines={stacked ? 3 : 1}>
          {meta}
        </Text>
        {stacked ? figure : null}
      </View>
      {stacked ? null : figure}
      <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    scope: { gap: 8 },
    caption: { ...type.subhead, ...weight.semibold },
    hero: { ...type.amountXL },
    sub: { ...type.footnote, ...weight.medium },
    crumb: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
    crumbName: { ...type.subhead, ...weight.bold, flexShrink: 1 },
    section: { gap: 8 },
    listCard: { padding: 0 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.rowInset, paddingVertical: 12, minHeight: 64, borderRadius: radius.xs },
    name: { ...type.callout, ...weight.semibold },
    rowMeta: { ...type.footnote },
    rowFig: { ...type.footnote, ...figures },
    fig: { alignItems: "flex-end", gap: 2 },
    figStacked: { alignItems: "flex-start", gap: 2, marginTop: 2 },
    amount: { ...type.amountM },
  }),
);
