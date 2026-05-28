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
  PageHeader,
  Section,
  Card,
  Button,
  Pill,
  DataTable,
  EmptyState,
  CompositionRibbon,
  StatStrip,
  Lede,
} from '../components/ds';
import type { DataTableColumn } from '../components/ds/DataTable';

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
  const assetsLabelText =
    realEstateTotal > 0 && altTotal > 0 ? 'Other assets' :
    realEstateTotal > 0 ? 'Property' : 'Alternatives';

  const monthChange = computeDelta(history, 30);
  const chartPoints = useMemo(() => filterByRange(history, range), [history, range]);

  // Real AI insights filtered to portfolio/debt/cash categories
  const moneyInsights = insights.filter((i) =>
    ['portfolio', 'cash', 'debt', 'savings', 'investment'].some((k) => (i.category + (i.type || '')).toLowerCase().includes(k))
  );

  // Transactions for DataTable
  const txColumns: DataTableColumn<Transaction>[] = [
    {
      key: 'merchant',
      header: 'Merchant',
      className: 'td--wrap',
      cell: (t) => (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 999,
            background: parseFloat(t.amount) < 0 ? 'rgba(90,107,63,0.12)' : 'var(--lf-cream)',
            display: 'grid', placeItems: 'center', flexShrink: 0,
            color: parseFloat(t.amount) < 0 ? 'var(--lf-basil)' : 'var(--lf-muted)',
            marginTop: 1,
          }}>
            {categoryIcon[t.category] || <Banknote size={14} />}
          </span>
          {/* Wraps to 2 lines instead of ellipsing so the Amount column stays visible
              without horizontal scroll on narrow viewports. */}
          <span style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}>
            {t.merchantName || t.name}
          </span>
        </div>
      ),
    },
    { key: 'category', header: 'Category', muted: true, cell: (t) => humanCategory(t.category) },
    { key: 'date', header: 'Date', muted: true, className: 'hidden md:table-cell', cell: (t) => formatDate(t.date) },
    {
      key: 'amount',
      header: 'Amount',
      num: true,
      cell: (t) => {
        const amt = parseFloat(t.amount);
        const isIncome = amt < 0;
        return (
          <span className={isIncome ? 'ds-pos ds-num' : 'ds-num'}>
            {isIncome ? '+' : '−'}{fmtUsd(Math.abs(amt), 2)}
          </span>
        );
      },
    },
  ];

  const totalAccountCount = cashAccounts.length + investAccounts.length + realEstateAccounts.length + altAccounts.length + debtAccounts.length;

  return (
    <Page>
      <PageHeader
        eyebrow={formatDateLong(new Date())}
        title="Money"
        actions={
          !loading && items.length > 0 ? (
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
          ) : null
        }
      />

      {/* Editorial lede — addresses the user directly with inline tabular money */}
      {!loading && totalAccountCount > 0 && (
        <div style={{ marginBottom: 40 }}>
          <Lede>
            You have <Lede.Num>{fmtUsd(cashTotal)}</Lede.Num> in cash,{' '}
            <Lede.Num>{fmtUsd(investTotal)}</Lede.Num> invested
            {assetsTotal > 0 && (
              <>
                {', '}
                <Lede.Num>{fmtUsd(assetsTotal)}</Lede.Num> in {assetsLabelText.toLowerCase()}
              </>
            )}
            {debtTotal > 0 && (
              <>
                {', '}and <Lede.Num tone="neg">−{fmtUsd(debtTotal)}</Lede.Num> in debt
              </>
            )}
            {' — for a net worth of '}
            <Lede.Num highlight>{fmtUsd(netWorth)}</Lede.Num>
            {monthChange !== null && (
              <>
                {' ('}
                <Lede.Num tone={monthChange >= 0 ? 'pos' : 'neg'}>
                  {monthChange >= 0 ? '↑' : '↓'} {fmtUsd(Math.abs(monthChange))}
                </Lede.Num>
                {' this month)'}
              </>
            )}.
          </Lede>
        </div>
      )}

      {/* Composition ribbon — single proportional bar */}
      {!loading && (cashTotal > 0 || investTotal > 0 || assetsTotal > 0 || debtTotal > 0) && (
        <Section>
          <CompositionRibbon
            leadLabel="Net worth"
            leadValue={fmtUsd(netWorth)}
            leadDelta={
              totalAccountCount > 0
                ? `${totalAccountCount} account${totalAccountCount === 1 ? '' : 's'}`
                : undefined
            }
            segments={[
              ...(cashTotal > 0 ? [{ label: 'Cash', value: cashTotal, color: 'var(--lf-basil)' }] : []),
              ...(investTotal > 0 ? [{ label: 'Investments', value: investTotal, color: 'var(--lf-cheese)' }] : []),
              ...(assetsTotal > 0 ? [{ label: assetsLabelText, value: assetsTotal, color: 'var(--lf-noodle)' }] : []),
              ...(debtTotal > 0 ? [{ label: 'Debt', value: debtTotal, color: 'var(--lf-sauce)', negative: true }] : []),
            ]}
          />
        </Section>
      )}

      {/* Stat strip — secondary KPIs as a typographic ribbon */}
      {!loading && totalAccountCount > 0 && (
        <StatStrip
          className="ds-money-stats"
          items={[
            {
              label: 'Cash',
              value: fmtUsd(cashTotal),
              sub: `${cashAccounts.length} account${cashAccounts.length === 1 ? '' : 's'}`,
            },
            {
              label: 'Investments',
              value: fmtUsd(investTotal),
              sub: `${investAccounts.length} account${investAccounts.length === 1 ? '' : 's'}`,
            },
            ...(assetsTotal > 0
              ? [{
                  label: assetsLabelText,
                  value: fmtUsd(assetsTotal),
                  sub: `${realEstateAccounts.length + altAccounts.length} item${(realEstateAccounts.length + altAccounts.length) === 1 ? '' : 's'}`,
                } as const]
              : []),
            {
              label: 'Debt',
              value: fmtUsd(debtTotal),
              sub: `${debtAccounts.length} account${debtAccounts.length === 1 ? '' : 's'}`,
              tone: debtTotal > 0 ? 'neg' : 'default',
            },
            ...(monthChange !== null
              ? [{
                  label: '30-day change',
                  value: `${monthChange >= 0 ? '+' : '−'}${fmtUsd(Math.abs(monthChange))}`,
                  sub: monthChange >= 0 ? 'gaining' : 'losing',
                  tone: monthChange >= 0 ? 'pos' : 'neg',
                } as const]
              : []),
          ]}
        />
      )}

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

      {/* ── Chart ── */}
      {chartPoints.length >= 2 && (
        <Section
          title="Net worth over time"
          actions={
            <div role="radiogroup" aria-label="Time range" style={{ display: 'inline-flex', gap: 6 }}>
              {(['1M', '6M', '1Y', 'All'] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  role="radio"
                  aria-checked={range === r}
                  className="min-w-[44px] min-h-[44px]"
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Pill tone={range === r ? 'ink' : 'ghost'}>{r}</Pill>
                </button>
              ))}
            </div>
          }
        >
          <Card tight>
            <NetWorthChart points={chartPoints} range={range} />
          </Card>
        </Section>
      )}

      {/* ── Chart placeholder ── */}
      {!loading && chartPoints.length < 2 && allAccounts.length > 0 && (
        <Section title="Net worth over time">
          <Card variant="ghost">
            <div style={{ display: 'grid', placeItems: 'center', padding: '36px 12px', textAlign: 'center' }}>
              <TrendingUp size={20} className="text-text-muted" style={{ marginBottom: 8 }} />
              <div className="ds-h3">Building your trend</div>
              <p className="ds-caption" style={{ marginTop: 6 }}>Your net-worth chart appears once we have a few days of history.</p>
            </div>
          </Card>
        </Section>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <Section>
          <div className="animate-pulse" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {[1, 2].map((n) => (
              <Card key={n} flush>
                {[1, 2].map((r) => (
                  <div key={r} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 20px',
                    borderTop: r > 1 ? '1px solid var(--lf-rule-soft)' : 'none',
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--lf-rule)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 14, width: 140, background: 'var(--lf-rule)', borderRadius: 4, marginBottom: 6 }} />
                      <div style={{ height: 11, width: 100, background: 'var(--lf-rule-soft)', borderRadius: 4 }} />
                    </div>
                    <div style={{ height: 14, width: 64, background: 'var(--lf-rule)', borderRadius: 4 }} />
                  </div>
                ))}
              </Card>
            ))}
          </div>
        </Section>
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

      {/* ── Cash section ── */}
      {cashAccounts.length > 0 && (
        <AccountSection
          title="Cash"
          eyebrow={`${cashAccounts.length} account${cashAccounts.length === 1 ? '' : 's'}`}
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

      {/* ── Recent activity ── */}
      {transactions.length > 0 && (
        <Section
          title="Recent activity"
          actions={<Link href="/spending" className="ds-btn ds-btn--link">All spending →</Link>}
        >
          <Card flush>
            <DataTable
              columns={txColumns}
              rows={transactions}
              rowKey={(t) => t.id}
            />
          </Card>
        </Section>
      )}

      <style>{`
        .ds-money-stats { margin: 32px 0 56px; }

        /* Page-header actions: stack vertically on mobile, inline at md+. */
        .ds-money-header-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: stretch;
        }
        .ds-money-header-actions > * { width: 100%; }
        .ds-money-header-actions a { display: block; }
        @media (min-width: 768px) {
          .ds-money-header-actions {
            flex-direction: row;
            align-items: center;
            gap: 10px;
          }
          .ds-money-header-actions > * { width: auto; }
          .ds-money-header-actions a { display: inline-block; }
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

        .ds-money-account-row {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 20px;
        }
        .ds-money-account-row + .ds-money-account-row {
          border-top: 1px solid var(--lf-rule-soft);
        }
        .ds-money-account-row__badge {
          width: 32px; height: 32px; border-radius: 8px;
          display: grid; place-items: center;
          color: var(--lf-paper); font-weight: 600; font-size: 13px;
          flex-shrink: 0;
        }
        .ds-money-account-row__main { flex: 1; min-width: 0; }
        .ds-money-account-row__name {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px; font-weight: 500;
          color: var(--lf-ink);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ds-money-account-row__meta {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px; letter-spacing: 0.05em;
          color: var(--lf-muted);
          margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ds-money-account-row__balance {
          font-size: 14px; font-weight: 500;
          color: var(--lf-ink);
          flex-shrink: 0;
        }
        .ds-money-account-row__sync {
          width: 36px; height: 36px;
          display: grid; place-items: center;
          border-radius: 8px;
          background: none; border: none;
          color: var(--lf-muted); cursor: pointer;
          flex-shrink: 0;
          transition: background 0.12s, color 0.12s;
        }
        .ds-money-account-row__sync:hover { background: var(--lf-cream); color: var(--lf-ink); }
        .ds-money-account-row__sync:disabled { opacity: 0.5; cursor: not-allowed; }

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
          font-family: 'Instrument Serif', Georgia, serif;
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
  title, eyebrow, total, totalTone, items, filterType, syncing, onSync,
}: {
  title: string;
  eyebrow: string;
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
        <span className={`ds-num ${totalTone === 'neg' ? 'ds-neg' : ''}`} style={{ fontSize: 18, fontWeight: 500 }}>
          {totalTone === 'neg' ? '−' : ''}{fmtUsd(total)}
        </span>
      }
    >
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
          return (
            <div key={acct.id} className="ds-money-account-row">
              <div
                className="ds-money-account-row__badge"
                style={{ background: institutionColor(acct.item.institutionName || '') }}
              >
                {(acct.item.institutionName || '?')[0].toUpperCase()}
              </div>
              <div className="ds-money-account-row__main">
                <div className="ds-money-account-row__name">{titleCase(acct.name)}</div>
                <div className="ds-money-account-row__meta">
                  {acct.item.institutionName || 'Manual'}
                  {acct.subtype && <span> · {titleCase(acct.subtype)}</span>}
                  {acct.mask && <span> · ··{acct.mask}</span>}
                  {acct.item.lastSyncedAt && <span> · {relativeTime(acct.item.lastSyncedAt)}</span>}
                </div>
              </div>
              <span className="ds-money-account-row__balance ds-num">{fmtUsd(Math.abs(bal))}</span>
              <button
                onClick={() => onSync(acct.item.id)}
                disabled={syncing === acct.item.id}
                className="ds-money-account-row__sync"
                title={`Sync ${acct.item.institutionName || ''}`}
                aria-label={`Sync ${acct.item.institutionName || 'account'}`}
              >
                <RefreshCw size={14} className={syncing === acct.item.id ? 'animate-spin' : ''} />
              </button>
            </div>
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

/** Deterministic color from institution name — warm palette for visual distinction. */
const INST_COLORS = ['#8B4A2B', '#5A6B3F', '#6B2420', '#3D7A35', '#C25030', '#1E5C50', '#B87A1E', '#7A5C3F', '#A23F29', '#185248'];
function institutionColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return INST_COLORS[Math.abs(hash) % INST_COLORS.length];
}

function titleCase(raw: string): string {
  return raw.split(/\s+/).map((w) =>
    w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
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

function NetWorthChart({ points, range }: { points: NetWorthPoint[]; range: Range }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
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

  function pointerToIdx(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = 0;
    const { x } = pt.matrixTransform(ctm.inverse());
    const ratio = (x - CHART_M.left) / innerW;
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  }

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const xLabels = useMemo(() => pickXLabels(points, range), [points, range]);

  return (
    <div ref={wrapperRef} className="relative select-none" style={{ color: CHART_COLOR }}>
      <div className="h-7 flex items-baseline justify-end gap-2 px-1 mb-1 tabular-nums" aria-live="polite">
        {hover ? (
          <>
            <span className="text-sm text-text-muted">{new Date(hover.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span className="font-serif text-lg font-medium text-text leading-none">{fmtUsd(hover.value)}</span>
          </>
        ) : <span aria-hidden="true">&nbsp;</span>}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label="Net worth trend chart"
        className="w-full block touch-none"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerMove={(e) => { if (e.pointerType === 'touch' && e.buttons === 0) return; setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerLeave={() => setHoverIdx(null)}
        onPointerUp={() => setHoverIdx(null)}
        onPointerCancel={() => setHoverIdx(null)}
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

