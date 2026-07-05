import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  RefreshCw,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  UtensilsCrossed,
  Home,
  Car,
  Clapperboard,
  ShoppingBag,
  Lightbulb,
  HeartPulse,
  Shield,
  Plane,
  Tv,
  Receipt,
  ArrowLeftRight,
  TrendingUp,
  CreditCard,
  Scissors,
  GraduationCap,
  Gift,
  Landmark,
  Banknote,
} from 'lucide-react';
import { Link } from 'wouter';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { usePageContext } from '../lib/page-context';
import { PageActions } from '../components/common/page-actions';
import { Button, Badge, EmptyState, Eyebrow, Skeleton } from '../components/uikit';
import { smoothLinePath, niceTicks, pickXLabels, formatShortMoney, type TrendPoint } from '../components/ds/TrendChart';

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

function monthShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function startOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function endOfMonth(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}T23:59:59`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Category config — label + Bright lucide glyph. Slice/legend color is assigned
// at render time from the --ui-viz-* palette so the donut never reads as one
// blob and light/dark swap automatically.
// ---------------------------------------------------------------------------

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  income:             { label: 'Income',              icon: <DollarSign size={15} /> },
  housing:            { label: 'Housing',             icon: <Home size={15} /> },
  transportation:     { label: 'Transportation',      icon: <Car size={15} /> },
  food_dining:        { label: 'Dining Out',          icon: <UtensilsCrossed size={15} /> },
  groceries:          { label: 'Groceries',           icon: <ShoppingCart size={15} /> },
  utilities:          { label: 'Utilities',           icon: <Lightbulb size={15} /> },
  healthcare:         { label: 'Healthcare',          icon: <HeartPulse size={15} /> },
  insurance:          { label: 'Insurance',           icon: <Shield size={15} /> },
  entertainment:      { label: 'Entertainment',       icon: <Clapperboard size={15} /> },
  shopping:           { label: 'Shopping',            icon: <ShoppingBag size={15} /> },
  personal_care:      { label: 'Personal Care',       icon: <Scissors size={15} /> },
  education:          { label: 'Education',           icon: <GraduationCap size={15} /> },
  travel:             { label: 'Travel',              icon: <Plane size={15} /> },
  subscriptions:      { label: 'Subscriptions',       icon: <Tv size={15} /> },
  savings_investment: { label: 'Savings & Investment', icon: <TrendingUp size={15} /> },
  debt_payment:       { label: 'Debt Payment',        icon: <CreditCard size={15} /> },
  gifts_donations:    { label: 'Gifts & Donations',   icon: <Gift size={15} /> },
  taxes:              { label: 'Taxes',               icon: <Landmark size={15} /> },
  transfer:           { label: 'Transfers',           icon: <ArrowLeftRight size={15} /> },
  other:              { label: 'Other',               icon: <Receipt size={15} /> },
};

// Warm-harmonious viz rotation for spending categories. Coral (viz-4) and slate
// (viz-7) sit at the tail so a single category never reads as an alert, and the
// long-tail "Smaller categories" bin always lands on neutral slate.
const DATA_PALETTE = [
  'var(--ui-viz-2)',
  'var(--ui-viz-3)',
  'var(--ui-viz-5)',
  'var(--ui-viz-1)',
  'var(--ui-viz-6)',
  'var(--ui-viz-4)',
  'var(--ui-viz-7)',
];
const TAIL_COLOR = 'var(--ui-viz-7)';

function getCategoryDisplay(key: string) {
  return CATEGORY_CONFIG[key] ?? { label: key, icon: <Receipt size={15} /> };
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
// DonutMini — inline SVG on the --ui-viz palette, dark-legible center readout.
// ---------------------------------------------------------------------------

function DonutMini({
  cats,
  total,
  onHoverChange,
  hovered: hoveredProp,
  fmtAmount,
  centerLabel = 'Total',
  centerValue,
}: {
  cats: Array<{ name: string; amount: number; color: string; label?: string }>;
  total: number;
  onHoverChange?: (i: number | null) => void;
  hovered?: number | null;
  fmtAmount?: (n: number) => string;
  centerLabel?: string;
  centerValue?: string;
}) {
  const [hoveredLocal, setHoveredLocal] = useState<number | null>(null);
  const hovered = hoveredProp !== undefined ? hoveredProp : hoveredLocal;
  const setHovered = (i: number | null) => {
    setHoveredLocal(i);
    onHoverChange?.(i);
  };
  const r = 36, R = 54, cx = 60, cy = 60;
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
    <div className="relative w-full" data-testid="spending-donut-wrap">
      <svg
        viewBox="0 0 120 120"
        preserveAspectRatio="xMidYMid meet"
        className="block w-full cursor-pointer"
        data-testid="spending-donut"
      >
        {paths.map((p) => (
          <path key={p.idx} d={p.d} fill={p.color}
            opacity={hovered === null ? 1 : hovered === p.idx ? 1 : 0.32}
            style={{ transition: 'opacity 0.15s' }}
            onMouseEnter={() => setHovered(p.idx)}
            onMouseLeave={() => setHovered(null)}
            onTouchStart={() => setHovered(hovered === p.idx ? null : p.idx)}
            data-slice-idx={p.idx}
          />
        ))}
        {hp ? (
          <>
            <text x="60" y="57" textAnchor="middle" fontWeight="700" fontSize="4.6" letterSpacing="0.08em" fill="rgb(var(--ui-content-muted))" style={{ textTransform: 'uppercase' }}>{hp.label.slice(0, 16)}</text>
            <text x="60" y="70" textAnchor="middle" fontWeight="800" fontSize="11" fill="rgb(var(--ui-content))" style={{ fontVariantNumeric: 'tabular-nums' }}>{hp.pct}%</text>
          </>
        ) : (
          <>
            <text x="60" y="57" textAnchor="middle" fontWeight="700" fontSize="4.6" letterSpacing="0.08em" fill="rgb(var(--ui-content-muted))" style={{ textTransform: 'uppercase' }}>{centerLabel}</text>
            <text x="60" y="70" textAnchor="middle" fontWeight="800" fontSize={centerValue ? '13' : '9.5'} fill="rgb(var(--ui-content))" style={{ fontVariantNumeric: 'tabular-nums' }}>{centerValue ?? (fmtAmount ? fmtAmount(total) : total.toLocaleString())}</text>
          </>
        )}
      </svg>
      {hp && (
        <div
          data-chart-hover="pill"
          className="ui-tnum pointer-events-none absolute left-1/2 top-[-6px] z-10 flex -translate-x-1/2 -translate-y-full flex-col gap-0.5 whitespace-nowrap rounded-ui-sm bg-[rgb(var(--ui-panel-raised))] px-2.5 py-1.5 shadow-ui-lg"
          style={{ border: '1px solid var(--ui-line)' }}
        >
          <span className="text-[13px] font-bold leading-tight tracking-[-0.01em] text-content">
            {fmtAmount ? fmtAmount(hp.amount) : hp.amount.toLocaleString()}
          </span>
          <span className="text-[10.5px] leading-tight text-content-muted">
            {hp.label} · {hp.pct}%
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpendTrendChart — monthly-expenses area+line on --ui-* tokens. Mirrors the
// Money page's interactive chart (smooth spline, nice ticks, hover crosshair)
// and bubbles the hovered index up so the hero value can swap. The month in
// view (currentMonth) is marked with a ring.
// ---------------------------------------------------------------------------

const CHART_H = 210;
const CHART_M = { top: 14, right: 12, bottom: 32, left: 52 };

function SpendTrendChart({
  points, activeIdx, onHoverChange,
}: {
  points: TrendPoint[];
  activeIdx: number | null;
  onHoverChange?: (i: number | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(680);
  const [hoverIdx, setHoverIdxRaw] = useState<number | null>(null);
  const setHoverIdx = (i: number | null) => { setHoverIdxRaw(i); onHoverChange?.(i); };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setChartW(el.clientWidth || 680);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = chartW - CHART_M.left - CHART_M.right;
  const innerH = CHART_H - CHART_M.top - CHART_M.bottom;

  const { yMin, yMax, yTicks } = useMemo(() => {
    const values = points.map((p) => p.value);
    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(...values, 1);
    const pad = (rawMax - rawMin) * 0.08 || Math.abs(rawMax) * 0.08 || 1;
    return { yMin: rawMin, yMax: rawMax + pad, yTicks: niceTicks(rawMin, rawMax + pad, 4) };
  }, [points]);

  const xAt = (i: number) => CHART_M.left + (i / Math.max(1, points.length - 1)) * innerW;
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
  const markIdx = hoverIdx !== null ? hoverIdx : (activeIdx !== null ? activeIdx : points.length - 1);
  const markPt = points[markIdx];
  const xLabels = useMemo(() => pickXLabels(points, '1Y'), [points]);

  const pointerToIdx = (clientX: number): number | null => {
    const root = wrapRef.current;
    if (!root || points.length <= 0) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = chartW / rect.width;
    const localX = (clientX - rect.left) * scale;
    const ratio = (localX - CHART_M.left) / Math.max(1, innerW);
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  };

  return (
    <div ref={wrapRef} className="relative select-none">
      <svg
        viewBox={`0 0 ${chartW} ${CHART_H}`}
        role="img"
        aria-label="Monthly spending trend chart"
        className="block w-full touch-none"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <linearGradient id="spend-area-ui" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ui-viz-4)" stopOpacity="0.22" />
            <stop offset="55%" stopColor="var(--ui-viz-4)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--ui-viz-4)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={CHART_M.left} y1={yAt(t)} x2={chartW - CHART_M.right} y2={yAt(t)}
              stroke="var(--ui-hairline)" strokeWidth={1} strokeDasharray="2 5"
            />
            <text
              x={CHART_M.left - 12} y={yAt(t)} dy="0.32em" textAnchor="end"
              fill="rgb(var(--ui-content-faint))"
              style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatShortMoney(t)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#spend-area-ui)" />
        <path
          d={linePath} fill="none" stroke="var(--ui-viz-4)"
          strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
        />

        {markPt && (
          <g>
            {hover && hoverIdx !== null && (
              <line x1={xAt(hoverIdx)} y1={CHART_M.top} x2={xAt(hoverIdx)} y2={CHART_M.top + innerH} stroke="rgb(var(--ui-content-muted))" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 4" />
            )}
            <circle cx={xAt(markIdx)} cy={yAt(markPt.value)} r={13} fill="var(--ui-viz-4)" fillOpacity={0.14} />
            <circle cx={xAt(markIdx)} cy={yAt(markPt.value)} r={5.5} fill="var(--ui-viz-4)" stroke="rgb(var(--ui-panel))" strokeWidth={3} />
          </g>
        )}

        {xLabels.map(({ idx, label }, i) => {
          // Right-align only the final tick so it doesn't clip the SVG edge
          // (CHART_M.right is just 12px); the rest stay centered on their point.
          const anchor = i === xLabels.length - 1 ? 'end' : 'middle';
          return <text key={`${idx}-${label}`} x={xAt(idx)} y={CHART_H - 8} textAnchor={anchor} fill="rgb(var(--ui-content-muted))" style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{label}</text>;
        })}
      </svg>

      <div
        className="absolute inset-0"
        style={{ touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerMove={(e) => { if (e.pointerType === 'touch' && e.buttons === 0) return; setHoverIdx(pointerToIdx(e.clientX)); }}
        onPointerLeave={() => setHoverIdx(null)}
        onPointerCancel={() => setHoverIdx(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction row — category medallion · merchant · category·date · amount.
// Income (amount < 0) renders positive teal with a leading '+'. The category
// label stays a click target so it can open the inline recategorize editor.
// ---------------------------------------------------------------------------

function TxnRow({
  merchant, icon, isIncome, categoryNode, date, amount,
}: {
  merchant: string;
  icon: React.ReactNode;
  isIncome: boolean;
  categoryNode: React.ReactNode;
  date: string;
  amount: number;
}) {
  return (
    <div className="flex items-center gap-3.5 border-t border-line px-4 py-3 first:border-t-0 last:rounded-b-ui-xl sm:px-5">
      <span className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-ui-md',
        isIncome ? 'bg-positive-soft text-positive' : 'bg-canvas-sunken text-content-secondary',
      )}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold leading-tight" title={merchant}>{merchant}</div>
        <div className="mt-0.5 flex items-center text-[12.5px] text-content-muted">
          {categoryNode}
          <span className="mx-1 text-content-faint">·</span>
          <span className="ui-tnum">{shortDate(date)}</span>
        </div>
      </div>
      <span className={cn('shrink-0 font-editorial text-[14.5px] font-extrabold tracking-[-0.01em] ui-tnum', isIncome && 'text-positive')}>
        {isIncome ? '+' : ''}{formatCurrencyExact(Math.abs(amount))}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat rail cell (Income / Net flow / Savings rate) — sits inline at the base
// of the hero, divided by hairlines, instead of three separate boxy cards.
// ---------------------------------------------------------------------------

function StatCell({ label, value, sub, tone, className }: { label: string; value: string; sub: string; tone?: 'pos' | 'neg'; className?: string }) {
  return (
    <div className={cn('px-0 sm:px-6 sm:first:pl-0', className)}>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.11em] text-content-muted">{label}</div>
      <div className={cn(
        'mt-1.5 font-editorial text-[20px] sm:text-[25px] font-extrabold leading-none tracking-[-0.02em] ui-tnum',
        tone === 'pos' && 'text-[rgb(var(--ui-brand-ink))]',
        tone === 'neg' && 'text-negative',
      )}>{value}</div>
      <div className="mt-1.5 text-[11.5px] font-semibold text-content-muted">{sub}</div>
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

  // Trend-chart hover index (bubbles up to swap the hero value).
  const [chartHover, setChartHover] = useState<number | null>(null);

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

  // Fetch monthly trend (only once) — powers the trend chart + last-month delta.
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

  const savingsRate = totalIncome > 0 ? ((totalIncome - totalSpending) / totalIncome) * 100 : null;

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

  // DonutMini data — viz palette, color assigned by SORTED position so the
  // largest slice always gets the same hue across renders. Sub-5% categories
  // roll into a single "Smaller categories" bin (preserving 100% of the total)
  // so the donut stays scannable instead of drawing unreadable slivers.
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
      bigSlices.push({
        name: '__tailbin__',
        label: 'Smaller categories',
        amount: otherTotal,
        color: TAIL_COLOR,
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

  // Previous-month spending (for Δ%) — from monthly trend if present.
  const lastMonthDelta = useMemo(() => {
    if (trendData.length < 2 || totalSpending === 0) return null;
    const key = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    const idx = trendData.findIndex((t) => t.month === key);
    if (idx < 1) return null;
    const prior = trendData[idx - 1];
    if (!prior || prior.expenses === 0) return null;
    const pct = ((totalSpending - prior.expenses) / prior.expenses) * 100;
    return Math.round(pct);
  }, [trendData, totalSpending, currentMonth]);

  // Trend chart points — monthly expenses over time.
  const trendPoints = useMemo<TrendPoint[]>(
    () => trendData.map((t) => ({ date: `${t.month}-01`, value: t.expenses })),
    [trendData],
  );
  const hasTrendChart = trendPoints.length >= 2;
  const activeTrendIdx = useMemo(() => {
    const key = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    const idx = trendData.findIndex((t) => t.month === key);
    return idx >= 0 ? idx : null;
  }, [trendData, currentMonth]);

  const hoveredTrend = chartHover !== null ? trendPoints[chartHover] : null;
  const heroValue = hoveredTrend ? hoveredTrend.value : totalSpending;
  const heroCaption = hoveredTrend ? monthShort(hoveredTrend.date) : monthLabel(currentMonth);

  const noData = !loadingSummary && totalSpending === 0 && totalIncome === 0;
  const spentMore = lastMonthDelta !== null && lastMonthDelta > 0;

  // Inline category editor — a compact native select shown in place of the
  // category label when the label is clicked.
  function categoryEditorFor(tx: Transaction) {
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
        className="h-7 rounded-ui-sm border border-line-strong bg-panel px-1.5 text-[12px] font-medium text-content"
        onClick={(e) => e.stopPropagation()}
      >
        {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
          <option key={key} value={key}>{cfg.label}</option>
        ))}
      </select>
    );
  }

  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-12 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ════════ Header ════════ */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
            Spending
          </h1>
          {!loadingSummary && (
            <p className="mt-1.5 text-[14px] font-medium text-content-muted">
              {topCategoryLabel ? (
                <>Where your money went — most on <b className="font-bold text-content">{topCategoryLabel}</b>.</>
              ) : (
                <>Where your money went in {monthLabel(currentMonth)}.</>
              )}
            </p>
          )}
        </div>

        {/* Month stepper + sync */}
        <div className="flex items-center gap-2.5">
          <div className="inline-flex items-center gap-0.5 rounded-ui-md border border-line bg-panel p-0.5 shadow-ui-sm">
            <button
              type="button"
              onClick={prevMonth}
              aria-label="Previous month"
              className="ui-focus touch-target grid h-10 w-10 place-items-center rounded-ui-sm text-content-secondary transition-colors hover:bg-canvas-sunken hover:text-content"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="ui-tnum min-w-[92px] px-1 text-center font-editorial text-[13.5px] font-bold tracking-[-0.01em] text-content">
              {currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              aria-label="Next month"
              className="ui-focus touch-target grid h-10 w-10 place-items-center rounded-ui-sm text-content-secondary transition-colors hover:bg-canvas-sunken hover:text-content"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {!isDemo && (
            <Button
              variant="secondary"
              size="sm"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                await api.triggerSync().catch(console.error);
                setTimeout(() => { loadData(); setSyncing(false); }, 3000);
              }}
              leadingIcon={<RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />}
              aria-label={syncing ? 'Syncing' : 'Sync'}
            >
              <span className="hidden sm:inline">{syncing ? 'Syncing…' : 'Sync'}</span>
            </Button>
          )}
        </div>
      </header>

      {/* ════════ Loading skeleton ════════ */}
      {loadingSummary && (
        <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-[26px]">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-12 w-56" />
          <Skeleton className="mt-3 h-7 w-44 rounded-full" />
          <Skeleton className="mt-6 h-[190px] w-full rounded-ui-md" />
          <div className="mt-6 grid grid-cols-3 gap-6 border-t border-line pt-5">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-3 h-6 w-20" />
                <Skeleton className="mt-3 h-3 w-14" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════ HERO — the one confident statement: spent + how it compares +
           the interactive trend, closed by an inline stat rail (income / net /
           savings) so the page opens with a single, complete answer. ════════ */}
      {!loadingSummary && !noData && (
        <section className="relative mt-6 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(120% 90% at 100% 0%, var(--ui-info-soft), transparent 56%),' +
                'radial-gradient(90% 70% at 0% 4%, var(--ui-brand-softer), transparent 60%)',
            }}
          />
          <div className="relative flex flex-col gap-1">
            <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
              Spent · {heroCaption}
            </div>
            <div className="mt-2 font-editorial text-[40px] sm:text-[54px] font-extrabold leading-[0.98] tracking-[-0.035em] ui-tnum">
              {formatCurrency(heroValue)}
            </div>
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              {hoveredTrend ? (
                <span className="text-[13.5px] font-medium text-content-muted">Total expenses this month</span>
              ) : lastMonthDelta !== null ? (
                <>
                  <span
                    className="ui-tnum inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold"
                    style={{
                      background: spentMore ? 'var(--ui-negative-soft)' : 'var(--ui-positive-soft)',
                      color: spentMore ? 'rgb(var(--ui-negative))' : 'rgb(var(--ui-positive))',
                    }}
                  >
                    {spentMore
                      ? <TrendingUp size={13} aria-hidden />
                      : <TrendingDown size={13} aria-hidden />}
                    {spentMore ? '+' : '−'}{Math.abs(lastMonthDelta)}%
                  </span>
                  <span className="text-[13px] font-medium text-content-muted">
                    {spentMore ? 'more than' : 'less than'} last month
                  </span>
                </>
              ) : (
                <span className="text-[13px] font-medium text-content-muted">across {monthLabel(currentMonth)}</span>
              )}
            </div>
          </div>

          {hasTrendChart && (
            <div className="relative mt-5 pr-2 sm:pr-0">
              <SpendTrendChart points={trendPoints} activeIdx={activeTrendIdx} onHoverChange={setChartHover} />
            </div>
          )}

          {/* Inline stat rail — the three summary numbers, folded into the hero.
               2-col on mobile (savings rate spans its own row so the label never
               wraps); 3-col with hairline dividers from sm up. */}
          <div className="relative mt-6 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-5 sm:grid-cols-3 sm:gap-x-0 sm:gap-y-0 sm:divide-x sm:divide-line">
            <StatCell label="Income" value={formatCurrency(totalIncome)} sub="received" />
            <StatCell
              label="Net flow"
              value={`${netCashFlow >= 0 ? '+' : ''}${formatCurrency(netCashFlow)}`}
              sub={netCashFlow >= 0 ? 'surplus' : 'deficit'}
              tone={netCashFlow >= 0 ? 'pos' : 'neg'}
            />
            <StatCell
              className="col-span-2 sm:col-span-1"
              label="Savings rate"
              value={savingsRate !== null ? `${savingsRate < 0 ? '−' : ''}${Math.abs(savingsRate).toFixed(0)}%` : '—'}
              sub="of income"
              tone={savingsRate !== null && savingsRate < 0 ? 'neg' : undefined}
            />
          </div>
        </section>
      )}

      {/* ════════ Estimated (linked but no transactions) ════════ */}
      {!loadingSummary && noData && hasLinkedAccounts && (
        <section className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-6">
          <Eyebrow>Estimated</Eyebrow>
          <h3 className="mt-1.5 font-editorial text-[19px] font-bold tracking-[-0.018em]">Transaction sync coming soon</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-content-muted">
            For now, your monthly expenses are estimated from your credit card balances.
          </p>
          {creditCardTotal > 0 && (
            <div className="mt-4 flex items-baseline gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">Est. monthly spend</span>
              <span className="font-editorial text-[22px] font-extrabold tracking-[-0.02em] ui-tnum text-negative">
                {formatCurrency(creditCardTotal)}
              </span>
            </div>
          )}
        </section>
      )}

      {/* ════════ Empty — no transactions and nothing linked ════════ */}
      {!loadingSummary && noData && !hasLinkedAccounts && (
        <div className="mt-7">
          <EmptyState
            icon={<Receipt size={24} />}
            title="No spending to show yet"
            description="Connect a bank or card account to see your monthly spending, categories, and transactions here."
            action={
              <Link href="/accounts">
                <Button variant="primary">Connect an account</Button>
              </Link>
            }
          />
        </div>
      )}

      {/* ════════ Behavioral / spending insights ════════ */}
      <section className="mt-10">
        <PageActions types={['spending', 'behavioral']} />
      </section>

      {/* ════════ WHERE IT WENT — donut (labeled, long-tail binned) paired with
           a portfolio-grade two-column category ledger that fills the width.
           Rows filter the transactions below; hover links donut ⇄ ledger. ═══ */}
      {!loadingSummary && spendingCategories.length > 0 && (
        <section className="mt-10">
          <div className="flex items-end justify-between gap-4 pb-4">
            <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.018em]">Where it went</h2>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-muted ui-tnum">
              {spendingCategories.length} categories
            </span>
          </div>
          <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7">
            <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[268px_1fr] lg:gap-12">
              {/* Donut — clearly labeled */}
              <div className="mx-auto w-full max-w-[280px]">
                <div className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
                  {monthLabel(currentMonth)}
                </div>
                <DonutMini
                  cats={donutCats}
                  total={donutTotal}
                  hovered={donutHover}
                  onHoverChange={setDonutHover}
                  fmtAmount={formatCurrency}
                  centerLabel={spendingCategories.length === 1 ? 'Category' : 'Categories'}
                  centerValue={String(spendingCategories.length)}
                />
                <div className="mt-3 text-center text-[12px] font-medium text-content-muted">
                  Tap a slice to isolate it
                </div>
              </div>

              {/* Two-column ledger */}
              <div className="min-w-0 grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2">
                {donutCats.map((cat, idx) => {
                  const pct = donutTotal > 0 ? (cat.amount / donutTotal) * 100 : 0;
                  const isOther = cat.name === '__tailbin__';
                  const isSelected = !isOther && selectedCategory === cat.name;
                  const dimmed = donutHover !== null && donutHover !== idx;
                  return (
                    <div
                      key={cat.name}
                      className={cn(
                        'flex flex-col transition-opacity',
                        isOther && 'sm:col-span-2',
                      )}
                      style={{ opacity: dimmed ? 0.4 : 1 }}
                      onMouseEnter={() => setDonutHover(idx)}
                      onMouseLeave={() => setDonutHover(null)}
                    >
                      <button
                        type="button"
                        onClick={isOther ? undefined : () => setSelectedCategory(isSelected ? null : cat.name)}
                        className={cn(
                          'ui-focus flex min-h-touch min-w-0 items-center gap-3 rounded-ui-sm px-2.5 py-2 text-left transition-colors',
                          isOther ? 'cursor-default' : 'cursor-pointer',
                          isSelected ? 'bg-brand-soft' : !isOther && 'hover:bg-brand-softer',
                        )}
                      >
                        <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: cat.color }} aria-hidden />
                        <span className={cn(
                          'min-w-0 flex-1 truncate text-[13.5px] font-semibold',
                          isSelected ? 'text-[rgb(var(--ui-brand-ink))]' : 'text-content',
                        )}>
                          {cat.label}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-right ui-tnum">
                          <span className="font-editorial text-[14px] font-extrabold tracking-[-0.01em] text-content">
                            {formatCurrency(cat.amount)}
                          </span>
                          <span className="ml-2 text-[12.5px] font-semibold text-content-muted">{pct.toFixed(0)}%</span>
                        </span>
                      </button>
                      {isOther && cat.children.length > 0 && (
                        <div className="px-2.5 pb-2 text-[11.5px] leading-relaxed text-content-muted">
                          {cat.children.map((c, j) => (
                            <span key={c.name}>
                              {c.label} <span className="ui-tnum">{formatCurrency(c.amount)}</span>
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
          </div>
        </section>
      )}

      {/* ════════ Recent transactions ════════ */}
      <section className="mt-10">
        <div className="flex flex-col gap-3 px-1 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.018em]">Recent transactions</h2>
            {txTotal > 0 && (
              <span className="text-[12.5px] font-semibold text-content-muted ui-tnum">{txTotal} total</span>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <select
                value={selectedCategory || ''}
                onChange={(e) => { setSelectedCategory(e.target.value || null); setTxPage(1); }}
                className="ui-focus touch-target h-10 w-full appearance-none rounded-ui-md border border-line bg-panel pl-3 pr-9 text-[13px] font-medium text-content shadow-ui-sm sm:w-auto"
              >
                <option value="">All categories</option>
                {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
              <ChevronRight size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-content-muted" />
            </div>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
              <input
                type="text"
                placeholder="Search merchants…"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setTxPage(1); }}
                className="ui-focus touch-target h-10 w-full rounded-ui-md border border-line bg-panel pl-9 pr-8 text-[13px] text-content shadow-ui-sm sm:w-[220px]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 grid -translate-y-1/2 place-items-center text-content-muted hover:text-content"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {(selectedCategory || debouncedSearch) && (
          <div className="mb-3 flex flex-wrap gap-2 px-1">
            {selectedCategory && (
              <Badge tone="brand" className="pr-1.5">
                {getCategoryDisplay(selectedCategory).label}
                <button type="button" onClick={() => setSelectedCategory(null)} aria-label="Clear category filter" className="grid place-items-center">
                  <X size={12} />
                </button>
              </Badge>
            )}
            {debouncedSearch && (
              <Badge tone="neutral" className="pr-1.5">
                &ldquo;{debouncedSearch}&rdquo;
                <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search filter" className="grid place-items-center">
                  <X size={12} />
                </button>
              </Badge>
            )}
          </div>
        )}

        <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm">
          {loadingTx ? (
            <div>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="flex items-center gap-3.5 border-t border-line px-4 py-3 first:border-t-0 sm:px-5">
                  <Skeleton className="h-9 w-9 rounded-ui-md" />
                  <div className="flex-1">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="mt-2 h-3 w-44" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-3">
              <EmptyState
                icon={<Search size={22} />}
                title="No transactions found"
                description="Try adjusting your filters or the month in view."
              />
            </div>
          ) : (
            <div>
              {transactions.map((tx) => {
                const amount = parseFloat(tx.amount);
                const isIncome = amount < 0;
                const display = getCategoryDisplay(tx.category);
                const categoryNode = editingTxId === tx.id ? (
                  categoryEditorFor(tx)
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditingTxId(tx.id); }}
                    title="Click to recategorize"
                    className="touch-target-inline rounded-ui-xs text-content-muted transition-colors hover:text-content hover:underline"
                  >
                    {display.label}
                  </button>
                );
                return (
                  <TxnRow
                    key={tx.id}
                    merchant={tx.merchantName || tx.name}
                    icon={isIncome ? <DollarSign size={15} /> : (display.icon ?? <Banknote size={15} />)}
                    isIncome={isIncome}
                    categoryNode={categoryNode}
                    date={tx.date}
                    amount={amount}
                  />
                );
              })}
            </div>
          )}

          {txTotal > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3.5 sm:px-5">
              <span className="ui-tnum text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">
                {(txPage - 1) * PAGE_SIZE + 1}&ndash;{Math.min(txPage * PAGE_SIZE, txTotal)} of {txTotal}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                  disabled={txPage <= 1}
                  aria-label="Previous page"
                  className="ui-focus grid h-11 w-11 place-items-center rounded-ui-md border border-line text-content transition-colors hover:bg-canvas-sunken disabled:opacity-35 disabled:hover:bg-transparent"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="ui-tnum min-w-[56px] text-center text-[12px] font-semibold text-content-muted">
                  {txPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setTxPage((p) => Math.min(totalPages, p + 1))}
                  disabled={txPage >= totalPages}
                  aria-label="Next page"
                  className="ui-focus grid h-11 w-11 place-items-center rounded-ui-md border border-line text-content transition-colors hover:bg-canvas-sunken disabled:opacity-35 disabled:hover:bg-transparent"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
