import { MenuView, type NativeActionEvent } from "@react-native-menu/menu";
import { accountTypeLabel } from "@web/lib/account-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { accountsApi, invalidateAccounts, useItems } from "@/api/accounts";
import { billingApi } from "@/api/auth";
import { debtApi } from "@/api/debt";
import { txnApi } from "@/api/transactions";
import { ValueSourceTag } from "@/components/accounts/AccountRow";
import { InfoRow } from "@/components/accounts/InfoRow";
import { InstIcon } from "@/components/accounts/InstIcon";
import { TrendCard } from "@/components/accounts/TrendCard";
import { RecentActivityCard } from "@/components/home/RecentActivityCard";
import { loanFacts } from "@/lib/account-edit";
import type { ApiDebt } from "@/lib/debt";
import { displayName, findAccount, institutionOf, isDebtType, isItemError, isManualItem, relativeTime, type Item, type ItemAccount } from "@/lib/account-list";
import { openAccountEdit, openAddAccount, takeAccountDeleted } from "@/lib/account-sheets";
import { formatMoney } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { openPath } from "@/lib/navigation";
import { updateConnection, usePlaidPhase } from "@/lib/plaid-link";
import { snapshotPoints } from "@/lib/trend";
import { EMPTY_FILTERS, filtersToSearchParams } from "@/lib/txn-filters";
import { SORTS } from "@/lib/txn-list";
import { space, themedStyles, type, useTheme, weight } from "@/theme";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { Card, CardHeader, CardSkeleton, TextLink } from "@/ui/Card";
import { committed, failed } from "@/ui/feedback";
import { Divider } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { EmptyState } from "@/ui/State";
import { errorText } from "@/api/client";

const RECENT = 5;

/**
 * One account (/accounts/:id, account-detail.tsx on the web): a notice when
 * it isn't syncing, the balance and its history, its transactions, the cards
 * its type has (loan details, the property and mortgage link, rental
 * economics, address and value), then one card about the account. Edit opens
 * the Edit account sheet. `edit`: the /accounts/:id/edit link, which opens
 * the sheet on arrival.
 */
