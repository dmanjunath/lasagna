import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Wallet, RefreshCw, Plus,
  Lock, ChevronDown, ChevronRight, Settings2, Pencil,
  DollarSign, Banknote,
} from 'lucide-react';
import { api } from '../lib/api';
import { useCategoryDisplay } from '../lib/taxonomy';
import { cn, stripAccountMask, exactSyncTime } from '../lib/utils';
import { Button, SegmentedControl, EmptyState, PageMeta, PageMetaItem, PageMetaSkeleton, Skeleton, useToast, Tooltip } from '../components/uikit';
import { ValueSourceBadge } from '../components/common/ValueSourceBadge';
import { CategoryPicker } from '../components/common/CategoryPicker';
import { TxnRow } from '../components/transactions/TransactionList';
import { NetWorthTrendCard } from '../components/common/NetWorthTrendCard';
import { type TrendPoint } from '../components/ds';
import { faviconUrl, institutionDomainFor } from '../components/ds/institutions';

interface Item {
  id: string;
  institutionId: string | null;
  institutionName: string | null;
  status: string;
  lastSyncedAt: string | null;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    subtype: string | null;
    mask: string | null;
    balance: string | null;
    currency: string;
    excludeFromNetWorth?: boolean;
    excludeTransactions?: boolean;
    invertBalance?: boolean;
    frozen?: boolean;
    propertyAccountId?: string | null;
    valueSource?: 'synced' | 'estimated' | 'manual';
    metadata?: Record<string, unknown> | null;
  }>;
}
interface Transaction {
  id: string; date: string; name: string; merchantName: string | null;
  amount: string; categoryId: string; excludedAt: string | null;
}

type GroupBy = 'category' | 'institution';
const GROUP_BY_KEY = 'lasagna-money-group-by';

const fmtUsd = (n: number, frac = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: frac, minimumFractionDigits: frac });

// Balance with the user's invert override applied — used everywhere a balance
// feeds a total or a row value so the UI matches the server's net-worth math.
const effectiveBalance = (a: { balance: string | null; invertBalance?: boolean }) =>
  (a.invertBalance ? -1 : 1) * parseFloat(a.balance ?? '0');

