import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Receipt,
} from 'lucide-react';
import { Link } from 'wouter';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { usePageContext } from '../lib/page-context';
import { PageActions } from '../components/common/page-actions';
import { Button, EmptyState, Eyebrow, SegmentedControl, Skeleton } from '../components/uikit';
import { CashflowBars, periodLabel, type CashflowPeriod } from '../components/charts/CashflowBars';
import { getCategoryDisplay } from '../lib/categories';
import { TransactionList } from '../components/transactions/TransactionList';
import { RulesPanel } from '../components/rules/RulesPanel';

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
// Spending Page
// ---------------------------------------------------------------------------

export function Spending() {
  const { setPageContext } = usePageContext();

  // Period navigation
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() - 1, 1);
  });
  const [granularity, setGranularity] = useState<'month' | 'year'>('month');
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());

  // Data state
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [totalSpending, setTotalSpending] = useState(0);
  const [totalIncome, setTotalIncome] = useState(0);
  const [netCashFlow, setNetCashFlow] = useState(0);
  const [periods, setPeriods] = useState<CashflowPeriod[]>([]);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Linked account detection
  const [hasLinkedAccounts, setHasLinkedAccounts] = useState(false);
  const [creditCardTotal, setCreditCardTotal] = useState(0);

  // Donut hover index (kept in parent so legend rows can also drive it).
  const [donutHover, setDonutHover] = useState<number | null>(null);

  // Trend-chart hover index (bubbles up to swap the hero value).
  const [chartHover, setChartHover] = useState<number | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);

  // Rules panel (optionally seeded from a transaction's "Create rule" prompt)
  const [rulesPanel, setRulesPanel] = useState<{ open: boolean; seed: { merchantText: string; category: string } | null }>({ open: false, seed: null });

  // Loading
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Refresh counter
  const [refreshKey, setRefreshKey] = useState(0);

  const loadData = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

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

  // Selected period — 'YYYY-MM' in month mode, 'YYYY' in year mode — plus the
  // date range everything below the chart (summary, donut, transactions) uses.
  const selectedPeriod = granularity === 'month'
    ? `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`
    : String(currentYear);
  const periodStart = granularity === 'month' ? startOfMonth(currentMonth) : `${currentYear}-01-01`;
  const periodEnd = granularity === 'month' ? endOfMonth(currentMonth) : `${currentYear}-12-31T23:59:59`;
  const periodDisplayLabel = granularity === 'month' ? monthLabel(currentMonth) : String(currentYear);

  // Fetch spending summary
  useEffect(() => {
    let active = true;
    setLoadingSummary(true);
    api.getSpendingSummary({ startDate: periodStart, endDate: periodEnd })
      .then((data) => {
        if (!active) return;
        setCategories(data.categories);
        setTotalSpending(data.totalSpending);
        setTotalIncome(data.totalIncome);
        setNetCashFlow(data.netCashFlow);
      })
      .catch(() => {
        if (!active) return;
        setCategories([]);
        setTotalSpending(0);
        setTotalIncome(0);
        setNetCashFlow(0);
      })
      .finally(() => { if (active) setLoadingSummary(false); });
    return () => { active = false; };
  }, [periodStart, periodEnd, refreshKey]);

  // Fetch cashflow periods — powers the bar chart + prior-period delta.
  useEffect(() => {
    let active = true;
    api.getTrend(granularity === 'month' ? { granularity: 'month', limit: 13 } : { granularity: 'year' })
      .then((data) => { if (!active) return; setPeriods(data.periods); })
      .catch(() => { if (!active) return; setPeriods([]); });
    return () => { active = false; };
  }, [granularity, refreshKey]);

  // Page context for chat
  useEffect(() => {
    setPageContext({
      pageId: 'spending',
      pageTitle: 'Spending',
      description: 'Spending breakdown by month or year, category analysis, and transaction history.',
    });
  }, [setPageContext]);

  // Derived
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalSpending) / totalIncome) * 100 : null;

  const prevMonth = useCallback(() => {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }, []);
  const nextMonth = useCallback(() => {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }, []);

  // Clicking a bar selects that period.
  const handleSelectPeriod = useCallback((p: string) => {
    if (granularity === 'month') {
      setCurrentMonth(new Date(+p.slice(0, 4), +p.slice(5, 7) - 1, 1));
    } else {
      setCurrentYear(+p);
    }
  }, [granularity]);

  // Switching granularity keeps the selection sensible: to year → year of the
  // month in view; back to month → currentMonth is untouched.
  const handleGranularityChange = useCallback((g: 'month' | 'year') => {
    setGranularity(g);
    setChartHover(null);
    if (g === 'year') setCurrentYear(currentMonth.getFullYear());
  }, [currentMonth]);

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

  // Prior-period spending (for Δ%) — from the cashflow periods if present.
  const priorPeriodDelta = useMemo(() => {
    if (periods.length < 2 || totalSpending === 0) return null;
    const idx = periods.findIndex((p) => p.period === selectedPeriod);
    if (idx < 1) return null;
    const prior = periods[idx - 1];
    if (!prior || prior.expenses === 0) return null;
    const pct = ((totalSpending - prior.expenses) / prior.expenses) * 100;
    return Math.round(pct);
  }, [periods, totalSpending, selectedPeriod]);

  const hasChart = periods.length > 0;

  const hoveredPeriod = chartHover !== null ? periods[chartHover] : null;
  const heroValue = hoveredPeriod ? hoveredPeriod.expenses : totalSpending;
  const heroCaption = hoveredPeriod
    ? periodLabel(hoveredPeriod.period, granularity)
    : periodDisplayLabel;

  const noData = !loadingSummary && totalSpending === 0 && totalIncome === 0;
  const spentMore = priorPeriodDelta !== null && priorPeriodDelta > 0;

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
                <>Where your money went in {periodDisplayLabel}.</>
              )}
            </p>
          )}
        </div>

        {/* Granularity toggle + month stepper + sync */}
        <div className="flex flex-wrap items-center gap-2.5">
          <SegmentedControl
            aria-label="Granularity"
            value={granularity}
            onChange={handleGranularityChange}
            stretch={false}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Year' },
            ]}
          />
          {granularity === 'month' && (
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
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRulesPanel({ open: true, seed: null })}
            leadingIcon={<SlidersHorizontal size={15} />}
            aria-label="Rules"
          >
            <span className="hidden sm:inline">Rules</span>
          </Button>
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
              {hoveredPeriod ? (
                <span className="text-[13.5px] font-medium text-content-muted">
                  Total expenses this {granularity === 'month' ? 'month' : 'year'}
                </span>
              ) : priorPeriodDelta !== null ? (
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
                    {spentMore ? '+' : '−'}{Math.abs(priorPeriodDelta)}%
                  </span>
                  <span className="text-[13px] font-medium text-content-muted">
                    {spentMore ? 'more than' : 'less than'} last {granularity === 'month' ? 'month' : 'year'}
                  </span>
                </>
              ) : (
                <span className="text-[13px] font-medium text-content-muted">across {periodDisplayLabel}</span>
              )}
            </div>
          </div>

          {hasChart && (
            <div className="relative mt-5 pr-2 sm:pr-0">
              <CashflowBars
                periods={periods}
                granularity={granularity}
                selectedPeriod={selectedPeriod}
                onSelect={handleSelectPeriod}
                onHoverChange={setChartHover}
              />
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
                  {periodDisplayLabel}
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
        <TransactionList
          startDate={periodStart}
          endDate={periodEnd}
          category={selectedCategory}
          onCategoryChange={(c) => setSelectedCategory(c)}
          onClearCategory={() => setSelectedCategory(null)}
          refreshKey={refreshKey}
          onDataChanged={loadData}
          onCreateRule={(seed) => setRulesPanel({ open: true, seed })}
        />
      </section>

      <RulesPanel
        open={rulesPanel.open}
        seed={rulesPanel.seed}
        onClose={() => setRulesPanel({ open: false, seed: null })}
        onChanged={loadData}
      />
    </div>
  );
}