export default function AccountDetailScreen({ id, edit }: { id: string; edit: boolean }) {
  const t = useTheme();
  const qc = useQueryClient();
  const hidden = useAmountsHidden();
  const plaid = usePlaidPhase();
  const items = useItems();
  const found = items.data ? findAccount(items.data.items, id) : null;
  const all = useMemo(() => (items.data?.items ?? []).flatMap((i) => i.accounts.map((a) => ({ a, item: i }))), [items.data]);

  const history = useQuery({ queryKey: ["account-history", id], queryFn: () => accountsApi.history(id) });
  // The Debt page's rows: the rate and minimum the payoff plan uses, so Loan details states the same figures.
  const debts = useQuery({ queryKey: ["debts"], queryFn: debtApi.list, enabled: !!found && isDebtType(found.account.type) });
  const recent = useQuery({
    queryKey: ["transactions", "account", id],
    queryFn: () => txnApi.query({ filters: { accountIds: [id] }, sort: SORTS.newest, limit: RECENT }),
  });

  // Deleted from its sheet: step back off the account.
  useFocusEffect(
    useCallback(() => {
      if (takeAccountDeleted(id)) router.back();
    }, [id]),
  );

  // The /edit link opens the sheet once the account is known.
  const opened = useRef(false);
  useEffect(() => {
    if (edit && found && !opened.current) {
      opened.current = true;
      openAccountEdit(id);
    }
  }, [edit, found, id]);

  // A property whose value estimate is still out: ask again every 10s, up to 5 minutes.
  const estimate = (found?.account.metadata?.valueEstimate ?? {}) as { status?: string; advisory?: boolean; override?: boolean };
  const pending = estimate.status === "pending";
  const [estimateState, setEstimateState] = useState<"pending" | "timeout" | "failed" | "no-home" | null>(null);
  useEffect(() => {
    if (!pending) return setEstimateState(null);
    setEstimateState("pending");
    let stop = false;
    const deadline = Date.now() + 5 * 60_000;
    const tick = async () => {
      if (stop) return;
      if (Date.now() > deadline) return setEstimateState("timeout");
      try {
        const r = await accountsApi.valueEstimate(id);
        if (stop) return;
        if (r.status === "ready") return invalidateAccounts(qc);
        if (r.status === "failed" || r.status === "none") return setEstimateState(r.reason === "no_home_value" ? "no-home" : "failed");
      } catch {
        // Transient: keep asking until the cap.
      }
      if (!stop) timer = setTimeout(tick, 10_000);
    };
    let timer = setTimeout(tick, 10_000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [pending, id, qc]);

  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([items.refetch(), history.refetch(), recent.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  if (items.isPending) {
    return (
      <ScreenScroll title="" header={<Skeleton width="55%" height={30} style={styles.titleSkeleton} />}>
        <CardSkeleton lines={7} />
        <CardSkeleton lines={4} />
      </ScreenScroll>
    );
  }
  if (!found) {
    return (
      <>
        <Stack.Screen options={{ title: "", headerTransparent: false, headerBackground: undefined, headerTitle: undefined }} />
        <EmptyState
          gutter
          icon="questionmark.folder"
          title="This account isn't available"
          body={items.isError ? errorText(items.error) : "It may have been deleted."}
          action={items.isError ? { title: "Try again", onPress: () => void items.refetch() } : { title: "Back to accounts", onPress: () => (router.canGoBack() ? router.back() : openPath("/accounts", "tab")) }}
        />
      </>
    );
  }

  const { account: a, item } = found;
  const manual = isManualItem(item);
  const institution = institutionOf(item);
  const liability = isDebtType(a.type);
  const property = a.type === "real_estate";
  const balance = parseFloat(a.balance ?? "0");
  const points = snapshotPoints(history.data?.snapshots ?? [], liability);
  const latest = points.length > 0 ? points[points.length - 1].value : liability ? Math.abs(balance) : balance;
  const syncedPrefix = a.frozen ? "Last synced" : "Synced";
  const fallback = manual ? "Manually tracked" : item.lastSyncedAt ? `${syncedPrefix} ${relativeTime(item.lastSyncedAt)}` : "Connected";
  const source = a.valueSource ?? (manual ? "manual" : "synced");
  const rows = recent.data?.transactions ?? [];
  const count = recent.data?.summary.count ?? 0;
  // A property, a loan, or an account entered by hand with no activity has nothing to list.
  const showTxns = !(recent.data && count === 0 && (manual || property || a.type === "loan" || a.type === "alternative"));
  const name = displayName(a);

  const sync = async () => {
    setSyncing(true);
    try {
      await accountsApi.syncAccount(id);
      invalidateAccounts(qc);
      committed("Account synced");
    } catch {
      failed("Couldn't sync this account. Try again.");
    } finally {
      setSyncing(false);
    }
  };

  const upgrade = async () => {
    try {
      const { url } = await billingApi.checkout();
      if (url) await WebBrowser.openBrowserAsync(url);
      invalidateAccounts(qc);
    } catch {
      failed("Couldn't start checkout. Try again.");
    }
  };

  /** Links (or unlinks) a debt to a property. These act at once, as on the web. */
  const setLink = async (debt: ItemAccount, propertyId: string | null, undoTo?: string | null) => {
    try {
      await accountsApi.update(debt.id, { propertyAccountId: propertyId });
    } catch {
      failed(propertyId ? "Couldn't link that account. Try again." : "Couldn't unlink that account. Try again.");
      return;
    }
    invalidateAccounts(qc);
    const debtName = displayName(debt);
    committed(
      propertyId ? `Linked ${debtName}` : `Unlinked ${debtName}`,
      undoTo !== undefined ? () => void setLink(debt, undoTo) : undefined,
    );
  };

  const estimateCopy =
    estimate.advisory || estimate.override || !estimateState
      ? null
      : estimateState === "pending"
        ? { tone: "info" as const, title: "Estimating value", body: "We're looking up an estimate for this address. This usually takes about a minute." }
        : estimateState === "timeout"
          ? { tone: "info" as const, title: "Taking longer than expected", body: "We're still working on it. Pull down to check for the value." }
          : estimateState === "no-home"
            ? { tone: "caution" as const, title: "Couldn't find a home value for this address", body: "It may be commercial or unlisted. Edit the account to enter your own value." }
            : { tone: "caution" as const, title: "Couldn't estimate this address", body: "Edit the account to enter a value yourself." };

  return (
    <>
      {/* The chrome contract: the page's main verb. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Edit account" onPress={() => openAccountEdit(id)}>
          Edit
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <ScreenScroll title={name} refreshing={pulling} onRefresh={() => void onPull()}>
        {a.frozen ? (
          <Banner
            tone="info"
            title="This account isn't syncing"
            body={`${institution} is past the Free plan's institution limit. You can also disconnect an institution you no longer use to free its slot.`}
            action={{ title: "Upgrade to resume", onPress: () => void upgrade() }}
          />
        ) : null}
        {isItemError(item) ? (
          <Banner
            tone="caution"
            title={`${institution} needs to reconnect`}
            body="Balances and transactions stop updating until you reconnect."
            action={{ title: plaid === "idle" ? "Reconnect" : "Opening", label: `Reconnect ${institution}`, onPress: () => void updateConnection(qc, item) }}
          />
        ) : null}
        {estimateCopy ? <Banner tone={estimateCopy.tone} title={estimateCopy.title} body={estimateCopy.body} /> : null}

        {/* Hero: the balance and its history. */}
        <TrendCard
          lead={
            // An account entered by hand has no institution to name: About says so.
            manual ? undefined : (
            <View style={styles.lead}>
              <InstIcon institution={institution} size={28} />
              <Text style={[styles.leadText, { color: t.contentSecondary }]} numberOfLines={1}>
                {`${institution}${a.mask ? ` ••${a.mask}` : ""}`}
              </Text>
            </View>
            )
          }
          title={liability ? "Balance owed" : "Account value"}
          badge={a.frozen ? null : <ValueSourceTag source={source} />}
          value={latest}
          owed={liability}
          history={points}
          historyLoading={history.isPending}
          historyError={false}
          onRetry={() => void history.refetch()}
          hidden={hidden}
          fallback={fallback}
          empty={{ title: "No history yet", body: "A value trend appears once we have a few days of history." }}
        >
          {/* Frozen accounts refuse a sync, and the notice above says why. */}
          {!manual && !a.frozen ? (
            <View style={styles.syncRow}>
              <Text style={[styles.syncText, { color: t.contentMuted }]}>{fallback}</Text>
              <TextLink title={syncing ? "Syncing" : "Sync now"} label="Sync this account" disabled={syncing} onPress={() => void sync()} />
            </View>
          ) : null}
        </TrendCard>

        {/* Its transactions. */}
        {showTxns ? (
          recent.data ? (
            <RecentActivityCard
              txns={rows}
              title="Transactions"
              allTitle={count > RECENT ? `See all ${count}` : "See all"}
              allLabel={count > RECENT ? `See all ${count} transactions` : "See all transactions"}
              onAll={() => openPath(`/transactions?${filtersToSearchParams({ ...EMPTY_FILTERS, accountIds: [id] })}`)}
            />
          ) : recent.isError ? null : (
            <CardSkeleton lines={4} />
          )
        ) : null}

        {/* What this type of account has. */}
        {liability ? <LoanCard a={a} debt={debts.data?.debts.find((x) => x.id === id) ?? null} onEdit={() => openAccountEdit(id)} /> : null}
        {/* A card is never secured by a property, so it offers the link only once one exists. */}
        {liability && (a.type === "loan" || a.propertyAccountId) ? <LinkedPropertyCard debt={a} all={all} onLink={setLink} /> : null}
        {property ? <MortgageCard home={a} all={all} hidden={hidden} onLink={setLink} /> : null}
        {property && a.subtype === "rental" ? <RentalCard a={a} /> : null}
        {property ? <AddressCard a={a} /> : null}

        <AboutCard a={a} item={item} name={name} />

        {/* The connection this account came through, removed with every account in it (Accounts keeps no overflow menu for this). */}
        {manual ? null : (
          <Button
            variant="destructive"
            title={`Disconnect ${institution}`}
            onPress={() =>
              Alert.alert(
                `Disconnect ${institution}?`,
                "All linked accounts and their transaction history will be removed. You can reconnect later, but transactions before today will need to be re-synced.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Disconnect",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await accountsApi.deleteItem(item.id);
                        invalidateAccounts(qc);
                        committed(`${institution} disconnected`);
                        router.back();
                      } catch {
                        failed(`Couldn't disconnect ${institution}. Try again.`);
                      }
                    },
                  },
                ],
              )
            }
          />
        )}
      </ScreenScroll>
    </>
  );
}

