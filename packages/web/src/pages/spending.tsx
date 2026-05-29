import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { PageActions } from '../components/common/page-actions';
import {
  Page,
  Section,
  Card,
  Button,
  Pill,
  Eyebrow,
  EmptyState,
  StatStrip,
  TransactionRow,
  PageSubToolbar,
  SkeletonRow,
} from '../components/ds';

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

// Category label + icon are semantic; category color is assigned at render
// time from the data palette so the donut + legend never look like one
// orange blob. (Iter 3 critic: sauce dominated every chart.)
const CATEGORY_CONFIG: Record<string, { label: string; icon: string }> = {
  income:             { label: 'Income',              icon: '💰' },
  housing:            { label: 'Housing',             icon: '🏠' },
  transportation:     { label: 'Transportation',      icon: '🚗' },
  food_dining:        { label: 'Dining Out',          icon: '🍽️' },
  groceries:          { label: 'Groceries',           icon: '🛒' },
  utilities:          { label: 'Utilities',           icon: '⚡' },
  healthcare:         { label: 'Healthcare',          icon: '🏥' },
  insurance:          { label: 'Insurance',           icon: '🛡️' },
  entertainment:      { label: 'Entertainment',       icon: '🎬' },
  shopping:           { label: 'Shopping',            icon: '🛍️' },
  personal_care:      { label: 'Personal Care',       icon: '💇' },
  education:          { label: 'Education',           icon: '📚' },
  travel:             { label: 'Travel',              icon: '✈️' },
  subscriptions:      { label: 'Subscriptions',       icon: '📱' },
  savings_investment: { label: 'Savings & Investment', icon: '📈' },
  debt_payment:       { label: 'Debt Payment',        icon: '💳' },
  gifts_donations:    { label: 'Gifts & Donations',   icon: '🎁' },
  taxes:              { label: 'Taxes',               icon: '🏛️' },
  transfer:           { label: 'Transfers',           icon: '↔️' },
  other:              { label: 'Other',               icon: '📋' },
};

// Sauce-free warm-neutral palette for spending categories. Order matches
// CompositionRibbon's DISTINCT_PALETTE so the look is consistent across
// pages.
const DATA_PALETTE = [
  'var(--lf-data-1)',
  'var(--lf-data-2)',
  'var(--lf-data-3)',
  'var(--lf-data-4)',
  'var(--lf-data-5)',
  'var(--lf-muted)',
  'var(--lf-ink-soft)',
  'var(--lf-crust)',
];

