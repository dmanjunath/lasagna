import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { accountsApi, invalidateAccounts, useItems } from "@/api/accounts";
import { useTheme as useDesign } from "@/design";
import { homeApi } from "@/api/home";
import { txnApi } from "@/api/transactions";
import { AccountRow } from "@/components/accounts/AccountRow";
import { InstIcon } from "@/components/accounts/InstIcon";
import { TrendCard } from "@/components/accounts/TrendCard";
import { RecentActivityCard } from "@/components/home/RecentActivityCard";
import {
  accountCountText,
  groupsByInstitution,
  groupsByType,
  institutionOf,
  isItemError,
  lastSyncedOf,
  relativeTime,
  type Item,
} from "@/lib/account-list";
import { formatMoney } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { openAddAccount } from "@/lib/account-sheets";
import { openPath } from "@/lib/navigation";
import { connectBank, updateConnection, usePlaidPhase } from "@/lib/plaid-link";
import { SORTS } from "@/lib/txn-list";
import { parseQuery } from "@/lib/txn-filters";
import { icon, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { Card, CardSkeleton } from "@/ui/Card";
import { committed, failed } from "@/ui/feedback";
import { ScopePills } from "@/components/transactions/ScopeRow";
import { Divider, SectionHeader } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { EmptyState, ErrorState } from "@/ui/State";

type GroupBy = "category" | "institution";
// The web's key, so the choice reads the same way it does there.
const GROUP_BY_KEY = "lasagna-money-group-by";
const RECENT = 5;

/**
 * What you have and owe (/accounts, simple-money.tsx on the web). Per the page
 * chrome contract: Group by (the list's scope), the net worth hero, a notice
 * per connection that needs to reconnect, the groups, then recent activity.
 * `+` adds an account. `query` carries the links other screens use:
 * ?autoLink=true starts Plaid, ?reconnect=<itemId> its update mode, and
 * ?add=<type>[:<subtype>]&link=<id> opens the add form on that type.
 */
export default function AccountsScreen({ query, root }: { query?: string; root: boolean }) {
  const t = useTheme();
  const d = useDesign();
  const qc = useQueryClient();
  const hidden = useAmountsHidden();
  const plaid = usePlaidPhase();

  const items = useItems();
  const facts = useQuery({ queryKey: ["facts"], queryFn: homeApi.facts });
  const history = useQuery({ queryKey: ["net-worth-history"], queryFn: homeApi.netWorthHistory });
  const recent = useQuery({
    queryKey: ["transactions", "accounts-recent"],
    queryFn: () => txnApi.query({ filters: {}, sort: SORTS.newest, limit: RECENT }),
  });

  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  useEffect(() => {
    AsyncStorage.getItem(GROUP_BY_KEY)
      .then((v) => v === "institution" && setGroupBy("institution"))
      .catch(() => {});
  }, []);
  const chooseGroupBy = (g: GroupBy) => {
    setGroupBy(g);
    AsyncStorage.setItem(GROUP_BY_KEY, g).catch(() => {});
  };

  const list = items.data?.items;
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [syncingItem, setSyncingItem] = useState<string | null>(null);

  // The links other screens send here, once each, after the connections load.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !query) return;
    const p = parseQuery(query);
    if (p.autoLink === "true") {
      handled.current = true;
      void connectBank(qc);
    } else if (p.add) {
      handled.current = true;
      openAddAccount({ add: p.add, link: p.link });
    } else if (p.reconnect && list) {
      handled.current = true;
      const item = list.find((i) => i.id === p.reconnect);
      if (item) void updateConnection(qc, item);
    }
  }, [query, list, qc]);

  const groups = useMemo(() => (list ? groupsByType(list) : []), [list]);
  const institutions = useMemo(() => (list ? groupsByInstitution(list) : []), [list]);
  const hasAccounts = !!list && list.some((i) => i.accounts.length > 0);
  const errorItems = (list ?? []).filter((i) => isItemError(i) && !dismissed.has(i.id));
  const lastSynced = list ? lastSyncedOf(list) : null;
  const meta = facts.data
    ? `${accountCountText(facts.data.accountsConnected, facts.data.accountsCounted)}${lastSynced ? `, synced ${relativeTime(lastSynced)}` : ""}`
    : undefined;

  const open = useCallback((id: string) => openPath(`/accounts/${id}`), []);

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([items.refetch(), facts.refetch(), history.refetch(), recent.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  const syncOne = async (item: Item) => {
    setSyncingItem(item.id);
    try {
      await accountsApi.syncItem(item.id);
      invalidateAccounts(qc);
      committed(`${institutionOf(item)} synced`);
    } catch {
      failed(`Couldn't sync ${institutionOf(item)}. Try again.`);
    } finally {
      setSyncingItem(null);
    }
  };

  return (
    <>
      {/* The chrome contract: the page's create verb. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="Add account" disabled={plaid !== "idle"} onPress={() => openAddAccount()} />
      </Stack.Toolbar>

      <ScreenScroll title="Accounts" root={root} refreshing={pulling} onRefresh={() => void onPull()}>
        {items.isPending ? (
          <>
            <CardSkeleton lines={6} />
            <CardSkeleton lines={4} />
          </>
        ) : items.isError && !list ? (
          <ErrorState title="Couldn't load your accounts" body="Check your connection and try again." onRetry={() => void items.refetch()} />
        ) : !hasAccounts ? (
          <EmptyState
            icon="wallet.bifold"
            title="No accounts connected"
            body="Link a bank, card or brokerage to see your accounts here."
            action={{ title: "Connect a bank", onPress: () => void connectBank(qc), loading: plaid !== "idle" }}
          />
        ) : (
          <>
            {/* Link takes a few seconds to appear after the sheet closes: say it is on its way. */}
            {plaid === "opening" ? <Banner tone="info" title="Opening your bank connection" /> : null}
            {plaid === "syncing" ? <Banner tone="info" title="Bringing in your accounts" body="This takes a few seconds." /> : null}
            {errorItems.map((item) => (
              <Banner
                key={item.id}
                tone="caution"
                title={`${institutionOf(item)} needs to reconnect`}
                body="Balances and transactions stop updating until you reconnect."
                action={{ title: "Reconnect", label: `Reconnect ${institutionOf(item)}`, onPress: () => void updateConnection(qc, item) }}
                onDismiss={() => setDismissed((s) => new Set(s).add(item.id))}
              />
            ))}

            {/* 1. Hero: net worth and its history. */}
            {facts.isError && !facts.data ? (
              <Card>
                <ErrorState compact title="Couldn't load your net worth" onRetry={() => void facts.refetch()} />
              </Card>
            ) : !facts.data ? (
              <CardSkeleton lines={6} />
            ) : (
              <TrendCard
                title="Net worth"
                value={facts.data.netWorth.netWorth}
                history={history.data?.history ?? []}
                historyLoading={history.isPending}
                historyError={history.isError}
                onRetry={() => void history.refetch()}
                hidden={hidden}
                since
                empty={{ title: "Building your trend", body: "Your net worth chart appears once we have a few days of history." }}
              >
                {meta ? <Text style={[styles.meta, { color: t.contentMuted }]}>{meta}</Text> : null}
              </TrendCard>
            )}

            {/* 2. How the list below is grouped, right above it (owner, 2026-11-24): it scopes the list, not the net worth. */}
            <ScopePills<GroupBy>
              accessibilityLabel="Group accounts by"
              value={groupBy}
              onChange={chooseGroupBy}
              options={[
                { value: "category", label: "Type" },
                { value: "institution", label: "Institution" },
              ]}
            />

            {/* 3. The groups. */}
            {groupBy === "category"
              ? groups.map((g) => (
                  <View key={g.key} style={styles.section}>
                    <SectionHeader trailing={{ text: formatMoney(g.total, true), color: g.owed && !hidden ? t.negative : t.content }}>
                      {`${g.title}, ${g.count} ${g.unit}${g.count === 1 ? "" : "s"}`}
                    </SectionHeader>
                    <Card style={styles.listCard}>
                      {g.rows.map((r, i) => (
                        <Fragment key={r.account.id}>
                          {i > 0 ? <Divider inset={space.rowInset + 52} /> : null}
                          <AccountRow row={r} onPress={open} hidden={hidden} />
                        </Fragment>
                      ))}
                    </Card>
                  </View>
                ))
              : institutions.map((g) => {
                  const total = formatMoney(Math.abs(g.total), true);
                  return (
                    <View key={g.item.id} style={styles.section}>
                      {/* A broken connection needs the user: the yellow attention fill (meaningful color, owner 2026-11-23). */}
                      <Card style={[styles.listCard, g.error && { backgroundColor: d.color.highlight }]}>
                        <View style={styles.instHead}>
                          <InstIcon institution={g.institution} manual={g.manual} />
                          <View style={{ flex: 1, gap: 1 }}>
                            <Text style={[styles.instName, { color: t.content }]} numberOfLines={1} accessibilityRole="header">
                              {g.institution}
                            </Text>
                            <Text style={[styles.instMeta, { color: g.error ? t.caution : t.contentMuted }]} numberOfLines={1}>
                              {`${g.status}, ${g.rows.length} account${g.rows.length === 1 ? "" : "s"}`}
                            </Text>
                          </View>
                          <Text style={[styles.instTotal, { color: g.total < 0 && !hidden ? t.negative : t.content }]}>
                            {g.total < 0 && !hidden ? `−${total}` : total}
                          </Text>
                          {/* A manual "institution" has no connection to manage: each account is edited on its own page.
                              No overflow menu: Sync is its own button, Reconnect replaces it when the link is broken,
                              more accounts come through + and Disconnect is on each account's page. */}
                          {g.manual ? null : syncingItem === g.item.id ? (
                            <ActivityIndicator style={styles.menuBtn} accessibilityLabel={`Syncing ${g.institution}`} />
                          ) : g.error ? (
                            <Button size="compact" variant="secondary" title="Reconnect" onPress={() => void updateConnection(qc, g.item)} />
                          ) : (
                            <Pressable
                              onPress={() => void syncOne(g.item)}
                              disabled={syncingItem !== null}
                              accessibilityRole="button"
                              accessibilityLabel={`Sync ${g.institution}`}
                              style={({ pressed }) => [styles.menuBtn, { opacity: syncingItem !== null ? 0.4 : pressed ? 0.5 : 1 }]}
                            >
                              <SymbolView name="arrow.triangle.2.circlepath" size={icon.md} tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" />
                            </Pressable>
                          )}
                        </View>
                        {g.rows.map((r) => (
                          <Fragment key={r.account.id}>
                            <Divider />
                            <AccountRow row={r} onPress={open} hidden={hidden} hideIcon />
                          </Fragment>
                        ))}
                      </Card>
                    </View>
                  );
                })}

            {/* 4. Recent activity, five rows, the full list one tap away. */}
            {recent.data && recent.data.transactions.length > 0 ? (
              <RecentActivityCard
                txns={recent.data.transactions}
                allTitle={recent.data.summary.count > RECENT ? `See all ${recent.data.summary.count}` : "See all"}
                allLabel={recent.data.summary.count > RECENT ? `See all ${recent.data.summary.count} transactions` : "See all transactions"}
                // See all means every transaction, whatever the list kept from last time.
                onAll={() => openPath("/transactions?fresh=1")}
              />
            ) : recent.isPending ? (
              <CardSkeleton lines={4} />
            ) : null}
          </>
        )}
      </ScreenScroll>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    meta: { ...type.footnote, ...weight.medium, marginTop: 10 },
    section: { gap: 6 },
    listCard: { padding: 0 },
    instHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: space.rowInset, paddingRight: space.rowInset, paddingVertical: 12 },
    instName: { ...type.headline },
    instMeta: { ...type.footnote, ...weight.medium },
    instTotal: { ...type.amountM },
    menuBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -space.sm },
  }),
);