const money = (v: unknown) => (typeof v === "number" ? formatMoney(v, true) : null);

/**
 * The rate and payment. The account's own fields first, then the figures the
 * payoff plan reads (/accounts/debts, which also knows the bank's liability
 * data), so this card and the Debt page never disagree. Editing is the nav
 * bar's Edit, the one way into the sheet.
 */
function LoanCard({ a, debt, onEdit }: { a: ItemAccount; debt: ApiDebt | null; onEdit: () => void }) {
  const card = a.type === "credit";
  const facts = loanFacts(a);
  const hasRate = facts.some((f) => f.label === "Purchase APR" || f.label === "Interest rate");
  const hasPayment = facts.some((f) => f.label === "Minimum payment" || f.label === "Monthly payment");
  if (debt && !hasPayment && debt.minimumPayment > 0) facts.unshift({ label: card ? "Minimum payment" : "Monthly payment", value: "", money: debt.minimumPayment });
  if (debt && !hasRate && debt.interestRate != null) facts.unshift({ label: card ? "Purchase APR" : "Interest rate", value: `${Math.round(debt.interestRate * 100) / 100}%`, figure: true });
  return (
    <Card style={styles.listCard}>
      <View style={styles.cardHead}>
        <CardHeader title="Loan details" />
      </View>
      {facts.length === 0 ? (
        <View style={styles.cardPad}>
          <EmptyState compact title="No details yet" body="Add the rate and payment to see this debt in your payoff plan." action={{ title: "Add details", onPress: onEdit }} />
        </View>
      ) : (
        facts.map((f, i) => (
          <Fragment key={f.label}>
            {i > 0 ? <Divider /> : null}
            <InfoRow label={f.label} value={f.money != null ? formatMoney(f.money, true) : f.value} money={f.money != null || f.figure} />
          </Fragment>
        ))
      )}
    </Card>
  );
}

