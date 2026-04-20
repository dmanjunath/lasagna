import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { PageActions } from '../components/common/page-actions';

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
  income:             { label: 'Income',              icon: '\uD83D\uDCB0', color: 'var(--lf-pos)' },
  housing:            { label: 'Housing',              icon: '\uD83C\uDFE0', color: 'var(--lf-sauce)' },
  transportation:     { label: 'Transportation',       icon: '\uD83D\uDE97', color: 'var(--lf-basil)' },
  food_dining:        { label: 'Dining Out',           icon: '\uD83C\uDF7D\uFE0F', color: 'var(--lf-cheese)' },
  groceries:          { label: 'Groceries',            icon: '\uD83D\uDED2', color: 'var(--lf-noodle)' },
  utilities:          { label: 'Utilities',            icon: '\u26A1', color: 'var(--lf-burgundy)' },
  healthcare:         { label: 'Healthcare',           icon: '\uD83C\uDFE5', color: '#A68965' },
  insurance:          { label: 'Insurance',            icon: '\uD83D\uDEE1\uFE0F', color: '#7A5C3F' },
  entertainment:      { label: 'Entertainment',        icon: '\uD83C\uDFAC', color: 'var(--lf-crust)' },
  shopping:           { label: 'Shopping',             icon: '\uD83D\uDECD\uFE0F', color: 'var(--lf-noodle)' },
  personal_care:      { label: 'Personal Care',        icon: '\uD83D\uDC87', color: '#B8956A' },
  education:          { label: 'Education',            icon: '\uD83D\uDCDA', color: 'var(--lf-basil)' },
  travel:             { label: 'Travel',               icon: '\u2708\uFE0F', color: '#5A7A8A' },
  subscriptions:      { label: 'Subscriptions',        icon: '\uD83D\uDCF1', color: 'var(--lf-crust)' },
  savings_investment: { label: 'Savings & Investment', icon: '\uD83D\uDCC8', color: 'var(--lf-pos)' },
  debt_payment:       { label: 'Debt Payment',         icon: '\uD83D\uDCB3', color: 'var(--lf-sauce)' },
  gifts_donations:    { label: 'Gifts & Donations',    icon: '\uD83C\uDF81', color: '#B86A40' },
  taxes:              { label: 'Taxes',                icon: '\uD83C\uDFDB\uFE0F', color: 'var(--lf-muted)' },
  transfer:           { label: 'Transfers',            icon: '\u2194\uFE0F', color: 'var(--lf-muted)' },
  other:              { label: 'Other',                icon: '\uD83D\uDCCB', color: '#7A5C3F' },
};