export function SimpleMoney() {
  const displayOf = useCategoryDisplay();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<TrendPoint[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  // How the account lists are grouped: by asset category (default) or by the
  // institution they're connected through. Persisted so the choice survives.
  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    if (typeof window === 'undefined') return 'category';
    return window.localStorage.getItem(GROUP_BY_KEY) === 'institution' ? 'institution' : 'category';
  });
  const setGroupByPersisted = (g: GroupBy) => {
    setGroupBy(g);
    try { window.localStorage.setItem(GROUP_BY_KEY, g); } catch { /* ignore */ }
  };

  useEffect(() => {
    Promise.all([
      api.getItems().catch(() => ({ items: [] as Item[] })),
      api.getNetWorthHistory().catch(() => ({ history: [] as TrendPoint[] })),
      api.getTransactions({ limit: 8 }).catch(() => ({ transactions: [] as Transaction[] })),
    ]).then(([itemsData, historyData, txData]) => {
      setItems(itemsData.items);
      setHistory(historyData.history || []);
      setTransactions(txData.transactions);
    }).finally(() => setLoading(false));
  }, []);

  const [syncingAll, setSyncingAll] = useState(false);

  async function handleSyncAll() {
    setSyncingAll(true);
    setSyncError(null);
    try {
      const results = await Promise.all(
        items.map((item) => api.syncItem(item.id).then(() => true, () => false)),
      );
      if (results.includes(false)) setSyncError('Some accounts failed to sync. Try again.');
      const fresh = await api.getItems();
      setItems(fresh.items);
    } catch {
      setSyncError('Some accounts failed to sync. Try again.');
    }
    setSyncingAll(false);
  }

  // Refetch items — used when a background value estimate resolves so the new
  // property value replaces the "Estimating…" pill.
  const reloadItems = () => {
    api.getItems().then((d) => setItems(d.items)).catch(() => {});
  };

  // Page-local optimistic category edit (same shape as the transactions and
  // spending surfaces): capture prev → optimistic patch → PATCH → success toast
  // with undo, revert on failure. `newCatId` is a category id (uuid).
  async function handleCategoryEdit(tx: Transaction, newCatId: string) {
    if (newCatId === tx.categoryId) return;
    const prevCatId = tx.categoryId;
    setEditError(null);
    setTransactions((prev) => prev.map((t) => (t.id === tx.id ? { ...t, categoryId: newCatId } : t)));
    try {
      await api.updateTransactionCategory(tx.id, newCatId);
      const undo = async () => {
        setTransactions((prev) => prev.map((t) => (t.id === tx.id ? { ...t, categoryId: prevCatId } : t)));
        try {
          await api.updateTransactionCategory(tx.id, prevCatId);
          toast({ tone: 'info', title: 'Change undone' });
        } catch {
          setTransactions((prev) => prev.map((t) => (t.id === tx.id ? { ...t, categoryId: newCatId } : t)));
          setEditError("Couldn't undo. Try again.");
        }
      };
      toast({
        tone: 'positive',
        title: `Moved to ${displayOf({ categoryId: newCatId }).label}`,
        duration: 6000,
        description: prevCatId ? (
          <button
            type="button"
            onClick={undo}
            className="ui-focus mt-0.5 rounded-ui-sm font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
          >
            Undo
          </button>
        ) : undefined,
      });
    } catch (err) {
      console.error(err);
      setTransactions((prev) => prev.map((t) => (t.id === tx.id ? { ...t, categoryId: prevCatId } : t)));
      setEditError("Couldn't update the category, so the change was undone. Try again.");
    }
  }

  // ── Totals from items ──
  // Account types: depository, investment, real_estate, alternative, credit, loan.
  // Real estate + alternative (cars, crypto, watches, etc.) count as assets too —
  // dropping them silently understates net worth and the composition ribbon.
  const allAccounts = items.flatMap((i) => i.accounts);
  const cashAccounts = allAccounts.filter((a) => a.type === 'depository');
  const investAccounts = allAccounts.filter((a) => a.type === 'investment');
  const realEstateAccounts = allAccounts.filter((a) => a.type === 'real_estate');
  const altAccounts = allAccounts.filter((a) => a.type === 'alternative');
  const debtAccounts = allAccounts.filter((a) => a.type === 'credit' || a.type === 'loan');
  // Subtotals skip accounts the user excluded from net worth and respect the
  // invert override, so they reconcile with the net-worth figure and the chart.
  const sumBalances = (arr: typeof allAccounts) =>
    arr.filter((a) => !a.excludeFromNetWorth).reduce((s, a) => s + effectiveBalance(a), 0);
  const cashTotal = sumBalances(cashAccounts);
  const investTotal = sumBalances(investAccounts);
  const realEstateTotal = sumBalances(realEstateAccounts);
  const altTotal = sumBalances(altAccounts);
  const assetsTotal = realEstateTotal + altTotal;
  const debtTotal = debtAccounts
    .filter((a) => !a.excludeFromNetWorth)
    .reduce((s, a) => s + Math.abs(effectiveBalance(a)), 0);
  const netWorth = cashTotal + investTotal + assetsTotal - debtTotal;
  // Gross assets = the asset base shared with the Home composition ribbon.
  // Section shares are expressed against this (not net worth) so the same
  // account reads at the same % on both pages and the slices sum to 100%.
  const grossAssets = cashTotal + investTotal + assetsTotal;

  const totalAccountCount = cashAccounts.length + investAccounts.length + realEstateAccounts.length + altAccounts.length + debtAccounts.length;
  const lastSynced = useMemo(() => {
    const stamps = items.map((i) => i.lastSyncedAt).filter(Boolean) as string[];
    if (stamps.length === 0) return null;
    return stamps.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
  }, [items]);

  const hasMoney = !loading && totalAccountCount > 0;

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ── Page header ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em]">
            Money
          </h1>
          <PageMeta>
            {loading ? (
              <PageMetaSkeleton widths={['w-20', 'w-[109px]']} />
            ) : (
              hasMoney && (
                <>
                  <PageMetaItem className="ui-tnum">
                    {totalAccountCount} account{totalAccountCount === 1 ? '' : 's'}
                  </PageMetaItem>
                  {lastSynced && (
                    exactSyncTime(lastSynced) ? (
                      <Tooltip content={exactSyncTime(lastSynced)!} side="bottom">
                        {/* The dotted underline is the only thing separating
                            this run from the inert one beside it, so without it
                            the tooltip is undiscoverable. It is gated behind a
                            hover-capable pointer: the tooltip cannot open on
                            touch, and advertising an affordance a phone cannot
                            deliver is worse than showing none. */}
                        <PageMetaItem
                          tabIndex={0}
                          aria-label={`Last synced ${exactSyncTime(lastSynced)}`}
                          className="ui-tnum ui-focus rounded-ui-sm -mx-0.5 px-0.5 [@media(hover:hover)]:cursor-help [@media(hover:hover)]:underline [@media(hover:hover)]:decoration-dotted [@media(hover:hover)]:underline-offset-[3px]"
                        >
                          Synced {relativeTime(lastSynced)}
                        </PageMetaItem>
                      </Tooltip>
                    ) : (
                      <PageMetaItem className="ui-tnum">Synced {relativeTime(lastSynced)}</PageMetaItem>
                    )
                  )}
                </>
              )
            )}
          </PageMeta>
        </div>
        {hasMoney && (
          <div className="flex w-full gap-2.5 sm:w-auto">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 sm:flex-none"
              onClick={handleSyncAll}
              disabled={syncingAll}
              leadingIcon={<RefreshCw size={15} className={syncingAll ? 'animate-spin' : ''} />}
            >
              {syncingAll ? 'Syncing…' : 'Sync all'}
            </Button>
            <Link href="/accounts" className="flex-1 sm:flex-none">
              <Button variant="primary" size="sm" className="w-full" leadingIcon={<Plus size={15} />}>
                Add account
              </Button>
            </Link>
          </div>
        )}
      </header>

      {/* ── Sync error banner (dismissible) ── */}
      {syncError && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-ui-md border border-negative/30 bg-negative-soft px-4 py-3">
          <span className="text-[14px] font-medium text-negative">{syncError}</span>
          <button
            onClick={() => setSyncError(null)}
            className="ui-focus shrink-0 rounded-ui-sm px-2.5 py-1 text-[13px] font-semibold text-negative hover:bg-negative/10"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Loading skeleton — reserves the chart card + two group footprints ── */}
      {loading && (
        <>
          <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-12 w-60" />
                <Skeleton className="mt-3 h-7 w-40 rounded-full" />
              </div>
              <Skeleton className="h-9 w-48 rounded-ui-md" />
            </div>
            <Skeleton className="mt-6 h-[200px] w-full rounded-ui-md" />
          </div>
          {[0, 1].map((g) => (
            <div key={g} className="mt-5 rounded-ui-xl border border-line bg-panel shadow-ui-sm">
              <div className="flex items-center gap-3 px-5 py-4">
                <Skeleton className="h-[11px] w-[11px] rounded-[3.5px]" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="ml-auto h-4 w-24" />
              </div>
              <div className="border-t border-line">
                {[0, 1].map((r) => (
                  <div key={r} className="flex items-center gap-3.5 border-t border-line px-5 py-3.5 first:border-t-0">
                    <Skeleton className="h-10 w-10 rounded-ui-md" />
                    <div className="flex-1">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className="mt-2 h-3 w-44" />
                    </div>
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── Net-worth + chart card ── */}
      {hasMoney && (
        <NetWorthTrendCard history={history} netWorth={netWorth} className="mt-6" />
      )}

      {/* ── Empty state ── */}
      {!loading && allAccounts.length === 0 && (
        <div className="mt-7">
          <EmptyState
            icon={<Wallet size={24} />}
            title="No accounts connected"
            description="Link a bank or brokerage to see your money here."
            action={
              <Link href="/accounts">
                <Button variant="primary">Connect an account</Button>
              </Link>
            }
          />
        </div>
      )}

      {/* ── Grouping toggle — group the account lists by asset category or by
             the institution they're connected through. ── */}
      {hasMoney && (
        <div className="mt-7 flex items-center justify-between gap-3 px-1">
          <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em]">Accounts</h2>
          <SegmentedControl
            aria-label="Group accounts by"
            value={groupBy}
            onChange={(g) => setGroupByPersisted(g as GroupBy)}
            options={[
              { value: 'category', label: 'Type' },
              { value: 'institution', label: 'Institution' },
            ]}
          />
        </div>
      )}

      {/* ── Account sections, grouped by asset category ── */}
      {groupBy === 'category' && (
        <>
          {cashAccounts.length > 0 && (
            <GroupSection
              title="Cash" viz={1} count={cashAccounts.length}
              caption={grossAssets > 0 ? `${Math.round((cashTotal / grossAssets) * 100)}% of assets, ready to deploy` : 'ready to deploy'}
              total={cashTotal} items={items} filterType="depository"
            />
          )}
          {investAccounts.length > 0 && (
            <GroupSection
              title="Investments" viz={2} count={investAccounts.length}
              caption={grossAssets > 0 ? `${Math.round((investTotal / grossAssets) * 100)}% of assets, long-term growth` : 'long-term growth'}
              total={investTotal} items={items} filterType="investment"
            />
          )}
          {realEstateAccounts.length > 0 && (
            <GroupSection
              title="Property" viz={5} count={realEstateAccounts.length}
              caption={grossAssets > 0 ? `${Math.round((realEstateTotal / grossAssets) * 100)}% of assets, real estate` : 'real estate'}
              total={realEstateTotal} items={items} filterType="real_estate"
              onEstimateResolved={reloadItems}
            />
          )}
          {altAccounts.length > 0 && (
            <GroupSection
              title="Other assets" viz={5} count={altAccounts.length} unit="item"
              caption={grossAssets > 0 ? `${Math.round((altTotal / grossAssets) * 100)}% of assets, alternative holdings` : 'alternative holdings'}
              total={altTotal} items={items} filterType="alternative"
            />
          )}
          {debtAccounts.length > 0 && (
            <GroupSection
              title="Debt" viz={4} count={debtAccounts.length}
              caption={grossAssets > 0 ? `${Math.round((debtTotal / grossAssets) * 100)}% debt-to-assets` : 'reduces net worth'}
              total={debtTotal} totalNeg items={items} filterType={['credit', 'loan']}
            />
          )}
        </>
      )}

      {/* ── Account sections, grouped by institution ── */}
      {groupBy === 'institution' && (
        <div className="mt-5 space-y-[18px]">
          {items.map((item) => (
            <InstitutionSection key={item.id} item={item} items={items} onEstimateResolved={reloadItems} />
          ))}
        </div>
      )}

      {/* ── Recent activity ── */}
      {transactions.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-3 whitespace-nowrap px-1 pb-3">
            <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em]">Recent activity</h2>
            <Link href="/spending" className="ui-focus touch-target-inline rounded-ui-sm text-[13px] font-bold text-content-muted hover:text-brand transition-colors">
              View spending →
            </Link>
          </div>
          {editError && (
            <p role="alert" className="mb-3 px-1 text-[12.5px] font-medium text-negative">{editError}</p>
          )}
          <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm">
            {transactions.map((t) => {
              const amount = parseFloat(t.amount);
              const isIncome = amount < 0;
              const display = displayOf({ categoryId: t.categoryId });
              return (
                <TxnRow
                  key={t.id}
                  merchant={t.merchantName || t.name}
                  icon={display.icon ?? (isIncome ? <DollarSign size={15} /> : <Banknote size={15} />)}
                  isIncome={isIncome}
                  categoryNode={
                    <CategoryPicker
                      variant="inline"
                      value={t.categoryId ?? ''}
                      currentLabel={display.label}
                      onChange={(newCatId) => handleCategoryEdit(t, newCatId)}
                    />
                  }
                  date={t.date}
                  amount={amount}
                  excluded={t.excludedAt != null}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Account group section — collapsible header (dot + title + caption + total)
// over a card of account rows.
// ─────────────────────────────────────────────────────────────────────────

function GroupSection({
  title, viz, count, caption, unit = 'account', total, totalNeg, items, filterType, onEstimateResolved,
}: {
  title: string;
  viz: number;
  count: number;
  caption: string;
  unit?: string;
  total: number;
  totalNeg?: boolean;
  items: Item[];
  filterType: string | string[];
  onEstimateResolved?: () => void;
}) {
  const [, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const types = Array.isArray(filterType) ? filterType : [filterType];
  const accounts = items.flatMap((item) =>
    item.accounts.filter((a) => types.includes(a.type)).map((a) => ({ ...a, item })),
  );
  // Resolve the property↔mortgage link so rows can show "linked to X", as /accounts does.
  const allAccts = items.flatMap((i) => i.accounts);
  const linkNameOf = (a: { name: string; mask: string | null }) =>
    titleCase(stripAccountMask(a.name, a.mask));
  const nameById = new Map(allAccts.map((a) => [a.id, linkNameOf(a)] as const));
  const mortgageByProperty = new Map<string, string>();
  for (const a of allAccts) {
    if (a.propertyAccountId) mortgageByProperty.set(a.propertyAccountId, linkNameOf(a));
  }
  const errorItems = items.filter(
    (item) =>
      (item.status === 'error' || item.status === 'item_login_required') &&
      item.accounts.some((a) => types.includes(a.type)),
  );

  return (
    <div className="mt-5">
      {errorItems.map((item) => (
        <div key={item.id} className="mb-2.5 flex items-center justify-between gap-3 rounded-ui-md border border-caution/30 bg-caution-soft px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold text-caution">{item.institutionName || 'Institution'} needs attention</div>
            <p className="mt-0.5 text-[12.5px] text-content-muted">
              {item.status === 'item_login_required' ? 'Login expired. Reconnect to resume syncing.' : 'Sync error. Try reconnecting.'}
            </p>
          </div>
          <Link href="/accounts" className="ui-focus shrink-0 rounded-ui-sm text-[13px] font-semibold text-brand hover:underline">Reconnect →</Link>
        </div>
      ))}

      <section className="rounded-ui-xl border border-line bg-panel shadow-ui-sm">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className={cn(
            'ui-focus flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-brand-softer sm:px-5 sm:py-4 rounded-ui-xl',
            !collapsed && 'rounded-b-none',
          )}
        >
          <span className="h-[11px] w-[11px] shrink-0 rounded-[3.5px]" style={{ background: `var(--ui-viz-${viz})` }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-editorial text-[16.5px] font-bold tracking-[-0.01em]">{title}</span>
              <span className="shrink-0 text-[12.5px] font-medium text-content-muted">{count} {unit}{count === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-0.5 hidden truncate text-[12px] font-medium text-content-faint sm:block">{caption}</div>
          </div>
          <span className={cn('ml-3 shrink-0 font-editorial text-[16.5px] font-extrabold tracking-[-0.015em] ui-tnum', totalNeg && 'text-negative')}>
            {totalNeg ? '−' : ''}{fmtUsd(total)}
          </span>
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center text-content-faint">
            <ChevronDown
              size={18}
              className={cn('transition-transform duration-200 ease-ui', collapsed && '-rotate-90')}
            />
          </span>
        </button>

        {!collapsed && (
          <div className="border-t border-line">
            {accounts.map((acct) => {
              const bal = effectiveBalance(acct);
              const institution = acct.item.institutionName || 'Manual';
              const synced = acct.item.lastSyncedAt ? relativeTime(acct.item.lastSyncedAt) : null;
              const frozen = acct.frozen === true;
              const isManual = acct.item.institutionId === 'manual';
              const metaSegs: string[] = [institution];
              if (acct.subtype) metaSegs.push(titleCase(acct.subtype));
              const linkedName = acct.propertyAccountId
                ? nameById.get(acct.propertyAccountId) ?? null
                : acct.type === 'real_estate'
                  ? mortgageByProperty.get(acct.id) ?? null
                  : null;
              if (linkedName) metaSegs.push(`linked to ${linkedName}`);
              const badges: string[] = [];
              if (acct.excludeFromNetWorth) badges.push('Not counted');
              if (acct.invertBalance) badges.push('Inverted');
              return (
                <AcctRow
                  key={acct.id}
                  accountId={acct.id}
                  institution={institution}
                  name={titleCase(stripAccountMask(acct.name, acct.mask))}
                  mask={acct.mask}
                  metaSegs={metaSegs}
                  badges={badges}
                  value={bal}
                  negative={totalNeg}
                  frozen={frozen}
                  syncTime={synced}
                  syncIso={acct.item.lastSyncedAt}
                  valueSource={acct.valueSource}
                  metadata={acct.metadata}
                  onEstimateResolved={onEstimateResolved}
                  onSettings={() => setLocation('/accounts/' + acct.id)}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Institution section — collapsible header (icon + name + status + net total)
// over the accounts connected through it. Managing the connection (disconnect,
// add accounts to it) lives on the Connected-Accounts page; "Manage" links out.
// ─────────────────────────────────────────────────────────────────────────

function InstitutionSection({
  item, items, onEstimateResolved,
}: {
  item: Item;
  items: Item[];
  onEstimateResolved?: () => void;
}) {
  const [, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const institution = item.institutionName || 'Manual';
  const isManual = item.institutionId === 'manual';
  const isError = item.status === 'error' || item.status === 'item_login_required';
  const synced = item.lastSyncedAt ? relativeTime(item.lastSyncedAt) : null;
  const statusLabel = isManual
    ? 'Manual entry'
    : isError
      ? 'Needs attention'
      : synced ? `synced ${synced}` : 'Synced';

  // Property↔mortgage link resolution (shared with the category grouping) so a
  // row can read "linked to X".
  const allAccts = items.flatMap((i) => i.accounts);
  const linkNameOf = (a: { name: string; mask: string | null }) =>
    titleCase(stripAccountMask(a.name, a.mask));
  const nameById = new Map(allAccts.map((a) => [a.id, linkNameOf(a)] as const));
  const mortgageByProperty = new Map<string, string>();
  for (const a of allAccts) {
    if (a.propertyAccountId) mortgageByProperty.set(a.propertyAccountId, linkNameOf(a));
  }

  // Net total across the institution — debts reduce, everything else adds
  // (respecting the invert override, matching the net-worth math).
  const total = item.accounts
    .filter((a) => !a.excludeFromNetWorth)
    .reduce((sum, a) => {
      const v = effectiveBalance(a);
      return a.type === 'credit' || a.type === 'loan' ? sum - Math.abs(v) : sum + v;
    }, 0);
  const totalNeg = total < 0;

  return (
    <section className={cn(
      'overflow-hidden rounded-ui-xl border bg-panel shadow-ui-sm',
      isError ? 'border-caution/40' : 'border-line',
    )}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className={cn(
          'ui-focus flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-brand-softer sm:px-5',
          !collapsed && 'border-b border-line',
        )}
      >
        <InstIcon institution={institution} isManual={isManual} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-editorial text-[16.5px] font-bold leading-tight tracking-[-0.01em]" title={institution}>
            {institution}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[12.5px] text-content-muted">
            <span className={cn('font-medium', isError && 'text-caution')}>{statusLabel}</span>
            <span>{item.accounts.length} account{item.accounts.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <span className={cn('ml-3 shrink-0 font-editorial text-[16px] font-extrabold tracking-[-0.015em] ui-tnum', totalNeg && 'text-negative')}>
          {totalNeg ? '−' : ''}{fmtUsd(Math.abs(total))}
        </span>
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center text-content-faint">
          <ChevronDown size={18} className={cn('transition-transform duration-200 ease-ui', collapsed && '-rotate-90')} />
        </span>
      </button>

      {!collapsed && (
        <div>
          {item.accounts.map((acct) => {
            const bal = effectiveBalance(acct);
            const frozen = acct.frozen === true;
            const metaSegs: string[] = [];
            if (acct.subtype) metaSegs.push(titleCase(acct.subtype));
            else metaSegs.push(titleCase(acct.type.replace(/_/g, ' ')));
            const linkedName = acct.propertyAccountId
              ? nameById.get(acct.propertyAccountId) ?? null
              : acct.type === 'real_estate'
                ? mortgageByProperty.get(acct.id) ?? null
                : null;
            if (linkedName) metaSegs.push(`linked to ${linkedName}`);
            const badges: string[] = [];
            if (acct.excludeFromNetWorth) badges.push('Not counted');
            if (acct.invertBalance) badges.push('Inverted');
            const isDebt = acct.type === 'credit' || acct.type === 'loan';
            return (
              <AcctRow
                key={acct.id}
                accountId={acct.id}
                institution={institution}
                name={titleCase(stripAccountMask(acct.name, acct.mask))}
                mask={acct.mask}
                metaSegs={metaSegs}
                badges={badges}
                value={bal}
                negative={isDebt}
                frozen={frozen}
                syncTime={synced}
                syncIso={item.lastSyncedAt}
                valueSource={acct.valueSource}
                metadata={acct.metadata}
                onEstimateResolved={onEstimateResolved}
                onSettings={() => setLocation('/accounts/' + acct.id)}
                hideIcon
              />
            );
          })}
          {/* Managing a connection (add accounts to it, disconnect it) lives on
              the Connected-Accounts page — link out so those flows stay intact. */}
          <div className="flex items-center border-t border-line px-4 py-2.5 sm:px-5">
            <button
              type="button"
              onClick={() => setLocation('/accounts')}
              className="ui-focus inline-flex min-h-touch items-center gap-1.5 rounded-ui-sm px-2.5 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-softer"
            >
              <Settings2 size={14} />
              Manage connection
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Account row — institution icon · name/meta · balance · status · chevron.
// The whole row navigates to the account detail page (edit/sync/delete live
// there) — same pattern as /accounts.
// ─────────────────────────────────────────────────────────────────────────

function AcctRow({
  accountId, institution, name, mask, metaSegs, badges, value, negative, frozen, syncTime, syncIso,
  valueSource, metadata, onEstimateResolved, onSettings, hideIcon,
}: {
  accountId: string;
  institution: string;
  name: string;
  mask?: string | null;
  metaSegs: string[];
  badges: string[];
  value: number;
  negative?: boolean;
  frozen: boolean;
  syncTime: string | null;
  /** Raw last-sync ISO — feeds the exact date+time hover tooltip. */
  syncIso?: string | null;
  valueSource?: 'synced' | 'estimated' | 'manual';
  metadata?: Record<string, unknown> | null;
  onEstimateResolved?: () => void;
  onSettings: () => void;
  hideIcon?: boolean;
}) {
  const showNeg = negative || value < 0;
  const formatted = fmtUsd(Math.abs(value));

  // Property whose value estimate is still pending → "Estimating…" pill; poll
  // it in the background (mirrors the /accounts row) so a value that lands later
  // replaces the pill.
  const veStatus = (metadata?.valueEstimate as { status?: string } | undefined)?.status;
  const [estimating, setEstimating] = useState(veStatus === 'pending');
  useEffect(() => {
    setEstimating(veStatus === 'pending');
    if (veStatus !== 'pending') return;
    let cancelled = false;
    const deadline = Date.now() + 5 * 60 * 1000;
    const tick = async () => {
      if (cancelled || Date.now() > deadline) { if (!cancelled) setEstimating(false); return; }
      try {
        const res = await api.getValueEstimate(accountId);
        if (cancelled) return;
        if (res.status === 'ready') { setEstimating(false); onEstimateResolved?.(); return; }
        if (res.status === 'failed' || res.status === 'none') { setEstimating(false); return; }
      } catch { /* transient — keep polling until the cap */ }
      if (!cancelled) setTimeout(tick, 10_000);
    };
    const t = setTimeout(tick, 10_000);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veStatus, accountId]);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View ${name}`}
      onClick={onSettings}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSettings(); } }}
      className={cn(
        'ui-focus group flex cursor-pointer items-center gap-3.5 border-t border-line px-4 py-3 transition-colors first:border-t-0 last:rounded-b-ui-xl hover:bg-brand-softer sm:px-5',
        frozen && 'opacity-70',
      )}
    >
      {!hideIcon && <InstIcon institution={institution} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14.5px] font-bold leading-tight" title={name}>{name}</span>
          {badges.map((b) => (
            <span key={b} className="hidden shrink-0 rounded-full bg-canvas-sunken px-1.5 py-0.5 text-[10px] font-medium text-content-muted sm:inline">{b}</span>
          ))}
          {estimating && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-info">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" aria-hidden />
              Estimating…
            </span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-2 text-[12.5px] text-content-muted">
          <span className="truncate">{metaSegs.join(', ')}</span>
          {mask && <span className="shrink-0 ui-tnum">••{mask}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        <div className="text-right">
          <div className={cn('font-editorial text-[15.5px] font-extrabold tracking-[-0.015em] ui-tnum', showNeg && 'text-negative')}>
            {showNeg ? '−' : ''}{formatted}
          </div>
          {frozen ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-bold text-info">
              <Lock size={10} strokeWidth={2.2} aria-hidden="true" /> Frozen
            </span>
          ) : estimating ? null : valueSource ? (
            <span className="mt-1 inline-flex">
              <ValueSourceBadge source={valueSource} syncedAt={syncIso ?? undefined} onActivate={onSettings} />
            </span>
          ) : syncTime ? (
            syncIso && exactSyncTime(syncIso) ? (
              <Tooltip content={exactSyncTime(syncIso)!}>
                <div
                  tabIndex={0}
                  aria-label={`Last synced ${exactSyncTime(syncIso)}`}
                  // The tooltip trigger swallows the row's bubbling click, so run
                  // the row's navigation directly to keep the whole row clickable.
                  onClick={onSettings}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSettings(); } }}
                  className="ui-focus mt-0.5 hidden rounded-ui-xs text-[12px] text-content-muted ui-tnum sm:block"
                >
                  {syncTime}
                </div>
              </Tooltip>
            ) : (
              <div className="mt-0.5 hidden text-[12px] text-content-muted ui-tnum sm:block">{syncTime}</div>
            )
          ) : null}
        </div>
        <ChevronRight size={16} className="shrink-0 text-content-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
    </div>
  );
}

function InstIcon({ institution, isManual }: { institution: string; isManual?: boolean }) {
  const url = isManual ? null : faviconUrl(institutionDomainFor(institution), 64);
  const mono = (institution || '?').trim().charAt(0).toUpperCase();
  const [err, setErr] = useState(false);
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-ui-md border border-line bg-canvas-sunken text-[13px] font-bold text-content-secondary">
      {url && !err ? (
        <img src={url} alt="" className="h-6 w-6 rounded-[5px]" onError={() => setErr(true)} />
      ) : isManual ? (
        <Pencil size={16} className="text-content-muted" />
      ) : (
        mono
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function titleCase(raw: string): string {
  return raw.split(/\s+/).map((w) =>
    w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