type Linkable = { a: ItemAccount; item: Item };

function LinkedPropertyCard({ debt, all, onLink }: { debt: ItemAccount; all: Linkable[]; onLink: (debt: ItemAccount, to: string | null, undoTo?: string | null) => void }) {
  const t = useTheme();
  const linked = all.find((x) => x.a.id === debt.propertyAccountId)?.a ?? null;
  const properties = all.filter((x) => x.a.type === "real_estate" && x.a.id !== debt.propertyAccountId);
  const actions = [
    ...properties.map((p) => ({ id: `link:${p.a.id}`, title: displayName(p.a), image: "house" })),
    { id: "add", title: "Add a property", image: "plus" },
    ...(linked ? [{ id: "group", title: "", displayInline: true, subactions: [{ id: "unlink", title: "Remove link", image: "xmark", attributes: { destructive: true } }] }] : []),
  ];
  return (
    <Card style={styles.listCard}>
      <View style={styles.cardHead}>
        <CardHeader title="Linked property" />
      </View>
      {linked ? (
        <InfoRow
          label={displayName(linked)}
          value={formatMoney(parseFloat(linked.balance ?? "0"), true)}
          money
          onPress={() => openPath(`/accounts/${linked.id}`)}
          accessibilityLabel={`Secured by ${displayName(linked)}, ${formatMoney(parseFloat(linked.balance ?? "0"), true)}`}
        />
      ) : (
        <Text style={[styles.cardNote, { color: t.contentMuted }]}>Tie this loan to the property it's secured by. Its page will show your equity.</Text>
      )}
      <View style={styles.cardFoot}>
        <MenuView
          title={linked ? "Change the property" : "Link a property"}
          actions={actions}
          onPressAction={({ nativeEvent: { event } }: NativeActionEvent) => {
            if (event === "add") openAddAccount({ add: "real_estate", link: debt.id });
            else if (event === "unlink") onLink(debt, null, debt.propertyAccountId ?? null);
            else if (event.startsWith("link:")) onLink(debt, event.slice(5), debt.propertyAccountId ?? null);
          }}
        >
          <View accessible accessibilityRole="button" accessibilityLabel={linked ? "Change the linked property" : "Link a property"} pointerEvents="none">
            <TextLink title={linked ? "Change the property" : "Link a property"} onPress={() => {}} />
          </View>
        </MenuView>
      </View>
    </Card>
  );
}

