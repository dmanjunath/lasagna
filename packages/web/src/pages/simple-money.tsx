import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
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
  ChartHover,
  SkeletonChart,
  SkeletonRow,
} from '../components/ds';

type Range = '1M' | '6M' | '1Y' | 'All';

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
  }>;
}
interface NetWorthPoint { date: string; value: number; }
interface Transaction {
  id: string; date: string; name: string; merchantName: string | null;
  amount: string; category: string;
}
interface Insight {
  id: string; category: string; type: string | null; title: string; description: string;
}

const fmtUsd = (n: number, frac = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: frac, minimumFractionDigits: frac });

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
  const [history, setHistory] = useState<NetWorthPoint[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [range, setRange] = useState<Range>('6M');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getItems().catch(() => ({ items: [] as Item[] })),
      api.getNetWorthHistory().catch(() => ({ history: [] as NetWorthPoint[] })),
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
  // Iter 7 G: lift chart hover up so the static figure-head HUD can fade
  // out while the ChartHover pill is visible (avoid double-printing the same
  // date/value).
  const [chartHovering, setChartHovering] = useState(false);

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
  const sumBalances = (arr: typeof allAccounts) => arr.reduce((s, a) => s + parseFloat(a.balance ?? '0'), 0);
  const cashTotal = sumBalances(cashAccounts);
  const investTotal = sumBalances(investAccounts);
  const realEstateTotal = sumBalances(realEstateAccounts);
  const altTotal = sumBalances(altAccounts);
  const assetsTotal = realEstateTotal + altTotal;
  const debtTotal = debtAccounts.reduce((s, a) => s + Math.abs(parseFloat(a.balance ?? '0')), 0);
  const netWorth = cashTotal + investTotal + assetsTotal - debtTotal;

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
      {chartPoints.length >= 2 && (
        <figure className="ds-figure" data-hovering={chartHovering ? 'true' : 'false'}>
          <div className="ds-figure__head">
            <div
              className="ds-figure__lead"
              style={{
                opacity: chartHovering ? 0 : 1,
                transition: 'opacity 0.18s ease',
              }}
              aria-hidden={chartHovering}
            >
              <span className="ds-figure__label">Net worth</span>
              <span className="ds-figure__value ds-num">{fmtUsd(netWorth)}</span>
              {monthChange !== null && (
                <span className={`ds-figure__delta ds-num ${monthChange >= 0 ? 'ds-pos' : 'ds-neg'}`}>
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
          <NetWorthChart
            points={chartPoints}
            range={range}
            onHoverChange={(i) => setChartHovering(i !== null)}
          />
        </figure>
      )}

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
          insight={netWorth > 0 ? `${Math.round((cashTotal / netWorth) * 100)}% of net worth · ready to deploy` : 'ready to deploy'}
          total={cashTotal}
          items={items}
          filterType="depository"
          syncing={syncing}
          onSync={handleSync}
        />
      )}

      {/* ── Investments section ── */}
      {investAccounts.length > 0 && (
        <AccountSection
          title="Investments"
          eyebrow={`${investAccounts.length} account${investAccounts.length === 1 ? '' : 's'}`}
          insight={netWorth > 0
            ? `${Math.round((investTotal / netWorth) * 100)}% of net worth · across ${investAccounts.length} account${investAccounts.length === 1 ? '' : 's'}`
            : `across ${investAccounts.length} account${investAccounts.length === 1 ? '' : 's'}`}
          total={investTotal}
          items={items}
          filterType="investment"
          syncing={syncing}
          onSync={handleSync}
        />
      )}

      {/* ── Property section ── */}
      {realEstateAccounts.length > 0 && (
        <AccountSection
          title="Property"
          eyebrow={`${realEstateAccounts.length} ${realEstateAccounts.length === 1 ? 'property' : 'properties'}`}
          insight={netWorth > 0
            ? `${Math.round((realEstateTotal / netWorth) * 100)}% of net worth · real estate`
            : 'real estate'}
          total={realEstateTotal}
          items={items}
          filterType="real_estate"
          syncing={syncing}
          onSync={handleSync}
        />
      )}

      {/* ── Other assets section ── */}
      {altAccounts.length > 0 && (
        <AccountSection
          title="Other assets"
          eyebrow={`${altAccounts.length} item${altAccounts.length === 1 ? '' : 's'}`}
          insight={netWorth > 0
            ? `${Math.round((altTotal / netWorth) * 100)}% of net worth · alternative holdings`
            : 'alternative holdings'}
          total={altTotal}
          items={items}
          filterType="alternative"
          syncing={syncing}
          onSync={handleSync}
        />
      )}

      {/* ── Debt section ── */}
      {debtAccounts.length > 0 && (
        <AccountSection
          title="Debt"
          eyebrow={`${debtAccounts.length} account${debtAccounts.length === 1 ? '' : 's'}`}
          insight={(() => {
            const grossAssets = cashTotal + investTotal + assetsTotal;
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

        /* Editorial action feed — same family as ds-home-feed on Home */
        .ds-money-feed { list-style: none; margin: 0; padding: 0; }
        .ds-money-feed li {
          padding: 18px 0;
          border-top: 1px solid var(--lf-rule);
        }
        .ds-money-feed li:first-child { border-top: 0; padding-top: 0; }
        .ds-money-feed li:last-child { padding-bottom: 0; }
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
          background: var(--lf-cream);
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
  title, eyebrow, insight, total, totalTone, items, filterType, syncing, onSync,
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
}) {
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
    <Section
      title={title}
      eyebrow={eyebrow}
      actions={
        // Iter 5: sync icon is now absolutely positioned and no longer takes
        // flex space, so AccountRow's value column ends 16px inside the card
        // right edge (matches `.ds-row` padding-right). Subtotal uses the
        // same offset so $ values share a single right edge with the rows
        // below, and with all other section subtotals across the page.
        <span
          className={`ds-money-grid__value ds-num ${totalTone === 'neg' ? 'ds-neg' : ''}`}
          style={{ fontSize: 18, fontWeight: 500, width: '12ch', marginRight: 16 }}
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
          const bal = parseFloat(acct.balance ?? '0');
          const institution = acct.item.institutionName || 'Manual';
          const metaParts: string[] = [];
          metaParts.push(institution);
          if (acct.subtype) metaParts.push(titleCase(acct.subtype));
          if (acct.mask) metaParts.push(`··${acct.mask}`);
          if (acct.item.lastSyncedAt) metaParts.push(relativeTime(acct.item.lastSyncedAt));
          return (
            <AccountRow
              key={acct.id}
              institution={institution}
              name={titleCase(acct.name)}
              meta={metaParts.join(' · ')}
              value={bal}
              negative={totalTone === 'neg'}
              onSync={() => onSync(acct.item.id)}
              syncing={syncing === acct.item.id}
              formatValue={(n) => fmtUsd(n)}
            />
          );
        })}
      </Card>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function computeDelta(history: NetWorthPoint[], daysAgo: number): number | null {
  if (history.length < 2) return null;
  const now = history[history.length - 1].value;
  const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  const past = [...history].reverse().find((p) => new Date(p.date).getTime() <= cutoff);
  if (!past) return null;
  return now - past.value;
}

function filterByRange(history: NetWorthPoint[], range: Range): NetWorthPoint[] {
  if (range === 'All' || history.length === 0) return history;
  const days = range === '1M' ? 30 : range === '6M' ? 180 : 365;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter((p) => new Date(p.date).getTime() >= cutoff);
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

// ── Interactive net-worth chart ──────────────────────────────────────────

const CHART_H = 240;
const CHART_M = { top: 16, right: 12, bottom: 36, left: 56 };
// Single source of truth for the chart accent — matches `text-success` /
// `--color-success` (#4C7A3E) so palette changes propagate automatically.
const CHART_COLOR = 'rgb(var(--color-success))';

/**
 * Build a smooth monotone-cubic Hermite spline path through (x, y) points.
 * Fritsch–Carlson tangents prevent the curve from overshooting the data —
 * monthly balances will look like a sweep, not a connect-the-dots zigzag.
 */
function smoothLinePath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n < 2) return '';
  if (n === 2) return `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} L ${pts[1][0].toFixed(2)} ${pts[1][1].toFixed(2)}`;

  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    d[i] = (pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]);
  }
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) {
      m[i] = 0;
    } else {
      m[i] = (d[i - 1] + d[i]) / 2;
      const a = m[i] / d[i - 1];
      const b = m[i] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i - 1];
      }
    }
  }

  let out = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    const c1x = pts[i][0] + dx;
    const c1y = pts[i][1] + m[i] * dx;
    const c2x = pts[i + 1][0] - dx;
    const c2y = pts[i + 1][1] - m[i + 1] * dx;
    out += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${pts[i + 1][0].toFixed(2)} ${pts[i + 1][1].toFixed(2)}`;
  }
  return out;
}

function NetWorthChart({ points, range, onHoverChange }: { points: NetWorthPoint[]; range: Range; onHoverChange?: (i: number | null) => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdxRaw] = useState<number | null>(null);
  const setHoverIdx = (i: number | null) => {
    setHoverIdxRaw(i);
    onHoverChange?.(i);
  };
  const [chartW, setChartW] = useState(600);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setChartW(el.clientWidth || 600);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = chartW - CHART_M.left - CHART_M.right;
  const innerH = CHART_H - CHART_M.top - CHART_M.bottom;

  const { yMin, yMax, yTicks } = useMemo(() => {
    const values = points.map((p) => p.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = (rawMax - rawMin) * 0.08 || Math.abs(rawMax) * 0.08 || 1;
    return { yMin: rawMin - pad, yMax: rawMax + pad, yTicks: niceTicks(rawMin - pad, rawMax + pad, 4) };
  }, [points]);

  const xAt = (i: number) => CHART_M.left + (i / Math.max(1, points.length - 1)) * innerW;
  const CHART_W = chartW;
  const yAt = (v: number) => CHART_M.top + innerH - ((v - yMin) / Math.max(0.0001, yMax - yMin)) * innerH;

  const xy = useMemo<Array<[number, number]>>(
    () => points.map((p, i) => [xAt(i), yAt(p.value)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, chartW, yMin, yMax],
  );
  const linePath = useMemo(() => smoothLinePath(xy), [xy]);
  const baseY = (CHART_M.top + innerH).toFixed(2);
  const areaPath = linePath
    ? `${linePath} L ${xAt(points.length - 1).toFixed(2)} ${baseY} L ${xAt(0).toFixed(2)} ${baseY} Z`
    : '';

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const xLabels = useMemo(() => pickXLabels(points, range), [points, range]);

  // Reserve a 28px header row so the value pill (rendered inside the overlay's
  // top region) never overlaps the line.
  return (
    <div ref={wrapperRef} className="relative select-none" style={{ color: CHART_COLOR }}>
      <div className="h-7 flex items-baseline justify-end gap-2 px-1 mb-1 tabular-nums" aria-live="polite">
        {hover ? (
          <>
            <span className="text-sm text-text-muted">{new Date(hover.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span className="text-lg font-semibold text-text leading-none tabular-nums tracking-tight">{fmtUsd(hover.value)}</span>
          </>
        ) : <span aria-hidden="true">&nbsp;</span>}
      </div>
      <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label="Net worth trend chart"
        className="w-full block touch-none"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <linearGradient id="nw-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="40%"  stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="nw-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="currentColor" stopOpacity="0.45" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={CHART_M.left} y1={yAt(t)} x2={CHART_W - CHART_M.right} y2={yAt(t)} className="stroke-rule/70" strokeWidth={1} strokeDasharray="2 5" />
            <text x={CHART_M.left - 12} y={yAt(t)} dy="0.32em" textAnchor="end" className="fill-text-muted" style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{formatShortMoney(t)}</text>
          </g>
        ))}
        <path d={areaPath} fill="url(#nw-area)" />
        <path
          d={linePath}
          fill="none"
          stroke="url(#nw-line)"
          strokeWidth={2.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 2px 3px rgb(31 26 22 / 0.12))' }}
        />
        {!hover && points.length > 0 && (
          <>
            <circle
              cx={xAt(points.length - 1)}
              cy={yAt(points[points.length - 1].value)}
              r={11}
              fill="currentColor"
              fillOpacity={0.12}
            />
            <circle
              cx={xAt(points.length - 1)}
              cy={yAt(points[points.length - 1].value)}
              r={5.5}
              fill="currentColor"
              stroke="rgb(var(--color-bg))"
              strokeWidth={2.5}
            />
          </>
        )}
        {hover && hoverIdx !== null && (
          <g>
            <line x1={xAt(hoverIdx)} y1={CHART_M.top} x2={xAt(hoverIdx)} y2={CHART_M.top + innerH} className="stroke-text-muted/60" strokeWidth={1} strokeDasharray="2 4" />
            <circle cx={xAt(hoverIdx)} cy={yAt(hover.value)} r={14} fill="currentColor" fillOpacity={0.18} />
            <circle
              cx={xAt(hoverIdx)}
              cy={yAt(hover.value)}
              r={5.5}
              fill="currentColor"
              stroke="rgb(var(--color-bg))"
              strokeWidth={2.5}
            />
          </g>
        )}
        {xLabels.map(({ idx, label }) => (
          <text key={`${idx}-${label}`} x={xAt(idx)} y={CHART_H - 12} textAnchor="middle" className="fill-text-muted" style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{label}</text>
        ))}
      </svg>
      {points.length > 0 && (
        <ChartHover
          width={CHART_W}
          height={CHART_H}
          paddingLeft={CHART_M.left}
          paddingRight={CHART_M.right}
          count={points.length}
          onHoverChange={setHoverIdx}
          getValue={(i) => fmtUsd(points[i].value)}
          getLabel={(i) =>
            new Date(points[i].date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          }
          getCurvePoint={(i) => ({ x: xAt(i), y: yAt(points[i].value) })}
        />
      )}
      </div>
    </div>
  );
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const range = max - min;
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm < 1.5) step = mag; else if (norm < 3) step = 2 * mag; else if (norm < 7) step = 5 * mag; else step = 10 * mag;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = first; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function formatShortMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function pickXLabels(points: NetWorthPoint[], range: Range): Array<{ idx: number; label: string }> {
  if (points.length === 0) return [];
  const fmt: Intl.DateTimeFormatOptions = range === '1M' ? { month: 'short', day: 'numeric' } : range === '6M' ? { month: 'short' } : { month: 'short', year: '2-digit' };
  const want = Math.min(5, points.length);
  const step = (points.length - 1) / Math.max(1, want - 1);
  const out: Array<{ idx: number; label: string }> = [];
  let lastLabel = '';
  for (let i = 0; i < want; i++) {
    const idx = Math.round(i * step);
    const label = new Date(points[idx].date).toLocaleString('en-US', fmt);
    if (label === lastLabel) continue;
    out.push({ idx, label });
    lastLabel = label;
  }
  return out;
}