function getCategoryDisplay(key: string) {
  return CATEGORY_CONFIG[key] ?? { label: key, icon: '\uD83D\uDCCB', color: '#7A5C3F' };
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
            ${(total / 1000).toFixed(1)}k
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
// TrendBarChart — inline SVG 6-month bar chart (income vs expenses)
// ---------------------------------------------------------------------------

const MONTH_ABBREVS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthAbbrev(m: string): string {
  const parts = m.split('-');
  if (parts.length === 2) {
    const idx = parseInt(parts[1], 10) - 1;
    return MONTH_ABBREVS[idx] ?? m.slice(0, 3);
  }
  return m.slice(0, 3);
}

function TrendBarChart({ data }: { data: MonthlyTrendEntry[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const slice = data.slice(-6);
  if (slice.length === 0) return null;

  const maxVal = Math.max(...slice.flatMap((d) => [d.income, d.expenses]), 1);
  const chartH = 120;
  const barW = 10;
  const gap = 4;
  const groupW = barW * 2 + gap + 40;
  const yAxisW = 36;
  const totalW = groupW * slice.length + yAxisW;
  const fmtK = (v: number) => `$${(v / 1000).toFixed(1)}k`;

  // Y-axis ticks: 0, 50%, 100% of max
  const yTicks = [0, 0.5, 1].map(pct => ({ pct, val: maxVal * pct, y: chartH - pct * chartH }));

  return (
    <svg width="100%" viewBox={`0 0 ${totalW} ${chartH + 24 + (hovered !== null ? 38 : 0)}`} style={{ overflow: 'visible' }}>
      {/* Y-axis labels */}
      {yTicks.map(({ pct, val, y }) => (
        <g key={pct}>
          <line x1={yAxisW - 4} y1={y} x2={totalW} y2={y} stroke="var(--lf-rule)" strokeWidth={0.5} strokeDasharray="3 3" />
          <text x={yAxisW - 6} y={y + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="var(--lf-muted)">
            {fmtK(val)}
          </text>
        </g>
      ))}
      {slice.map((d, i) => {
        const incomeH = (d.income / maxVal) * chartH;
        const expH = (d.expenses / maxVal) * chartH;
        const gx = i * groupW + yAxisW;
        const labelX = gx + groupW / 2 - 2;
        const isHov = hovered === i;
        return (
          <g key={d.month}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onTouchStart={() => setHovered(hovered === i ? null : i)}
            style={{ cursor: 'pointer' }}
          >
            {/* Hover hit area */}
            <rect x={gx - 4} y={0} width={groupW} height={chartH + 24} fill="transparent" />
            {/* Income bar */}
            <rect
              x={gx}
              y={chartH - incomeH}
              width={barW}
              height={incomeH}
              rx={3}
              fill="var(--lf-pos)"
              opacity={isHov ? 1 : 0.85}
              style={{ transition: 'opacity 0.15s' }}
            />
            {/* Expense bar */}
            <rect
              x={gx + barW + gap}
              y={chartH - expH}
              width={barW}
              height={expH}
              rx={3}
              fill="var(--lf-sauce)"
              opacity={isHov ? 1 : 0.85}
              style={{ transition: 'opacity 0.15s' }}
            />
            {/* Month label */}
            <text
              x={labelX}
              y={chartH + 17}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
              fontSize={10}
              fill={isHov ? 'var(--lf-ink)' : 'var(--lf-muted)'}
            >
              {monthAbbrev(d.month)}
            </text>
            {/* Tooltip */}
            {isHov && (
              <g>
                <rect x={Math.min(gx - 8, totalW - 140)} y={chartH + 24} width={138} height={32} rx={5} fill="var(--lf-ink)" />
                <text x={Math.min(gx - 8, totalW - 140) + 10} y={chartH + 37} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="var(--lf-pos)">
                  in {fmtK(d.income)}
                </text>
                <text x={Math.min(gx - 8, totalW - 140) + 10} y={chartH + 50} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="var(--lf-sauce)">
                  out {fmtK(d.expenses)}  net {d.net >= 0 ? '+' : ''}{fmtK(d.net)}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared inline style tokens
// ---------------------------------------------------------------------------

const S = {
  eyebrow: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: 'var(--lf-muted)',
  },
  serif: {
    fontFamily: "'Instrument Serif', Georgia, serif",
  },
  card: {
    background: 'var(--lf-paper)',
    border: '1px solid var(--lf-rule)',
    borderRadius: 14,
  },
  darkCard: {
    background: 'var(--lf-ink)',
    color: 'var(--lf-paper)',
    borderRadius: 14,
  },
};

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
  const [loadingTrend, setLoadingTrend] = useState(true);
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

  // Fetch monthly trend (only once)
  useEffect(() => {
    setLoadingTrend(true);
    api.getMonthlyTrend()
      .then((data) => setTrendData(data.months))
      .catch(() => setTrendData([]))
      .finally(() => setLoadingTrend(false));
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
      data: { totalSpending, totalIncome, netCashFlow, month: monthLabel(currentMonth) },
    });
  }, [totalSpending, totalIncome, netCashFlow, currentMonth, setPageContext]);

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

  return (
    <div
      style={{ flex: 1, overflowY: 'auto', padding: 'clamp(16px, 4vw, 32px)', paddingBottom: 'clamp(80px, 12vw, 48px)', background: 'var(--lf-paper)', minHeight: '100%' }}
    >
      <style>{`
        @media (max-width: 600px) { .spend-hero-grid { grid-template-columns: 1fr 1fr !important; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      {/* ------------------------------------------------------------------ */}
      {/* Page Header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        style={{ marginBottom: 28 }}
      >
        {/* Eyebrow */}
        <div style={{ ...S.eyebrow, marginBottom: 6 }}>
          Spending &middot; {monthLabel(currentMonth)}
        </div>

        {/* Title + month nav row */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ ...S.serif, fontSize: 'clamp(28px, 5vw, 42px)', color: 'var(--lf-ink)', margin: 0, lineHeight: 1.1 }}>
            Where the <em style={{ color: 'var(--lf-sauce)', fontStyle: 'italic' }}>money went.</em>
          </h1>

          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <button
              onClick={prevMonth}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8,
                border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
                color: 'var(--lf-ink-soft)', cursor: 'pointer',
              }}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={nextMonth}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8,
                border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
                color: 'var(--lf-ink-soft)', cursor: 'pointer',
              }}
            >
              <ChevronRight size={14} />
            </button>

            {/* Sync buttons */}
            {import.meta.env.VITE_DEMO_MODE !== 'true' && (
              <>
                <button
                  onClick={async () => {
                    setSyncing(true);
                    await api.triggerSync().catch(console.error);
                    setTimeout(() => { loadData(); setSyncing(false); }, 3000);
                  }}
                  disabled={syncing}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    height: 32, padding: '0 12px', borderRadius: 8,
                    border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
                    color: 'var(--lf-muted)', fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em',
                    cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.5 : 1,
                  }}
                >
                  <RefreshCw size={12} style={syncing ? { animation: 'spin 1s linear infinite' } : {}} />
                  {syncing ? 'Syncing...' : 'Sync'}
                </button>
                <button
                  onClick={async () => {
                    if (!confirm('This will re-fetch all historical transactions from Plaid and re-apply categorization rules. Continue?')) return;
                    setSyncing(true);
                    await api.triggerResync().catch(console.error);
                    setTimeout(() => { loadData(); setSyncing(false); }, 8000);
                  }}
                  disabled={syncing}
                  title="Re-fetch all transactions and re-apply categorization rules"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    height: 32, padding: '0 12px', borderRadius: 8,
                    border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
                    color: 'var(--lf-muted)', fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em',
                    cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.5 : 1,
                  }}
                >
                  <RefreshCw size={12} />
                  Resync all
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* ------------------------------------------------------------------ */}
      {/* Dark Hero — Spending KPIs                                            */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        style={{
          background: 'var(--lf-ink)', color: 'var(--lf-paper)',
          borderRadius: 14, padding: 'clamp(20px, 4vw, 32px)', marginBottom: 20,
        }}
      >
        <div className="spend-hero-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.6fr) repeat(3, minmax(80px, 1fr))', gap: 24, alignItems: 'end' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>
              Total spent · {monthLabel(currentMonth)}
            </div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 64, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--lf-paper)' }}>
              {loadingSummary ? '—' : formatCurrency(totalSpending)}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-cheese)', marginTop: 10 }}>
              {spendingCategories.length > 0 ? `${spendingCategories.length} categories tracked` : 'no transactions yet'}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>Income</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, letterSpacing: '-0.02em', color: 'var(--lf-paper)' }}>
              {loadingSummary ? '—' : formatCurrency(totalIncome)}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0', marginTop: 6 }}>this month</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>Net flow</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, letterSpacing: '-0.02em', color: netCashFlow >= 0 ? '#9FD18E' : '#E89070' }}>
              {loadingSummary ? '—' : `${netCashFlow >= 0 ? '+' : ''}${formatCurrency(netCashFlow)}`}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0', marginTop: 6 }}>{netCashFlow >= 0 ? 'surplus' : 'deficit'}</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>Savings rate</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, letterSpacing: '-0.02em', color: savingsRate !== null && savingsRate >= 20 ? '#9FD18E' : savingsRate !== null && savingsRate > 0 ? 'var(--lf-cheese)' : '#D4C6B0' }}>
              {loadingSummary ? '—' : savingsRate !== null ? `${savingsRate.toFixed(0)}%` : '—'}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0', marginTop: 6 }}>of income</div>
          </div>
        </div>
      </motion.div>

      {/* No-data state for users who have linked accounts but no transactions */}
      {!loadingSummary && totalSpending === 0 && totalIncome === 0 && hasLinkedAccounts && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.07 }}
          style={{ ...S.card, padding: 32, marginBottom: 28, textAlign: 'center' }}
        >
          <div style={{ ...S.serif, fontSize: 20, color: 'var(--lf-ink)', marginBottom: 8 }}>
            Transaction sync coming soon
          </div>
          <p style={{ color: 'var(--lf-muted)', fontSize: 14, marginBottom: 16 }}>
            For now, your monthly expenses are estimated from your credit card balances.
          </p>
          {creditCardTotal > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '10px 18px', borderRadius: 10,
              background: 'var(--lf-cream-deep)', border: '1px solid var(--lf-rule)',
            }}>
              <span style={{ ...S.eyebrow }}>Est. monthly spend</span>
              <span style={{ ...S.serif, fontSize: 22, color: 'var(--lf-sauce)' }}>
                {formatCurrency(creditCardTotal)}
              </span>
            </div>
          )}
        </motion.div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Two-column: Donut chart | 6-month trend                             */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.14 }}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 16,
          marginBottom: 28,
        }}
      >
        {/* --- Category Donut --- */}
        <div style={{ ...S.card, padding: 24 }}>
          <div style={{ ...S.eyebrow, marginBottom: 14 }}>Spending by category</div>

          {loadingSummary ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0', color: 'var(--lf-muted)' }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : spendingCategories.length === 0 ? (
            <p style={{ color: 'var(--lf-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>
              No data yet
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Donut */}
              <div style={{ flexShrink: 0 }}>
                <DonutMini cats={donutCats} total={donutTotal} />
              </div>

              {/* Category legend list */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {(showAllCategories ? spendingCategories : spendingCategories.slice(0, 6)).map((cat) => {
                  const display = getCategoryDisplay(cat.category);
                  const isSelected = selectedCategory === cat.category;
                  return (
                    <button
                      key={cat.category}
                      onClick={() => setSelectedCategory(isSelected ? null : cat.category)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '6px 8px', marginBottom: 2,
                        borderRadius: 8, border: isSelected ? '1px solid var(--lf-rule)' : '1px solid transparent',
                        background: isSelected ? 'var(--lf-cream-deep)' : 'transparent',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      {/* Color dot */}
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: display.color,
                      }} />
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--lf-ink)', fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {display.label}
                      </span>
                      <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: 'var(--lf-ink-soft)', flexShrink: 0 }}>
                        {formatCurrency(Math.abs(cat.total))}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--lf-muted)', flexShrink: 0, marginLeft: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                        {cat.percentage.toFixed(0)}%
                      </span>
                    </button>
                  );
                })}
                {spendingCategories.length > 6 && (
                  <button
                    onClick={() => setShowAllCategories((v) => !v)}
                    style={{
                      width: '100%', padding: '4px 8px', marginTop: 2,
                      fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--lf-muted)', background: 'none', border: 'none',
                      cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase',
                    }}
                  >
                    {showAllCategories ? 'Show less' : `+${spendingCategories.length - 6} more`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* --- 6-Month Trend --- */}
        <div style={{ ...S.card, padding: 24 }}>
          <div style={{ ...S.eyebrow, marginBottom: 4 }}>6-month trend</div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--lf-pos)', display: 'inline-block' }} />
              <span style={{ ...S.eyebrow, fontSize: 13 }}>Income</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--lf-sauce)', display: 'inline-block' }} />
              <span style={{ ...S.eyebrow, fontSize: 13 }}>Expenses</span>
            </div>
          </div>

          {loadingTrend ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0', color: 'var(--lf-muted)' }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : trendData.length === 0 ? (
            <p style={{ color: 'var(--lf-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>
              No data yet
            </p>
          ) : (
            <div style={{ width: '100%' }}>
              <TrendBarChart data={trendData} />
            </div>
          )}
        </div>
      </motion.div>

      {/* ------------------------------------------------------------------ */}
      {/* Page Actions (behavioral / spending insights)                       */}
      {/* ------------------------------------------------------------------ */}
      <PageActions types={['spending', 'behavioral']} />

      {/* ------------------------------------------------------------------ */}
      {/* Transaction Table                                                    */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.21 }}
        style={{ ...S.card, padding: 24, marginBottom: 40 }}
      >
        {/* Table header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div style={{ ...S.eyebrow }}>Transactions</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Category filter */}
            <select
              value={selectedCategory || ''}
              onChange={(e) => { setSelectedCategory(e.target.value || null); setTxPage(1); }}
              style={{
                height: 34, padding: '0 10px', borderRadius: 8,
                border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
                color: 'var(--lf-ink)', fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer',
                appearance: 'none',
              }}
            >
              <option value="">All categories</option>
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>

            {/* Search */}
            <div style={{ position: 'relative' }}>
              <Search
                size={13}
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--lf-muted)', pointerEvents: 'none' }}
              />
              <input
                type="text"
                placeholder="Search merchants..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setTxPage(1); }}
                style={{
                  height: 34, padding: '0 32px 0 30px', borderRadius: 8,
                  border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
                  color: 'var(--lf-ink)', fontSize: 13, width: 200,
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                }}
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
        </div>

        {/* Active filter chips */}
        {(selectedCategory || debouncedSearch) && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {selectedCategory && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 20,
                background: 'var(--lf-cream-deep)', border: '1px solid var(--lf-rule)',
                fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                color: 'var(--lf-ink-soft)', letterSpacing: '0.06em',
              }}>
                {getCategoryDisplay(selectedCategory).label}
                <button onClick={() => setSelectedCategory(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--lf-muted)', display: 'flex', alignItems: 'center' }}>
                  <X size={10} />
                </button>
              </span>
            )}
            {debouncedSearch && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 20,
                background: 'var(--lf-cream-deep)', border: '1px solid var(--lf-rule)',
                fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                color: 'var(--lf-ink-soft)',
              }}>
                &ldquo;{debouncedSearch}&rdquo;
                <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--lf-muted)', display: 'flex', alignItems: 'center' }}>
                  <X size={10} />
                </button>
              </span>
            )}
          </div>
        )}

        {/* Rows */}
        {loadingTx ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 0', color: 'var(--lf-muted)' }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>Loading transactions...</span>
          </div>
        ) : transactions.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--lf-muted)', padding: '48px 0', fontSize: 14 }}>
            No transactions found
          </p>
        ) : (
          <div>
            {transactions.map((tx, idx) => {
              const amount = parseFloat(tx.amount);
              const isIncome = amount < 0;
              const display = getCategoryDisplay(tx.category);
              const dateStr = new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const isEditing = editingTxId === tx.id;

              return (
                <div
                  key={tx.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 8px',
                    borderTop: idx > 0 ? '1px solid var(--lf-rule-soft)' : 'none',
                  }}
                >
                  {/* Category color bar */}
                  <span style={{
                    width: 4, height: 28, borderRadius: 2, flexShrink: 0,
                    background: display.color,
                  }} />

                  {/* Merchant + date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--lf-ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.merchantName || tx.name}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--lf-muted)', fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>
                      {dateStr}
                    </div>
                  </div>

                  {/* Category badge / editor */}
                  {isEditing ? (
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
                        flexShrink: 0,
                      }}
                    >
                      {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setEditingTxId(tx.id)}
                      title="Click to recategorize"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 6, flexShrink: 0,
                        border: '1px solid var(--lf-rule)', background: 'var(--lf-cream)',
                        color: 'var(--lf-ink-soft)', fontSize: 12,
                        fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {display.icon} {display.label}
                    </button>
                  )}

                  {/* Amount */}
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13, flexShrink: 0,
                    color: isIncome ? 'var(--lf-pos)' : 'var(--lf-sauce)',
                    fontWeight: 600,
                  }}>
                    {isIncome ? '+' : ''}{formatCurrencyExact(Math.abs(amount))}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {txTotal > PAGE_SIZE && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--lf-rule)',
          }}>
            <span style={{ ...S.eyebrow, fontSize: 13 }}>
              {(txPage - 1) * PAGE_SIZE + 1}&ndash;{Math.min(txPage * PAGE_SIZE, txTotal)} of {txTotal}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                disabled={txPage <= 1}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 30, height: 30, borderRadius: 7,
                  border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
                  color: 'var(--lf-muted)', cursor: txPage <= 1 ? 'not-allowed' : 'pointer',
                  opacity: txPage <= 1 ? 0.4 : 1,
                }}
              >
                <ChevronLeft size={13} />
              </button>
              <span style={{ ...S.eyebrow, fontSize: 13, minWidth: 60, textAlign: 'center' }}>
                {txPage} / {totalPages}
              </span>
              <button
                onClick={() => setTxPage((p) => Math.min(totalPages, p + 1))}
                disabled={txPage >= totalPages}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 30, height: 30, borderRadius: 7,
                  border: '1px solid var(--lf-rule)', background: 'var(--lf-paper)',
                  color: 'var(--lf-muted)', cursor: txPage >= totalPages ? 'not-allowed' : 'pointer',
                  opacity: txPage >= totalPages ? 0.4 : 1,
                }}
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