function MortgageCard({ home, all, hidden, onLink }: { home: ItemAccount; all: Linkable[]; hidden: boolean; onLink: (debt: ItemAccount, to: string | null, undoTo?: string | null) => void }) {
  const t = useTheme();
  const debts = all.filter((x) => x.a.propertyAccountId === home.id).map((x) => x.a);
  const owed = debts.reduce((s, d) => s + Math.abs(parseFloat(d.balance ?? "0")), 0);
  const equity = parseFloat(home.balance ?? "0") - owed;
  // A property is secured by a loan, never a card. Mortgages first.
  const candidates = all
    .filter((x) => x.a.type === "loan" && !x.a.propertyAccountId)
    .sort((x, y) => Number(y.a.subtype === "mortgage") - Number(x.a.subtype === "mortgage"));
  const actions = [
    ...candidates.map((c) => ({ id: `link:${c.a.id}`, title: displayName(c.a), subtitle: accountTypeLabel(c.a.type, c.a.subtype) === displayName(c.a) ? undefined : accountTypeLabel(c.a.type, c.a.subtype), image: "building.columns" })),
    { id: "add", title: "Add a mortgage", image: "plus" },
  ];
  return (
    <Card style={styles.listCard}>
      <View style={styles.cardHead}>
        <CardHeader title="Mortgage" />
      </View>
      {debts.length > 0 ? (
        <>
          {debts.map((d, i) => (
            <Fragment key={d.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.debtRow}>
                <View style={{ flex: 1 }}>
                  <InfoRow
                    label={displayName(d)}
                    value={formatMoney(Math.abs(parseFloat(d.balance ?? "0")), true)}
                    money
                    accessibilityLabel={`${displayName(d)}, ${formatMoney(Math.abs(parseFloat(d.balance ?? "0")), true)} owed`}
                    onPress={() => openPath(`/accounts/${d.id}`)}
                  />
                </View>
                <TextLink title="Unlink" label={`Unlink ${displayName(d)}`} onPress={() => onLink(d, null, home.id)} />
              </View>
            </Fragment>
          ))}
          <Divider />
          <InfoRow label="Equity" value={formatMoney(equity, true)} money color={equity < 0 && !hidden ? t.negative : undefined} />
        </>
      ) : (
        <>
          <Text style={[styles.cardNote, { color: t.contentMuted }]}>Tie the loan that's secured by this property. We'll show your equity here.</Text>
          <View style={styles.cardFoot}>
            <MenuView
              title="Link a loan"
              actions={actions}
              onPressAction={({ nativeEvent: { event } }: NativeActionEvent) => {
                if (event === "add") openAddAccount({ add: "loan:mortgage", link: home.id });
                else if (event.startsWith("link:")) {
                  const debt = candidates.find((c) => c.a.id === event.slice(5))?.a;
                  if (debt) onLink(debt, home.id, null);
                }
              }}
            >
              <View accessible accessibilityRole="button" accessibilityLabel="Link a loan" pointerEvents="none">
                <TextLink title="Link a loan" onPress={() => {}} />
              </View>
            </MenuView>
          </View>
        </>
      )}
    </Card>
  );
}

