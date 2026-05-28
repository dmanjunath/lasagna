import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/utils';
import { usePageContext } from '../lib/page-context';
import { PageActions } from '../components/common/page-actions';
import {
  Page,
  PageHeader,
  Section,
  Card,
  Button,
  Pill,
  Eyebrow,
  DataTable,
  EmptyState,
  CompositionRibbon,
  StatStrip,
  Lede,
} from '../components/ds';
import type { DataTableColumn } from '../components/ds/DataTable';
import type { CompositionSegment } from '../components/ds/CompositionRibbon';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrencyExact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function startOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function endOfMonth(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}T23:59:59`;
}

// ---------------------------------------------------------------------------
// Category config — LasagnaFi color mapping
// ---------------------------------------------------------------------------

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  income:             { label: 'Income',              icon: '💰', color: 'var(--lf-pos)' },
  housing:            { label: 'Housing',              icon: '🏠', color: 'var(--lf-sauce)' },
  transportation:     { label: 'Transportation',       icon: '🚗', color: 'var(--lf-basil)' },
  food_dining:        { label: 'Dining Out',           icon: '🍽️', color: 'var(--lf-cheese)' },
  groceries:          { label: 'Groceries',            icon: '🛒', color: 'var(--lf-noodle)' },
  utilities:          { label: 'Utilities',            icon: '⚡', color: 'var(--lf-burgundy)' },
  healthcare:         { label: 'Healthcare',           icon: '🏥', color: '#A68965' },
  insurance:          { label: 'Insurance',            icon: '🛡️', color: '#7A5C3F' },
  entertainment:      { label: 'Entertainment',        icon: '🎬', color: 'var(--lf-crust)' },
  shopping:           { label: 'Shopping',             icon: '🛍️', color: 'var(--lf-noodle)' },
  personal_care:      { label: 'Personal Care',        icon: '💇', color: '#B8956A' },
  education:          { label: 'Education',            icon: '📚', color: 'var(--lf-basil)' },
  travel:             { label: 'Travel',               icon: '✈️', color: '#5A7A8A' },
  subscriptions:      { label: 'Subscriptions',        icon: '📱', color: 'var(--lf-crust)' },
  savings_investment: { label: 'Savings & Investment', icon: '📈', color: 'var(--lf-pos)' },
  debt_payment:       { label: 'Debt Payment',         icon: '💳', color: 'var(--lf-sauce)' },
  gifts_donations:    { label: 'Gifts & Donations',    icon: '🎁', color: '#B86A40' },
  taxes:              { label: 'Taxes',                icon: '🏛️', color: 'var(--lf-muted)' },
  transfer:           { label: 'Transfers',            icon: '↔️', color: 'var(--lf-muted)' },
  other:              { label: 'Other',                icon: '📋', color: '#7A5C3F' },
};

function getCategoryDisplay(key: string) {
  return CATEGORY_CONFIG[key] ?? { label: key, icon: '📋', color: '#7A5C3F' };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpendingCategory {
  category: string;
  total: number;
  count: number;
  percentage: number;
}

interface Transaction {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
  category: string;
  accountId: string;
}

interface MonthlyTrendEntry {
  month: string;
  income: number;
  expenses: number;
  net: number;
}

// ---------------------------------------------------------------------------
// DonutMini — inline SVG, no Recharts
// ---------------------------------------------------------------------------

function DonutMini({ cats, total }: { cats: Array<{ name: string; amount: number; color: string }>; total: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const r = 34, R = 52, cx = 60, cy = 60;
  let a0 = -Math.PI / 2;
  const paths = cats.map((c, idx) => {
    const frac = total > 0 ? c.amount / total : 0;
    const a1 = a0 + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
    const x3 = cx + r * Math.cos(a0), y3 = cy + r * Math.sin(a0);
    const d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    a0 = a1;
    return { d, color: c.color, name: c.name, pct: Math.round(frac * 100), idx };
  });
  const hp = hovered !== null ? paths[hovered] : null;
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ cursor: 'pointer' }}>
      {paths.map((p) => (
        <path key={p.idx} d={p.d} fill={p.color}
          opacity={hovered === null ? 1 : hovered === p.idx ? 1 : 0.4}
          style={{ transition: 'opacity 0.15s' }}
          onMouseEnter={() => setHovered(p.idx)}
          onMouseLeave={() => setHovered(null)}
          onTouchStart={() => setHovered(hovered === p.idx ? null : p.idx)}
        />
      ))}
      {hp ? (
        <>
          <text x="60" y="54" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="9" fill="var(--lf-muted)">{hp.name.slice(0, 10)}</text>
          <text x="60" y="66" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="14" fill="var(--lf-ink)">{hp.pct}%</text>
        </>
      ) : (
        <>
          <text x="60" y="58" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="16" fill="var(--lf-ink)">
            {formatMoney(total, true)}
          </text>
          <text x="60" y="72" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9" fill="var(--lf-muted)">
            monthly
          </text>
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page constant
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Spending Page
// ---------------------------------------------------------------------------

export function Spending() {
  const { setPageContext } = usePageContext();

  // Month navigation
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() - 1, 1);
  });

  // Data state
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [totalSpending, setTotalSpending] = useState(0);
  const [totalIncome, setTotalIncome] = useState(0);
  const [netCashFlow, setNetCashFlow] = useState(0);
  const [trendData, setTrendData] = useState<MonthlyTrendEntry[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txPage, setTxPage] = useState(1);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Linked account detection
  const [hasLinkedAccounts, setHasLinkedAccounts] = useState(false);
  const [creditCardTotal, setCreditCardTotal] = useState(0);

  const [showAllCategories, setShowAllCategories] = useState(false);

  // Sync
  const [syncing, setSyncing] = useState(false);

  // Loading
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingTx, setLoadingTx] = useState(true);

  // Refresh counter
  const [refreshKey, setRefreshKey] = useState(0);

  // Inline category editing
  const [editingTxId, setEditingTxId] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Detect linked accounts and credit card balances
  useEffect(() => {
    api.getBalances()
      .then((data) => {
        setHasLinkedAccounts(data.balances.length > 0);
        const ccTotal = data.balances
          .filter((b: { type: string }) => b.type === 'credit')
          .reduce((sum: number, b: { balance: string | null }) => sum + Math.abs(parseFloat(b.balance || '0')), 0);
        setCreditCardTotal(ccTotal);
      })
      .catch(() => {});
  }, []);

  // Fetch spending summary
  useEffect(() => {
    setLoadingSummary(true);
    const sd = startOfMonth(currentMonth);
    const ed = endOfMonth(currentMonth);
    api.getSpendingSummary({ startDate: sd, endDate: ed })
      .then((data) => {
        setCategories(data.categories);
        setTotalSpending(data.totalSpending);
        setTotalIncome(data.totalIncome);
        setNetCashFlow(data.netCashFlow);
      })
      .catch(() => {
        setCategories([]);
        setTotalSpending(0);
        setTotalIncome(0);
        setNetCashFlow(0);
      })
      .finally(() => setLoadingSummary(false));
  }, [currentMonth, refreshKey]);

  // Fetch monthly trend (only once) — kept for last-month delta calc
  useEffect(() => {
    api.getMonthlyTrend()
      .then((data) => setTrendData(data.months))
      .catch(() => setTrendData([]));
  }, []);

  // Fetch transactions
  useEffect(() => {
    setLoadingTx(true);
    const sd = startOfMonth(currentMonth);
    const ed = endOfMonth(currentMonth);
    api.getTransactions({
      page: txPage,
      limit: PAGE_SIZE,
      category: selectedCategory || undefined,
      startDate: sd,
      endDate: ed,
      search: debouncedSearch || undefined,
    })
      .then((data) => {
        setTransactions(data.transactions);
        setTxTotal(data.total);
      })
      .catch(() => {
        setTransactions([]);
        setTxTotal(0);
      })
      .finally(() => setLoadingTx(false));
  }, [currentMonth, txPage, selectedCategory, debouncedSearch, refreshKey]);

  // Page context for chat
  useEffect(() => {
    setPageContext({
      pageId: 'spending',
      pageTitle: 'Spending',
      description: 'Monthly spending breakdown, category analysis, and transaction history.',
    });
  }, [setPageContext]);

  // Derived
  const totalPages = Math.max(1, Math.ceil(txTotal / PAGE_SIZE));

  const savingsRate = totalIncome > 0 ? Math.max(0, ((totalIncome - totalSpending) / totalIncome) * 100) : null;

  const prevMonth = useCallback(() => {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    setTxPage(1);
  }, []);
  const nextMonth = useCallback(() => {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    setTxPage(1);
  }, []);

  const spendingCategories = useMemo(
    () => categories.filter((c) => c.category !== 'income' && c.category !== 'transfer'),
    [categories],
  );

  // DonutMini data — LasagnaFi color mapping
  const donutCats = useMemo(
    () =>
      spendingCategories.map((c) => ({
        name: c.category,
        amount: Math.abs(c.total),
        color: getCategoryDisplay(c.category).color,
      })),
    [spendingCategories],
  );
  const donutTotal = useMemo(
    () => donutCats.reduce((s, c) => s + c.amount, 0),
    [donutCats],
  );

  // Composition segments — top 5 + Other
  const compositionSegments = useMemo<CompositionSegment[]>(() => {
    if (spendingCategories.length === 0) return [];
    const sorted = [...spendingCategories]
      .map((c) => ({ ...c, abs: Math.abs(c.total) }))
      .sort((a, b) => b.abs - a.abs);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const segs: CompositionSegment[] = top.map((c) => {
      const d = getCategoryDisplay(c.category);
      return { label: d.label, value: c.abs, color: d.color };
    });
    if (rest.length > 0) {
      const otherTotal = rest.reduce((s, c) => s + c.abs, 0);
      if (otherTotal > 0) {
        segs.push({ label: 'Other', value: otherTotal, color: 'var(--lf-muted)' });
      }
    }
    return segs;
  }, [spendingCategories]);

  // Top category (for lede)
  const topCategoryLabel = useMemo(() => {
    if (spendingCategories.length === 0) return null;
    const top = [...spendingCategories].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))[0];
    return top ? getCategoryDisplay(top.category).label : null;
  }, [spendingCategories]);

  // Previous-month spending (for Δ%) — from monthly trend if present, fallback to current
  const lastMonthDelta = useMemo(() => {
    if (trendData.length < 2 || totalSpending === 0) return null;
    // Find current month's index by YYYY-MM key
    const key = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    const idx = trendData.findIndex((t) => t.month === key);
    if (idx < 1) return null;
    const prior = trendData[idx - 1];
    if (!prior || prior.expenses === 0) return null;
    const pct = ((totalSpending - prior.expenses) / prior.expenses) * 100;
    return Math.round(pct);
  }, [trendData, totalSpending, currentMonth]);

  // Month nav controls (used in PageHeader actions)
  const monthNav = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Button variant="icon" onClick={prevMonth} aria-label="Previous month">
        <ChevronLeft size={14} />
      </Button>
      <Button variant="icon" onClick={nextMonth} aria-label="Next month">
        <ChevronRight size={14} />
      </Button>
      {import.meta.env.VITE_DEMO_MODE !== 'true' && (
        <Button
          variant="ghost"
          size="sm"
          disabled={syncing}
          onClick={async () => {
            setSyncing(true);
            await api.triggerSync().catch(console.error);
            setTimeout(() => { loadData(); setSyncing(false); }, 3000);
          }}
          icon={<RefreshCw size={12} style={syncing ? { animation: 'spin 1s linear infinite' } : undefined} />}
          aria-label={syncing ? 'Syncing' : 'Sync'}
        >
          <span className="spend-sync-label">{syncing ? 'Syncing…' : 'Sync'}</span>
        </Button>
      )}
    </div>
  );

  // Transaction table columns
  // S1 — Merchant | Amount | Category. Date hidden on mobile. Merchant wraps,
  // amount right-aligned and never truncated.
  const txColumns: DataTableColumn<Transaction>[] = [
    {
      key: 'merchant',
      header: 'Merchant',
      className: 'td--wrap',
      cell: (tx) => {
        const display = getCategoryDisplay(tx.category);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{
              width: 4, height: 24, borderRadius: 2, flexShrink: 0,
              background: display.color,
            }} />
            <span style={{
              color: 'var(--lf-ink)', fontWeight: 500,
              wordBreak: 'break-word',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {tx.merchantName || tx.name}
            </span>
          </div>
        );
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      num: true,
      className: 'tx-col-amount',
      cell: (tx) => {
        const amount = parseFloat(tx.amount);
        const isIncome = amount < 0;
        return (
          <span className={`ds-num ${isIncome ? 'ds-pos' : ''}`} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {isIncome ? '+' : ''}{formatCurrencyExact(Math.abs(amount))}
          </span>
        );
      },
    },
    {
      key: 'date',
      header: 'Date',
      muted: true,
      className: 'hidden md:table-cell',
      cell: (tx) => (
        <span className="ds-num">
          {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (tx) => {
        const display = getCategoryDisplay(tx.category);
        const isEditing = editingTxId === tx.id;
        if (isEditing) {
          return (
            <select
              autoFocus
              value={tx.category}
              onBlur={() => setEditingTxId(null)}
              onChange={async (e) => {
                const newCat = e.target.value;
                setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, category: newCat } : t));
                setEditingTxId(null);
                await api.updateTransactionCategory(tx.id, newCat).catch(console.error);
                setRefreshKey(k => k + 1);
              }}
              style={{
                height: 28, padding: '0 6px', borderRadius: 6,
                border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
                color: 'var(--lf-ink)', fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer',
              }}
            >
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          );
        }
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setEditingTxId(tx.id); }}
            title="Click to recategorize"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <Pill tone="cream">{display.label}</Pill>
          </button>
        );
      },
    },
  ];

  // Filter controls in the transactions section header
  // S2 — stack vertically on mobile; search input shouldn't clip.
  const txFilterControls = (
    <div className="spend-filters">
      <select
        value={selectedCategory || ''}
        onChange={(e) => { setSelectedCategory(e.target.value || null); setTxPage(1); }}
        className="spend-filters__select"
      >
        <option value="">All categories</option>
        {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
          <option key={key} value={key}>{cfg.label}</option>
        ))}
      </select>

      <div className="spend-filters__search">
        <Search
          size={12}
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--lf-muted)', pointerEvents: 'none' }}
        />
        <input
          type="text"
          placeholder="Search merchants…"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setTxPage(1); }}
          className="spend-filters__input"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--lf-muted)', background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );

  const deltaSign = lastMonthDelta !== null ? (lastMonthDelta >= 0 ? '↑' : '↓') : null;

  return (
    <Page>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spend-by-cat {
          display: grid;
          grid-template-columns: 1fr;
          gap: 24px;
          align-items: flex-start;
        }
        @media (min-width: 720px) {
          .spend-by-cat { grid-template-columns: 140px minmax(0, 1fr); gap: 32px; }
        }
        .spend-strip { margin: 32px 0 48px; }

        /* S2 — filter row stacks vertically on mobile */
        .spend-filters {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: stretch;
          width: 100%;
        }
        @media (min-width: 768px) {
          .spend-filters {
            flex-direction: row;
            align-items: center;
            width: auto;
          }
        }
        .spend-filters__select {
          height: 36px;
          padding: 0 10px;
          border-radius: 6px;
          border: 1px solid var(--lf-rule);
          background: var(--lf-paper);
          color: var(--lf-ink);
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
          cursor: pointer;
          appearance: none;
          width: 100%;
        }
        @media (min-width: 768px) {
          .spend-filters__select { width: auto; height: 32px; font-size: 12px; }
        }
        .spend-filters__search {
          position: relative;
          width: 100%;
        }
        .spend-filters__input {
          height: 36px;
          padding: 0 30px 0 28px;
          border-radius: 6px;
          border: 1px solid var(--lf-rule);
          background: var(--lf-paper);
          color: var(--lf-ink);
          font-size: 13px;
          width: 100%;
          font-family: 'JetBrains Mono', monospace;
          outline: none;
          box-sizing: border-box;
        }
        @media (min-width: 768px) {
          .spend-filters__input { height: 32px; font-size: 12px; max-width: 220px; min-width: 140px; }
        }

        /* S3 — hide Sync label on mobile, icon only */
        @media (max-width: 767px) {
          .spend-sync-label {
            position: absolute;
            width: 1px; height: 1px;
            padding: 0; margin: -1px;
            overflow: hidden; clip: rect(0,0,0,0);
            white-space: nowrap; border: 0;
          }
        }

        /* S5 — 44×44 pagination chips */
        .spend-page-btn {
          min-width: 44px;
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: 1px solid var(--lf-rule);
          border-radius: 8px;
          color: var(--lf-ink);
          cursor: pointer;
          padding: 0;
          transition: background 0.12s, border-color 0.12s;
        }
        .spend-page-btn:hover:not(:disabled) {
          background: var(--lf-cream);
          border-color: var(--lf-ink);
        }
        .spend-page-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
      `}</style>

      <PageHeader
        eyebrow={monthLabel(currentMonth).toUpperCase()}
        title="Spending"
        actions={monthNav}
      />

      {/* Editorial lede */}
      {!loadingSummary && (
        <div style={{ marginBottom: 8 }}>
          <Lede>
            You spent{' '}
            <Lede.Num tone={totalSpending > 0 ? 'neg' : 'default'}>{formatCurrency(totalSpending)}</Lede.Num>
            {' '}in {monthLabel(currentMonth)}
            {lastMonthDelta !== null && (
              <>
                {' — '}
                <Lede.Num tone={lastMonthDelta <= 0 ? 'pos' : 'neg'}>
                  {deltaSign} {Math.abs(lastMonthDelta)}%
                </Lede.Num>
                {' '}vs last month
              </>
            )}
            .
            {topCategoryLabel && (
              <>
                {' '}<Lede.Num highlight>{topCategoryLabel}</Lede.Num> was your biggest line.
              </>
            )}
          </Lede>
        </div>
      )}

      {/* Composition ribbon */}
      {!loadingSummary && compositionSegments.length > 0 && (
        <Section>
          <CompositionRibbon
            leadLabel="By category"
            leadValue={formatCurrency(totalSpending)}
            leadDelta={`${spendingCategories.length} categories`}
            segments={compositionSegments}
          />
        </Section>
      )}

      {/* Stat strip */}
      {!loadingSummary && (
        <StatStrip
          className="spend-strip"
          items={[
            { label: 'Spent', value: <span className="ds-num">{formatCurrency(totalSpending)}</span>, sub: monthLabel(currentMonth) },
            { label: 'Income', value: <span className="ds-num">{formatCurrency(totalIncome)}</span>, sub: 'this month' },
            {
              label: 'Net flow',
              value: <span className="ds-num">{netCashFlow >= 0 ? '+' : ''}{formatCurrency(netCashFlow)}</span>,
              sub: netCashFlow >= 0 ? 'surplus' : 'deficit',
              tone: netCashFlow >= 0 ? 'pos' : 'neg',
            },
            {
              label: 'Savings rate',
              value: <span className="ds-num">{savingsRate !== null ? `${savingsRate.toFixed(0)}%` : '—'}</span>,
              sub: 'of income',
            },
          ]}
        />
      )}

      {/* Behavioral / spending insights */}
      <Section>
        <PageActions types={['spending', 'behavioral']} />
      </Section>

      {/* No-data state for users with linked accounts but no transactions */}
      {!loadingSummary && totalSpending === 0 && totalIncome === 0 && hasLinkedAccounts && (
        <Section>
          <Card>
            <Eyebrow>Estimated</Eyebrow>
            <h3 className="ds-h3" style={{ marginTop: 6 }}>Transaction sync coming soon</h3>
            <p className="ds-body" style={{ marginTop: 8 }}>
              For now, your monthly expenses are estimated from your credit card balances.
            </p>
            {creditCardTotal > 0 && (
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <Eyebrow>Est. monthly spend</Eyebrow>
                <span className="ds-h3 ds-num" style={{ color: 'var(--lf-sauce)' }}>
                  {formatCurrency(creditCardTotal)}
                </span>
              </div>
            )}
          </Card>
        </Section>
      )}

      {/* By category */}
      {!loadingSummary && spendingCategories.length > 0 && (
        <Section title="By category" eyebrow="Breakdown">
          <Card>
            <div className="spend-by-cat">
              <div>
                <DonutMini cats={donutCats} total={donutTotal} />
              </div>
              <div style={{ minWidth: 0 }}>
                {(() => {
                  const visible = showAllCategories ? spendingCategories : spendingCategories.slice(0, 6);
                  const hiddenCount = spendingCategories.length - 6;
                  const showMore = !showAllCategories && hiddenCount > 0;
                  return visible.map((cat, idx) => {
                    const display = getCategoryDisplay(cat.category);
                    const isSelected = selectedCategory === cat.category;
                    const isLast = idx === visible.length - 1;
                    return (
                      <div
                        key={cat.category}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          borderTop: '1px solid var(--lf-rule)',
                        }}
                      >
                        <button
                          onClick={() => setSelectedCategory(isSelected ? null : cat.category)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            flex: 1, minWidth: 0, padding: '10px 0',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer', textAlign: 'left',
                            fontFamily: 'inherit',
                            color: isSelected ? 'var(--lf-sauce)' : 'inherit',
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: display.color }} />
                          <span style={{ flex: 1, fontSize: 14, color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {display.label}
                          </span>
                          <span className="ds-num" style={{ fontSize: 13, color: 'var(--lf-ink-soft)', flexShrink: 0 }}>
                            {formatCurrency(Math.abs(cat.total))}
                          </span>
                          <span className="ds-num" style={{ fontSize: 12, color: 'var(--lf-muted)', flexShrink: 0, marginLeft: 4, minWidth: 36, textAlign: 'right' }}>
                            {cat.percentage.toFixed(0)}%
                          </span>
                        </button>
                        {isLast && (showMore || showAllCategories) && (
                          <Button variant="link" size="sm" onClick={() => setShowAllCategories((v) => !v)}>
                            {showAllCategories ? 'Show less' : `+${hiddenCount} more`}
                          </Button>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </Card>
        </Section>
      )}

      {/* Recent transactions */}
      <Section
        title="Recent transactions"
        eyebrow={txTotal > 0 ? `${txTotal} total` : undefined}
        actions={txFilterControls}
      >
        {(selectedCategory || debouncedSearch) && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {selectedCategory && (
              <Pill tone="cream">
                {getCategoryDisplay(selectedCategory).label}
                <button onClick={() => setSelectedCategory(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', marginLeft: 4, padding: 0 }}>
                  <X size={10} />
                </button>
              </Pill>
            )}
            {debouncedSearch && (
              <Pill tone="cream">
                &ldquo;{debouncedSearch}&rdquo;
                <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', marginLeft: 4, padding: 0 }}>
                  <X size={10} />
                </button>
              </Pill>
            )}
          </div>
        )}

        <Card flush>
          {loadingTx ? (
            <div className="ds-caption" style={{ padding: '32px 16px', textAlign: 'center' }}>Loading…</div>
          ) : transactions.length === 0 ? (
            <EmptyState title="No transactions found" body="Try adjusting your filters or month." />
          ) : (
            <DataTable
              columns={txColumns}
              rows={transactions}
              rowKey={(t) => t.id}
              hover
            />
          )}

          {txTotal > PAGE_SIZE && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', borderTop: '1px solid var(--lf-rule)',
            }}>
              <Eyebrow>
                {(txPage - 1) * PAGE_SIZE + 1}&ndash;{Math.min(txPage * PAGE_SIZE, txTotal)} of {txTotal}
              </Eyebrow>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="spend-page-btn"
                  onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                  disabled={txPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="ds-num" style={{ minWidth: 60, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--lf-muted)' }}>
                  {txPage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="spend-page-btn"
                  onClick={() => setTxPage((p) => Math.min(totalPages, p + 1))}
                  disabled={txPage >= totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </Card>
      </Section>
    </Page>
  );
}