function getCategoryDisplay(key: string) {
  return CATEGORY_CONFIG[key] ?? { label: key, icon: '📋' };
}
function colorForIndex(i: number): string {
  return DATA_PALETTE[i % DATA_PALETTE.length];
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

function DonutMini({
  cats,
  total,
  onHoverChange,
  hovered: hoveredProp,
  fmtAmount,
}: {
  cats: Array<{ name: string; amount: number; color: string; label?: string }>;
  total: number;
  onHoverChange?: (i: number | null) => void;
  hovered?: number | null;
  fmtAmount?: (n: number) => string;
}) {
  const [hoveredLocal, setHoveredLocal] = useState<number | null>(null);
  // Allow parent to control hover (so legend row hover dims donut too).
  const hovered = hoveredProp !== undefined ? hoveredProp : hoveredLocal;
  const setHovered = (i: number | null) => {
    setHoveredLocal(i);
    onHoverChange?.(i);
  };
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
    return { d, color: c.color, name: c.name, label: c.label ?? c.name, amount: c.amount, pct: Math.round(frac * 100), idx };
  });
  const hp = hovered !== null && hovered >= 0 && hovered < paths.length ? paths[hovered] : null;
  return (
    <div style={{ position: 'relative' }} data-testid="spending-donut-wrap">
      <svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet" style={{ cursor: 'pointer', width: '100%', height: '100%', display: 'block' }} data-testid="spending-donut">
        {paths.map((p) => (
          <path key={p.idx} d={p.d} fill={p.color}
            opacity={hovered === null ? 1 : hovered === p.idx ? 1 : 0.4}
            style={{ transition: 'opacity 0.15s' }}
            onMouseEnter={() => setHovered(p.idx)}
            onMouseLeave={() => setHovered(null)}
            onTouchStart={() => setHovered(hovered === p.idx ? null : p.idx)}
            data-slice-idx={p.idx}
          />
        ))}
        {hp && (
          <>
            <text x="60" y="58" textAnchor="middle" fontFamily="Geist, system-ui, sans-serif" fontWeight="600" fontSize="5" letterSpacing="0.06em" fill="var(--lf-muted)">{hp.label.slice(0, 14).toUpperCase()}</text>
            <text x="60" y="70" textAnchor="middle" fontFamily="Geist, system-ui, sans-serif" fontWeight="600" fontSize="9" fill="var(--lf-ink)">{hp.pct}%</text>
          </>
        )}
      </svg>
      {hp && (
        <div
          data-chart-hover="pill"
          style={{
            position: 'absolute',
            left: '50%',
            top: -6,
            transform: 'translate(-50%, -100%)',
            padding: '6px 10px',
            background: 'var(--lf-ink)',
            color: 'var(--lf-paper)',
            borderRadius: 6,
            boxShadow: '0 2px 10px rgba(31,26,22,0.18)',
            fontFamily: 'Geist, system-ui, sans-serif',
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            zIndex: 5,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            {fmtAmount ? fmtAmount(hp.amount) : hp.amount.toLocaleString()}
          </span>
          <span style={{ fontSize: 10, opacity: 0.7, lineHeight: 1.3 }}>
            {hp.label} · {hp.pct}%
          </span>
        </div>
      )}
    </div>
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

  // Donut hover index (kept in parent so legend rows can also drive it).
  const [donutHover, setDonutHover] = useState<number | null>(null);

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

  // DonutMini data — sauce-free data palette, color assigned by SORTED
  // position so the largest slice always gets the same hue across renders
  // (instead of varying with category ordering from the API).
  // Iter 5: bin sub-5% categories into a single "Other" slice. The previous
  // version drew 4-5 unreadable 1-3px arcs at the tail; collapsing them into
  // one slice keeps the donut scannable while preserving 100% of the total.
  // Iter 6: donutCats also drives the legend. Each entry carries its display
  // label (via getCategoryDisplay) and, for the "Other" bin, the list of
  // tail categories that were rolled in so the legend can show them as
  // fine print under the row.
  const donutCats = useMemo(() => {
    const sorted = [...spendingCategories].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    const total = sorted.reduce((s, c) => s + Math.abs(c.total), 0);
    if (total <= 0) {
      return sorted.map((c, i) => ({
        name: c.category,
        label: getCategoryDisplay(c.category).label,
        amount: Math.abs(c.total),
        color: colorForIndex(i),
        children: [] as Array<{ name: string; label: string; amount: number }>,
      }));
    }
    const SMALL_THRESHOLD = 0.05; // 5% of total
    const big: typeof sorted = [];
    const small: typeof sorted = [];
    for (const c of sorted) {
      if (Math.abs(c.total) / total >= SMALL_THRESHOLD) big.push(c);
      else small.push(c);
    }
    const bigSlices = big.map((c, i) => ({
      name: c.category,
      label: getCategoryDisplay(c.category).label,
      amount: Math.abs(c.total),
      color: colorForIndex(i),
      children: [] as Array<{ name: string; label: string; amount: number }>,
    }));
    if (small.length >= 2) {
      const otherTotal = small.reduce((s, c) => s + Math.abs(c.total), 0);
      // Iter 7 E: the existing "Other" CATEGORY (lit. `other` in
      // CATEGORY_CONFIG) can coexist as a >5% slice. Naming the tail-bin
      // "Other" too produces two "Other" rows in the legend with different
      // meanings. Rename the tail-bin to "Smaller categories" so it reads
      // as the long-tail aggregate it is.
      bigSlices.push({
        name: '__tailbin__',
        label: 'Smaller categories',
        amount: otherTotal,
        color: 'var(--lf-muted)',
        children: small.map((c) => ({
          name: c.category,
          label: getCategoryDisplay(c.category).label,
          amount: Math.abs(c.total),
        })),
      });
    } else if (small.length === 1) {
      bigSlices.push({
        name: small[0].category,
        label: getCategoryDisplay(small[0].category).label,
        amount: Math.abs(small[0].total),
        color: colorForIndex(bigSlices.length),
        children: [],
      });
    }
    return bigSlices;
  }, [spendingCategories]);
  const donutTotal = useMemo(
    () => donutCats.reduce((s, c) => s + c.amount, 0),
    [donutCats],
  );

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

  // Inline category editor — shown in TransactionRow's `extra` slot when the
  // row's category chip is clicked. Returns a hidden node when not editing.
  function categoryEditorFor(tx: Transaction) {
    if (editingTxId !== tx.id) return null;
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
          height: 24, padding: '0 6px', borderRadius: 4,
          border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
          color: 'var(--lf-ink)', fontSize: 11,
          fontFamily: 'inherit', cursor: 'pointer',
          marginLeft: 6,
        }}
      >
        {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
          <option key={key} value={key}>{cfg.label}</option>
        ))}
      </select>
    );
  }

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
          align-items: center;
        }
        /* Desktop (>= 900px): donut left, list right, ~50/50. Tablet
           (720–899px) and mobile stack into a single column. */
        @media (min-width: 900px) {
          .spend-by-cat { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; }
        }
        .spend-by-cat__donut {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
        }
        .spend-by-cat__donut svg {
          width: 100%;
          height: auto;
          max-width: 360px;
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

      {/* Page-bar locked to single row + single action. Month-nav & sync
          move to the sub-toolbar — too many controls in the masthead was the
          iter 2 P1. */}
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">
            {loadingSummary
              ? `Spending — ${monthLabel(currentMonth)}`
              : `${monthLabel(currentMonth)} spent ${formatCurrency(totalSpending)}`}
          </h1>
          {!loadingSummary && (
            <span className="ds-page-bar__caption ds-num">
              {lastMonthDelta !== null && (
                <span className={lastMonthDelta <= 0 ? 'ds-pos' : 'ds-neg'}>
                  {deltaSign} {Math.abs(lastMonthDelta)}% vs last month
                </span>
              )}
              {topCategoryLabel && (
                <>
                  {lastMonthDelta !== null ? '  ·  ' : ''}
                  Top: {topCategoryLabel}
                </>
              )}
            </span>
          )}
        </div>
      </header>
      <PageSubToolbar left={monthNav} />


      {/* Composition ribbon removed — for long-tail spending data the
          pie/donut chart in the "By category" section below reads more
          clearly than a proportional bar (per the Two-charts-back-to-back
          rule, and the user's preference: pie for long-tail composition,
          ribbon for short-tail like net-worth class buckets). */}

      {/* Stat strip — `ds-strip--money` opts in to right-aligned tabular
          values so the rightmost cell shares its right edge with the
          TransactionRow values below (iter 5 $ alignment). */}
      {!loadingSummary && (
        <StatStrip
          className="spend-strip ds-strip--money"
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
        <Section title="By category" eyebrow="breakdown">
          <Card>
            <div className="spend-by-cat">
              <div className="spend-by-cat__donut">
                <DonutMini
                  cats={donutCats}
                  total={donutTotal}
                  hovered={donutHover}
                  onHoverChange={setDonutHover}
                  fmtAmount={formatCurrency}
                />
              </div>
              <div style={{ minWidth: 0 }}>
                {/* Iter 6: legend now mirrors the donut slices (binned) so the
                    rows + donut count stays in sync. Tail categories under the
                    5% threshold roll into a single "Other" entry whose
                    children are listed as fine print. No more "+N more". */}
                {donutCats.map((cat, idx) => {
                  const pct = donutTotal > 0 ? (cat.amount / donutTotal) * 100 : 0;
                  // For named categories: clicking filters tx list to that category.
                  // For the tail-bin: clicking just emits a no-op (tail is heterogeneous).
                  const isOther = cat.name === '__tailbin__';
                  const isSelected = !isOther && selectedCategory === cat.name;
                  const dimmed = donutHover !== null && donutHover !== idx;
                  return (
                    <div
                      key={cat.name}
                      style={{
                        display: 'flex', flexDirection: 'column',
                        borderTop: '1px solid var(--lf-rule)',
                        opacity: dimmed ? 0.5 : 1,
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={() => setDonutHover(idx)}
                      onMouseLeave={() => setDonutHover(null)}
                    >
                      <button
                        onClick={
                          isOther
                            ? undefined
                            : () => setSelectedCategory(isSelected ? null : cat.name)
                        }
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          flex: 1, minWidth: 0, padding: '10px 0',
                          background: 'transparent',
                          border: 'none',
                          cursor: isOther ? 'default' : 'pointer',
                          textAlign: 'left',
                          fontFamily: 'inherit',
                          color: isSelected ? 'var(--lf-sauce)' : 'inherit',
                        }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: cat.color }} />
                        <span style={{ flex: 1, fontSize: 14, color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cat.label}
                        </span>
                        <span className="ds-num" style={{ fontSize: 13, color: 'var(--lf-ink-soft)', flexShrink: 0 }}>
                          {formatCurrency(cat.amount)}
                        </span>
                        <span className="ds-num" style={{ fontSize: 12, color: 'var(--lf-muted)', flexShrink: 0, marginLeft: 4, minWidth: 36, textAlign: 'right' }}>
                          {pct.toFixed(0)}%
                        </span>
                      </button>
                      {isOther && cat.children.length > 0 && (
                        <div style={{
                          fontSize: 11, color: 'var(--lf-muted)', paddingLeft: 18, paddingBottom: 8,
                          lineHeight: 1.5,
                        }}>
                          {cat.children.map((c, j) => (
                            <span key={c.name}>
                              {c.label} {formatCurrency(c.amount)}
                              {j < cat.children.length - 1 ? ' · ' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
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
            // Iter 7 D: matched-outline skeleton so the tx table reserves
            // its space at first paint instead of collapsing into a single
            // "Loading…" line that then jumps to 8 rows tall.
            <div>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState title="No transactions found" body="Try adjusting your filters or month." />
          ) : (
            <div>
              {transactions.map((tx) => {
                const amount = parseFloat(tx.amount);
                const display = getCategoryDisplay(tx.category);
                const editor = categoryEditorFor(tx);
                const categoryNode = editor ?? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingTxId(tx.id); }}
                    title="Click to recategorize"
                    style={{
                      background: 'none', border: 'none', padding: 0,
                      cursor: 'pointer', font: 'inherit', color: 'inherit',
                      letterSpacing: 'inherit',
                    }}
                  >
                    {display.label}
                  </button>
                );
                return (
                  <TransactionRow
                    key={tx.id}
                    merchant={tx.merchantName || tx.name}
                    category={categoryNode}
                    date={tx.date}
                    amount={amount}
                    formatAmount={formatCurrencyExact}
                  />
                );
              })}
            </div>
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
