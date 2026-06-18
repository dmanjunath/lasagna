import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Wallet, TrendingUp, CreditCard, RefreshCw, Lightbulb, Plus,
  Banknote, ShoppingCart, UtensilsCrossed, Home, Car, Clapperboard,
  ShoppingBag, HeartPulse, Shield, Plane, Tv, Receipt, ArrowLeftRight,
  DollarSign,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Page,
  Section,
  Card,
  Button,
  Pill,
  EmptyState,
  AccountRow,
  TransactionRow,
  SkeletonChart,
  SkeletonRow,
  useConfirm,
  TrendChart,
  filterByRange,
  type Range,
  type TrendPoint,
} from '../components/ds';

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
  }>;
}
interface Transaction {
  id: string; date: string; name: string; merchantName: string | null;
  amount: string; category: string;
}
interface Insight {
  id: string; category: string; type: string | null; title: string; description: string;
}

const fmtUsd = (n: number, frac = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: frac, minimumFractionDigits: frac });

// Balance with the user's invert override applied — used everywhere a balance
// feeds a total or a row value so the UI matches the server's net-worth math.
const effectiveBalance = (a: { balance: string | null; invertBalance?: boolean }) =>
  (a.invertBalance ? -1 : 1) * parseFloat(a.balance ?? '0');

const formatDateLong = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

const categoryIcon: Record<string, React.ReactNode> = {
  income: <DollarSign size={14} />, groceries: <ShoppingCart size={14} />,
  food_dining: <UtensilsCrossed size={14} />, housing: <Home size={14} />,
  transportation: <Car size={14} />, entertainment: <Clapperboard size={14} />,
  shopping: <ShoppingBag size={14} />, utilities: <Lightbulb size={14} />,
  healthcare: <HeartPulse size={14} />, insurance: <Shield size={14} />,
  travel: <Plane size={14} />, subscriptions: <Tv size={14} />,
  debt_payment: <CreditCard size={14} />, savings_investment: <TrendingUp size={14} />,
  taxes: <Receipt size={14} />, transfer: <ArrowLeftRight size={14} />,
};