function RentalCard({ a }: { a: ItemAccount }) {
  const meta = (a.metadata ?? {}) as Record<string, unknown>;
  const rows: Array<[string, unknown]> = [
    ["Monthly rent", meta.monthlyRent],
    ["Annual insurance", meta.annualInsurance],
    ["Annual maintenance", meta.annualMaintenance],
  ];
  return (
    <Card style={styles.listCard}>
      <View style={styles.cardHead}>
        <CardHeader title="Rental economics" />
      </View>
      {rows.map(([label, v], i) => (
        <Fragment key={label}>
          {i > 0 ? <Divider /> : null}
          <InfoRow label={label} value={money(v) ?? "Not set"} money={money(v) !== null} muted={money(v) === null} />
        </Fragment>
      ))}
    </Card>
  );
}

function AddressCard({ a }: { a: ItemAccount }) {
  const meta = (a.metadata ?? {}) as Record<string, unknown>;
  const own = (meta.valueEstimate as { override?: boolean } | undefined)?.override === true;
  const address = typeof meta.address === "string" && meta.address ? meta.address : null;
  return (
    <Card style={styles.listCard}>
      <View style={styles.cardHead}>
        <CardHeader title="Address and value" />
      </View>
      <InfoRow label="Address" value={address ?? "Not set"} muted={!address} />
      <Divider />
      <InfoRow label="Value" value={own ? "Your own value" : "Market estimate"} />
    </Card>
  );
}

function AboutCard({ a, item, name }: { a: ItemAccount; item: Item; name: string }) {
  const manual = isManualItem(item);
  const rows: Array<[string, string]> = [
    ["Name", name],
    ["Institution", manual ? "Entered by you" : institutionOf(item)],
    ...(a.mask ? ([["Account number", `••${a.mask}`]] as Array<[string, string]>) : []),
    ["Type", accountTypeLabel(a.type, a.subtype)],
    ["Net worth", a.excludeFromNetWorth ? "Not counted" : "Counted"],
    ["Transactions", a.excludeTransactions ? "Hidden from spending" : "Included"],
    ["Balance sign", a.invertBalance ? "Inverted" : "As reported"],
  ];
  return (
    <Card style={styles.listCard}>
      <View style={styles.cardHead}>
        <CardHeader title="About this account" />
      </View>
      {rows.map(([label, value], i) => (
        <Fragment key={label}>
          {i > 0 ? <Divider /> : null}
          <InfoRow label={label} value={value} />
        </Fragment>
      ))}
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    titleSkeleton: { marginHorizontal: space.card, marginVertical: 4 },
    lead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    leadText: { ...type.subhead, ...weight.semibold, flexShrink: 1 },
    syncRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 },
    syncText: { ...type.footnote, ...weight.medium, flexShrink: 1 },
    listCard: { padding: 0, paddingBottom: 6 },
    cardHead: { paddingHorizontal: space.card, paddingTop: space.card, paddingBottom: 6 },
    cardPad: { paddingHorizontal: space.card },
    cardNote: { ...type.subhead, paddingHorizontal: space.card, paddingVertical: 4 },
    cardFoot: { paddingHorizontal: space.card, paddingTop: 10, paddingBottom: 14, alignItems: "flex-start" },
    debtRow: { flexDirection: "row", alignItems: "center", paddingRight: space.card },
  }),
);