export function SimpleMoney() {
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<TrendPoint[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [range, setRange] = useState<Range>('6M');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getItems().catch(() => ({ items: [] as Item[] })),
      api.getNetWorthHistory().catch(() => ({ history: [] as TrendPoint[] })),
      api.getTransactions({ limit: 8 }).catch(() => ({ transactions: [] as Transaction[] })),
      api.getInsights().catch(() => ({ insights: [] as Insight[] })),
    ]).then(([itemsData, historyData, txData, insightsData]) => {
      setItems(itemsData.items);
      setHistory(historyData.history || []);
      setTransactions(txData.transactions);
      setInsights((insightsData.insights || []).filter((i: any) => !i.dismissedAt).slice(0, 5));
    }).finally(() => setLoading(false));
  }, []);

  const [syncingAll, setSyncingAll] = useState(false);
  // Hover index bubbled up from the chart so the top-left lead can swap its
  // value/delta for the hovered point's value/date.
  const [chartHoverIdx, setChartHoverIdx] = useState<number | null>(null);

  async function refreshItems() {
    const fresh = await api.getItems();
    setItems(fresh.items);
  }

  async function handleSync(itemId: string) {
    setSyncing(itemId);
    setSyncError(null);
    try {
      await api.syncItem(itemId);
      const fresh = await api.getItems();
      setItems(fresh.items);
    } catch {
      const name = items.find((i) => i.id === itemId)?.institutionName || 'Institution';
      setSyncError(`Couldn't sync ${name}. Try again in a moment.`);
    }
    setSyncing(null);
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    setSyncError(null);
    try {
      await Promise.all(items.map((item) => api.syncItem(item.id).catch(() => {})));
      const fresh = await api.getItems();
      setItems(fresh.items);
    } catch {
      setSyncError('Some accounts failed to sync. Try again.');
    }
    setSyncingAll(false);
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

  const monthChange = computeDelta(history, 30);
  const chartPoints = useMemo(() => filterByRange(history, range), [history, range]);

  // Real AI insights filtered to portfolio/debt/cash categories
  const moneyInsights = insights.filter((i) =>
    ['portfolio', 'cash', 'debt', 'savings', 'investment'].some((k) => (i.category + (i.type || '')).toLowerCase().includes(k))
  );

  const totalAccountCount = cashAccounts.length + investAccounts.length + realEstateAccounts.length + altAccounts.length + debtAccounts.length;

  const hasMoney = !loading && totalAccountCount > 0;

  return (
    <Page>
      {/* Compact page bar — small H1 + actions only. Net worth + delta are
          dropped from the caption because the figure below already shows them
          with proper typographic hierarchy (iter 2 dedupe). On <640px the
          action buttons hide to keep the bar a single short row — the same
          actions remain available via the account sections and the "+" route. */}
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Money</h1>
          {!hasMoney && (
            <span className="ds-page-bar__caption">{formatDateLong(new Date())}</span>
          )}
        </div>
        {hasMoney && (
          <div className="ds-money-header-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSyncAll}
              disabled={syncingAll}
              icon={<RefreshCw size={12} className={syncingAll ? 'animate-spin' : ''} />}
            >
              {syncingAll ? 'Syncing…' : 'Sync all'}
            </Button>
            <Link href="/accounts">
              <Button variant="ink" size="sm" icon={<Plus size={12} />}>Add account</Button>
            </Link>
          </div>
        )}
      </header>

      {/* Sync error banner */}
      {syncError && (
        <Section>
          <Card variant="ghost">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span className="ds-body ds-neg">{syncError}</span>
              <Button variant="link" size="sm" onClick={() => setSyncError(null)}>Dismiss</Button>
            </div>
          </Card>
        </Section>
      )}

      {/* ── Net worth figure — borderless chart with internal value label.
          No section H2 above it (the value lives inside the figure). */}
      {chartPoints.length >= 2 && (() => {
        const hoveredPoint = chartHoverIdx !== null ? chartPoints[chartHoverIdx] : null;
        const displayValue = hoveredPoint ? hoveredPoint.value : netWorth;
        return (
          <figure className="ds-figure">
            <div className="ds-figure__head">
              <div className="ds-figure__lead">
                <span className="ds-figure__label">Net worth</span>
                <span className="ds-figure__value ds-num">{fmtUsd(displayValue)}</span>
                {hoveredPoint ? (
                  <span className="ds-figure__delta ds-num" style={{ color: 'var(--lf-muted)' }}>
                    {new Date(hoveredPoint.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                ) : monthChange !== null && (
                  <span className={`ds-delta-chip ds-delta-chip--${monthChange >= 0 ? 'pos' : 'neg'}`}>
                    {monthChange >= 0 ? '↑' : '↓'} {fmtUsd(Math.abs(monthChange))} · 30d
                  </span>
                )}
              </div>
              <div role="radiogroup" aria-label="Time range" className="ds-figure__range">
                {(['1M', '6M', '1Y', 'All'] as Range[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    role="radio"
                    aria-checked={range === r}
                    className="ds-figure__range-btn"
                  >
                    <Pill tone={range === r ? 'ink' : 'ghost'}>{r}</Pill>
                  </button>
                ))}
              </div>
            </div>
            <TrendChart points={chartPoints} range={range} onHoverChange={setChartHoverIdx} />
          </figure>
        );
      })()}

      {/* ── Chart placeholder ── */}
      {!loading && chartPoints.length < 2 && allAccounts.length > 0 && (
        <Section>
          <Card variant="ghost">
            <div style={{ display: 'grid', placeItems: 'center', padding: '36px 12px', textAlign: 'center' }}>
              <TrendingUp size={20} className="text-text-muted" style={{ marginBottom: 8 }} />
              <div className="ds-h3">Building your trend</div>
              <p className="ds-caption" style={{ marginTop: 6 }}>Your net-worth chart appears once we have a few days of history.</p>
            </div>
          </Card>
        </Section>
      )}

      {/* ── Loading skeleton — iter 7 D: matched outline (chart + 2 rows ×
          2 sections) so first paint reserves the same space the loaded
          page consumes. */}
      {loading && (
        <>
          <div style={{ marginBottom: 28 }}>
            <SkeletonChart height={240} />
          </div>
          {[1, 2].map((g) => (
            <Section key={g}>
              <SkeletonRow />
              <SkeletonRow />
            </Section>
          ))}
        </>
      )}

      {/* ── Empty state ── */}
      {!loading && allAccounts.length === 0 && (
        <Section>
          <EmptyState
            icon={<Wallet size={28} />}
            title="No accounts connected"
            body="Link a bank or brokerage to see your money here."
            cta={
              <Link href="/accounts">
                <Button variant="ink">Connect an account</Button>
              </Link>
            }
          />
        </Section>
      )}

      {/* Section insights — short personalized callouts that surface the
          "what does this mean" question per section. Computed once from the
          breakdown so changing data updates the captions automatically. */}
      {(() => null)()}
      {/* ── Cash section ── */}
      {cashAccounts.length > 0 && (
        <AccountSection
          title="Cash"
          eyebrow={`${cashAccounts.length} account${cashAccounts.length === 1 ? '' : 's'}`}
          insight={grossAssets > 0 ? `${Math.round((cashTotal / grossAssets) * 100)}% of assets · ready to deploy` : 'ready to deploy'}
          total={cashTotal}
          items={items}
          filterType="depository"
          syncing={syncing}
          onSync={handleSync}
          onRefresh={refreshItems}
        />
      )}

      {/* ── Investments section ── */}
      {investAccounts.length > 0 && (
        <AccountSection
          title="Investments"
          eyebrow={`${investAccounts.length} account${investAccounts.length === 1 ? '' : 's'}`}
          insight={grossAssets > 0
            ? `${Math.round((investTotal / grossAssets) * 100)}% of assets · across ${investAccounts.length} account${investAccounts.length === 1 ? '' : 's'}`
            : `across ${investAccounts.length} account${investAccounts.length === 1 ? '' : 's'}`}
          total={investTotal}
          items={items}
          filterType="investment"
          syncing={syncing}
          onSync={handleSync}
          onRefresh={refreshItems}
        />
      )}

      {/* ── Property section ── */}
      {realEstateAccounts.length > 0 && (
        <AccountSection
          title="Property"
          eyebrow={`${realEstateAccounts.length} account${realEstateAccounts.length === 1 ? '' : 's'}`}
          insight={grossAssets > 0
            ? `${Math.round((realEstateTotal / grossAssets) * 100)}% of assets · real estate`
            : 'real estate'}
          total={realEstateTotal}
          items={items}
          filterType="real_estate"
          syncing={syncing}
          onSync={handleSync}
          onRefresh={refreshItems}
        />
      )}

      {/* ── Other assets section ── */}
      {altAccounts.length > 0 && (
        <AccountSection
          title="Other assets"
          eyebrow={`${altAccounts.length} item${altAccounts.length === 1 ? '' : 's'}`}
          insight={grossAssets > 0
            ? `${Math.round((altTotal / grossAssets) * 100)}% of assets · alternative holdings`
            : 'alternative holdings'}
          total={altTotal}
          items={items}
          filterType="alternative"
          syncing={syncing}
          onSync={handleSync}
          onRefresh={refreshItems}
        />
      )}

      {/* ── Debt section ── */}
      {debtAccounts.length > 0 && (
        <AccountSection
          title="Debt"
          eyebrow={`${debtAccounts.length} account${debtAccounts.length === 1 ? '' : 's'}`}
          insight={(() => {
            if (grossAssets <= 0) return `${debtAccounts.length} loan${debtAccounts.length === 1 ? '' : 's'}`;
            const dti = Math.round((debtTotal / grossAssets) * 100);
            return `${dti}% debt-to-assets · ${debtAccounts.length} loan${debtAccounts.length === 1 ? '' : 's'}`;
          })()}
          total={debtTotal}
          totalTone="neg"
          items={items}
          filterType={['credit', 'loan']}
          syncing={syncing}
          onSync={handleSync}
          onRefresh={refreshItems}
        />
      )}

      {/* ── Actions — editorial feed (not cards) ── */}
      {moneyInsights.length > 0 && (
        <Section
          title="Actions"
          eyebrow={`${moneyInsights.length} item${moneyInsights.length === 1 ? '' : 's'}`}
          actions={<Link href="/insights" className="ds-btn ds-btn--link">All actions →</Link>}
        >
          <ul className="ds-money-feed">
            {moneyInsights.map((ins) => (
              <li key={ins.id}>
                <Link href={`/insights?id=${ins.id}`} className="ds-money-feed__link">
                  <div className="ds-money-feed__bullet">
                    <Lightbulb size={14} className="text-cheese" />
                  </div>
                  <div className="ds-money-feed__body">
                    <div className="ds-money-feed__title">{ins.title}</div>
                    {ins.description && (
                      <p className="ds-money-feed__desc">{ins.description}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Recent activity — TransactionRow primitive.
          Mobile rule: $ amount is ALWAYS visible. Category + date stay on
          the sub-row, never drop. (Iter 2 P0.) */}
      {transactions.length > 0 && (
        <Section
          title="Recent activity"
          actions={<Link href="/spending" className="ds-btn ds-btn--link">All spending →</Link>}
        >
          <Card flush>
            {transactions.map((t) => {
              const amt = parseFloat(t.amount);
              return (
                <TransactionRow
                  key={t.id}
                  merchant={t.merchantName || t.name}
                  category={humanCategory(t.category)}
                  date={t.date}
                  amount={amt}
                  fallbackIcon={categoryIcon[t.category] || <Banknote size={14} />}
                />
              );
            })}
          </Card>
        </Section>
      )}

      <style>{`
        .ds-money-stats { margin: 32px 0 56px; }

        /* Page-bar actions: hidden on <640px so the bar stays a single short
           row (iter 2 fix — was wrapping into a 128px tall double-stack). The
           same actions live in the per-section "+ Add account" empty states
           and the global accounts page. */
        .ds-money-header-actions {
          display: none;
        }
        @media (min-width: 640px) {
          .ds-money-header-actions {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 10px;
          }
        }

        /* Composition ribbon legend: stack to one column on mobile with a
           fixed-width % column on the right so values right-align cleanly. */
        @media (max-width: 640px) {
          .ds-ribbon__legend {
            flex-direction: column;
            gap: 8px;
            align-items: stretch;
          }
          .ds-ribbon__legend-item {
            display: grid;
            grid-template-columns: 12px 1fr auto;
            gap: 10px;
            align-items: baseline;
          }
          .ds-ribbon__legend-value {
            text-align: right;
            min-width: 64px;
          }
        }

        /* Action feed — sits on the unified card surface so the page reads
           as a coherent stack of elevated panels. */
        .ds-money-feed {
          list-style: none;
          margin: 0;
          padding: 4px 20px;
          background: var(--lf-surface);
          border: 1px solid var(--lf-rule-neutral);
          border-radius: 12px;
          box-shadow: var(--shadow-card);
        }
        .ds-money-feed li {
          padding: 16px 0;
          border-top: 1px solid var(--lf-rule-neutral);
        }
        .ds-money-feed li:first-child { border-top: 0; }
        .ds-money-feed__link {
          display: flex;
          gap: 14px;
          text-decoration: none;
          color: inherit;
        }
        .ds-money-feed__link:hover .ds-money-feed__title { color: var(--lf-sauce); }
        .ds-money-feed__bullet {
          width: 28px; height: 28px;
          border-radius: 4px;
          background: var(--lf-rule-soft);
          display: grid; place-items: center;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .ds-money-feed__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 17px;
          font-weight: 500;
          color: var(--lf-ink);
          line-height: 1.3;
          transition: color 0.15s;
        }
        .ds-money-feed__desc {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          line-height: 1.5;
          color: var(--lf-muted);
          margin: 6px 0 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Account section — groups accounts by institution with sync controls.
// Header uses Section primitive (serif h2 + eyebrow), total surfaces in the
// Section actions slot as tabular ink — no inline serif/dark hero.
// ─────────────────────────────────────────────────────────────────────────

function AccountSection({
  title, eyebrow, insight, total, totalTone, items, filterType, syncing, onSync, onRefresh,
}: {
  title: string;
  eyebrow: string;
  insight?: string;
  total: number;
  totalTone?: 'neg' | 'default';
  items: Item[];
  filterType: string | string[];
  syncing: string | null;
  onSync: (itemId: string) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const confirm = useConfirm();
  const [, setLocation] = useLocation();

  const types = Array.isArray(filterType) ? filterType : [filterType];
  const accounts = items.flatMap((item) =>
    item.accounts
      .filter((a) => types.includes(a.type))
      .map((a) => ({ ...a, item }))
  );

  const errorItems = items.filter(
    (item) =>
      (item.status === 'error' || item.status === 'item_login_required') &&
      item.accounts.some((a) => types.includes(a.type))
  );

  return (
    <>
    <Section
      title={title}
      eyebrow={eyebrow}
      actions={
        // Iter 5: sync icon is now absolutely positioned and no longer takes
        // flex space, so AccountRow's value column ends 16px inside the card
        // right edge. The rows now carry a ⋯ menu slot to the right of their
        // value (28px slot + 10px gap, flush to the 16px padding), so the row
        // values sit 54px in from the card edge. The subtotal matches that
        // offset so all $ values share one right edge down the page.
        <span
          className={`ds-money-grid__value ds-num ${totalTone === 'neg' ? 'ds-neg' : ''}`}
          style={{ fontSize: 18, fontWeight: 500, width: '12ch', marginRight: 54 }}
        >
          {totalTone === 'neg' ? '−' : ''}{fmtUsd(total)}
        </span>
      }
    >
      {/* Per-section personalized insight — short caption that frames what
          the user is looking at (e.g. "12% of net worth · ready to deploy").
          Sits between the section header and the row list so it reads as
          context, not chrome. */}
      {insight && (
        <p
          className="ds-caption"
          style={{ margin: '-8px 0 12px', color: 'var(--lf-muted)' }}
        >
          {insight}
        </p>
      )}

      {/* Sync error banners */}
      {errorItems.map((item) => (
        <Card key={item.id} variant="ghost" tight style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="ds-body" style={{ color: 'var(--lf-sauce-deep)', fontWeight: 600 }}>
                {item.institutionName || 'Institution'} needs attention
              </div>
              <p className="ds-caption" style={{ marginTop: 2 }}>
                {item.status === 'item_login_required' ? 'Login expired — reconnect to resume syncing' : 'Sync error — try reconnecting'}
              </p>
            </div>
            <Link href="/accounts" className="ds-btn ds-btn--link">Reconnect →</Link>
          </div>
        </Card>
      ))}

      <Card flush>
        {accounts.map((acct) => {
          const bal = effectiveBalance(acct);
          const institution = acct.item.institutionName || 'Manual';
          const metaSegs: string[] = [institution];
          if (acct.subtype) metaSegs.push(titleCase(acct.subtype));
          if (acct.mask) metaSegs.push(`··${acct.mask}`);
          const synced = acct.item.lastSyncedAt ? relativeTime(acct.item.lastSyncedAt) : null;
          const meta = (
            <>
              {metaSegs.map((seg, i) => (
                <span key={i}>
                  {i > 0 && <span className="ds-row__meta-dot">·</span>}
                  {seg}
                </span>
              ))}
              {synced && (
                <>
                  <span className="ds-row__meta-dot">·</span>
                  <span className="ds-row__meta-time">{synced}</span>
                </>
              )}
            </>
          );
          const isManual = acct.item.institutionId === 'manual';
          const badges: string[] = [];
          if (acct.excludeFromNetWorth) badges.push('Not counted');
          if (acct.invertBalance) badges.push('Inverted');
          return (
            <AccountRow
              key={acct.id}
              institution={institution}
              name={titleCase(acct.name)}
              meta={meta}
              badges={badges}
              value={bal}
              negative={totalTone === 'neg'}
              // Every account gets a settings entry; Plaid accounts also get
              // sync, manual accounts also get delete. The ⋯ menu surfaces only
              // the applicable items per account.
              onSettings={() => setLocation('/accounts/' + acct.id)}
              onSync={isManual ? undefined : () => onSync(acct.item.id)}
              syncing={syncing === acct.item.id}
              onDelete={isManual ? async () => {
                const ok = await confirm({
                  title: `Delete "${titleCase(acct.name)}"?`,
                  body: 'The account and its full balance history will be permanently removed. This can’t be undone.',
                  confirmLabel: 'Delete',
                  destructive: true,
                });
                if (!ok) return;
                await api.deleteManualAccount(acct.id);
                await onRefresh();
              } : undefined}
              formatValue={(n) => fmtUsd(n)}
            />
          );
        })}
      </Card>
    </Section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function computeDelta(history: TrendPoint[], daysAgo: number): number | null {
  if (history.length < 2) return null;
  const now = history[history.length - 1].value;
  const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  const past = [...history].reverse().find((p) => new Date(p.date).getTime() <= cutoff);
  if (!past) return null;
  return now - past.value;
}

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

function humanCategory(c: string) {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
