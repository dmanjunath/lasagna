import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Receipt,
} from 'lucide-react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useAuth } from '../lib/auth';
import { usePageContext } from '../lib/page-context';
import { PageActions } from '../components/common/page-actions';
import { Badge, Button, EmptyState, SegmentedControl, Skeleton, Table, TBody, TR, TH, TD } from '../components/uikit';
import { CashflowBars, periodLabel, type CashflowPeriod } from '../components/charts/CashflowBars';
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

interface RollupRow {
  key: string | null;
  label: string;
  total: number;
  children: Array<{ key: string | null; label: string; total: number }>;
}

// Single source of truth for the category⇄group rollup. Category mode: one row
// per category (key = category id, null for uncategorized). Group mode: reduced
// by groupId, carrying the child categories for the expandable rows. Rows and
// children are sorted largest first. Used by the donut and by both sides
// (income + expenses) of the breakdown table.
function buildRollupRows(cats: SpendingCategory[], rollup: 'category' | 'group'): RollupRow[] {
  if (rollup === 'category') {
    return cats
      .map((c) => ({ key: c.id, label: c.name, total: Math.abs(c.total), children: [] as RollupRow['children'] }))
      .sort((a, b) => b.total - a.total);
  }
  const byGroup = new Map<string | null, RollupRow>();
  for (const c of cats) {
    const child = { key: c.id, label: c.name, total: Math.abs(c.total) };
    const existing = byGroup.get(c.groupId);
    if (existing) {
      existing.total += child.total;
      existing.children.push(child);
    } else {
      byGroup.set(c.groupId, { key: c.groupId, label: c.groupName || 'Other', total: child.total, children: [child] });
    }
  }
  const rows = [...byGroup.values()];
  for (const r of rows) r.children.sort((a, b) => b.total - a.total);
  return rows.sort((a, b) => b.total - a.total);
}

// Touch browsers emulate mouseenter on tap but never fire mouseleave, which
// strands the donut slice hover (stuck dim + pill). Only wire the hover
// handlers when the primary pointer can actually hover.
const CAN_HOVER = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpendingCategory {
  // Uncategorized transactions come back with a null id (name "Other") and a
  // null groupId; those rows render but are inert (no filter to apply).
  id: string | null;
  name: string;
  systemKey: string | null;
  groupId: string | null;
  groupName: string;
  groupType: 'income' | 'expense' | 'transfer';
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
  cats: Array<{ name: string | null; amount: number; color: string; label?: string }>;
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
    return { d, color: c.color, name: c.name, label: c.label ?? c.name ?? '', amount: c.amount, pct: Math.round(frac * 100), idx };
  });
  const hp = hovered !== null && hovered >= 0 && hovered < paths.length ? paths[hovered] : null;
  return (
    <div className="relative w-full" data-testid="spending-donut-wrap">
      <svg
        viewBox="0 0 120 120"
        preserveAspectRatio="xMidYMid meet"
        className="block w-full"
        data-testid="spending-donut"
      >
        {paths.map((p) => (
          <path key={p.idx} d={p.d} fill={p.color}
            opacity={hovered === null ? 1 : hovered === p.idx ? 1 : 0.32}
            style={{ transition: 'opacity 0.15s' }}
            onMouseEnter={CAN_HOVER ? () => setHovered(p.idx) : undefined}
            onMouseLeave={CAN_HOVER ? () => setHovered(null) : undefined}
            data-slice-idx={p.idx}
          />
        ))}
        <text x="60" y="57" textAnchor="middle" fontWeight="700" fontSize="4.6" letterSpacing="0.08em" fill="rgb(var(--ui-content-muted))" style={{ textTransform: 'uppercase' }}>{centerLabel}</text>
        <text x="60" y="70" textAnchor="middle" fontWeight="800" fontSize={centerValue ? '13' : '9.5'} fill="rgb(var(--ui-content))" style={{ fontVariantNumeric: 'tabular-nums' }}>{centerValue ?? (fmtAmount ? fmtAmount(total) : total.toLocaleString())}</text>
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
            {hp.label}, {hp.pct}%
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat cell (Income / Net flow / Savings rate) — sits inline at the top of the
// hero beside the Spent block, instead of three separate boxy cards.
// ---------------------------------------------------------------------------

function StatCell({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'pos' | 'neg' }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-content-muted">{label}</div>
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
// BreakdownSection - one titled section (Income / Expenses) of the breakdown
// table: a sub-header naming the section, column headers, the rolled-up rows
// (group rows expand to their children), and a per-section total row at 100%.
// ---------------------------------------------------------------------------

function pctLabel(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  const pct = (part / whole) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

function BreakdownSection({
  title,
  rows,
  totalLabel,
  colHead,
  pctHead,
  rollup,
  openGroups,
  toggleGroup,
  selectedCategory,
  onSelectCategory,
}: {
  title: string;
  rows: RollupRow[];
  totalLabel: string;
  colHead: string;
  pctHead: string;
  rollup: 'category' | 'group';
  openGroups: Set<string | null>;
  toggleGroup: (key: string | null) => void;
  selectedCategory: string | null;
  onSelectCategory: (key: string) => void;
}) {
  // Denominator = the section's own row sum, so its percentages always total
  // 100%.
  const denominator = rows.reduce((s, r) => s + r.total, 0);
  // A section with a single category row already IS the whole section at 100%,
  // so the separate "Total" row would just repeat it. Skip it in that case.
  const showSectionTotal = rows.length > 1;
  return (
    <TBody>
      <tr>
        <th
          colSpan={3}
          className="border-b border-line bg-canvas-sunken/50 px-4 pt-4 pb-2 text-left text-[12px] font-bold uppercase tracking-[0.1em] text-content"
        >
          {title}
        </th>
      </tr>
      <TR>
        <TH>{colHead}</TH>
        <TH numeric>Amount</TH>
        <TH numeric>{pctHead}</TH>
      </TR>
      {rows.map((row) => {
          // Null key = uncategorized ("Other"): inert, never a filter or a group
          // to expand. A group with a single child equal to the group total has
          // nothing new to reveal, so it doesn't expand either.
          const expandable = rollup === 'group' && row.key !== null && row.children.length > 1;
          const isOpen = expandable && openGroups.has(row.key);
          const selectable = rollup === 'category' && row.key !== null;
          const isSelected = selectable && selectedCategory === row.key;
          const clickable = expandable || selectable;
          return (
            <React.Fragment key={row.key ?? `uncategorized-${title}`}>
              <TR
                interactive={clickable}
                aria-expanded={expandable ? isOpen : undefined}
                aria-pressed={selectable ? isSelected : undefined}
                onClick={clickable
                  ? () => (expandable ? toggleGroup(row.key) : onSelectCategory(row.key as string))
                  : undefined}
                className={cn(
                  'ui-focus',
                  isSelected && 'bg-brand-soft hover:bg-brand-soft',
                  !clickable && 'cursor-default',
                )}
                tabIndex={clickable ? 0 : undefined}
                role={clickable ? 'button' : undefined}
                onKeyDown={clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (expandable) toggleGroup(row.key);
                        else onSelectCategory(row.key as string);
                      }
                    }
                  : undefined}
              >
                <TD className={cn('max-w-0', isSelected && 'text-[rgb(var(--ui-brand-ink))]')}>
                  <span className="flex items-center gap-2">
                    {expandable && (
                      <ChevronDown
                        size={15}
                        className={cn('shrink-0 text-content-muted transition-transform', isOpen && 'rotate-180')}
                        aria-hidden
                      />
                    )}
                    <span className={cn('truncate font-medium', isSelected ? 'text-[rgb(var(--ui-brand-ink))]' : 'text-content')}>
                      {row.label}
                    </span>
                  </span>
                </TD>
                <TD numeric className="font-semibold">{formatCurrency(row.total)}</TD>
                <TD numeric>{pctLabel(row.total, denominator)}</TD>
              </TR>
              {isOpen && row.children.map((child) => {
                const childSelectable = child.key !== null;
                const childSelected = childSelectable && selectedCategory === child.key;
                return (
                  <TR
                    key={child.key ?? `uncategorized-${title}`}
                    interactive={childSelectable}
                    aria-pressed={childSelectable ? childSelected : undefined}
                    onClick={childSelectable ? () => onSelectCategory(child.key as string) : undefined}
                    className={cn(
                      'ui-focus bg-canvas-sunken/40',
                      childSelected && 'bg-brand-soft hover:bg-brand-soft',
                      !childSelectable && 'cursor-default',
                    )}
                    tabIndex={childSelectable ? 0 : undefined}
                    role={childSelectable ? 'button' : undefined}
                    onKeyDown={childSelectable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectCategory(child.key as string);
                          }
                        }
                      : undefined}
                  >
                    <TD className={cn('max-w-0 pl-10', childSelected && 'text-[rgb(var(--ui-brand-ink))]')}>
                      <span className={cn('block truncate font-medium', childSelected ? 'text-[rgb(var(--ui-brand-ink))]' : 'text-content')}>
                        {child.label}
                      </span>
                    </TD>
                    <TD numeric>{formatCurrency(child.total)}</TD>
                    <TD numeric>{pctLabel(child.total, denominator)}</TD>
                  </TR>
                );
              })}
            </React.Fragment>
          );
        })}
      {showSectionTotal && (
        <TR className="border-t border-line-strong">
          <TD className="font-bold text-content">{totalLabel}</TD>
          <TD numeric className="font-bold text-content">{formatCurrency(denominator)}</TD>
          <TD numeric className="font-bold text-content">100%</TD>
        </TR>
      )}
    </TBody>
  );
}

// ---------------------------------------------------------------------------
// Spending Page
// ---------------------------------------------------------------------------

export function Spending() {
  const { setPageContext } = usePageContext();
  const { user } = useAuth();

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

  // Filters — selectedCategory holds a category ID (uuid); TransactionList
  // forwards it to the API, which dual-accepts ids.
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Linked account detection
  const [hasLinkedAccounts, setHasLinkedAccounts] = useState(false);
  const [creditCardTotal, setCreditCardTotal] = useState(0);

  // Donut hover index (drives slice dim + the pill / center swap).
  const [donutHover, setDonutHover] = useState<number | null>(null);

  // Trend-chart hover index (bubbles up to swap the hero value).
  const [chartHover, setChartHover] = useState<number | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);

  // Rules panel (optionally seeded from a transaction's "Create rule" prompt)
  const [rulesPanel, setRulesPanel] = useState<{ open: boolean; seed: { merchantText: string; category: string } | null }>({ open: false, seed: null });

  // Loading
  const [loadingSummary, setLoadingSummary] = useState(true);
  // First-load gate: the big skeleton renders only before the FIRST summary
  // resolves. Later period switches keep stale content mounted (dimmed) so the
  // page doesn't flash to skeletons on every bar click.
  const [hasLoadedSummary, setHasLoadedSummary] = useState(false);

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
      .finally(() => { if (active) { setLoadingSummary(false); setHasLoadedSummary(true); } });
    return () => { active = false; };
  }, [periodStart, periodEnd, refreshKey]);

  // Clear the skip-animation flag after the render that consumed it.
  useEffect(() => {
    skipHeroAnimRef.current = false;
  }, [selectedPeriod]);

  // Fetch cashflow periods — powers the bar chart + prior-period delta.
  useEffect(() => {
    let active = true;
    api.getTrend(granularity === 'month' ? { granularity: 'month', limit: 13 } : { granularity: 'year' })
      // Guard the shape: a 200 with an unexpected body (e.g. an API/frontend version
      // skew that omits `periods`) must not set `undefined` — every consumer does
      // periods.find/.length and would hard-crash the page. Default to [].
      .then((data) => { if (!active) return; setPeriods(data?.periods ?? []); })
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

  // Derived. While the summary refetches after a period switch, the chart data
  // already holds the NEW period's totals — drive the hero from it so the old
  // period's numbers never flash under the new caption. The fetched summary
  // takes over the moment it lands (values agree; both exclude transfers and
  // excluded transactions).
  const selPeriodData = periods.find((p) => p.period === selectedPeriod) ?? null;
  const instant = loadingSummary && selPeriodData !== null;
  const displaySpending = instant ? selPeriodData.expenses : totalSpending;
  const displayIncome = instant ? selPeriodData.income : totalIncome;
  const displayNet = instant ? selPeriodData.net : netCashFlow;
  const savingsRate = displayIncome > 0 ? ((displayIncome - displaySpending) / displayIncome) * 100 : null;

  const prevMonth = useCallback(() => {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }, []);
  // The current calendar month is the ceiling — no stepping into the future.
  const atCurrentMonth = useMemo(() => {
    const now = new Date();
    return currentMonth.getFullYear() === now.getFullYear() && currentMonth.getMonth() === now.getMonth();
  }, [currentMonth]);
  const nextMonth = useCallback(() => {
    setCurrentMonth((d) => {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return next > new Date() ? d : next;
    });
  }, []);

  // Clicking a bar selects that period.
  // When the clicked bar is the one already hovered, its value is ALREADY on
  // screen — re-animating the same number on selection is just distraction.
  // Stepper/auto-page selections (value genuinely changes) still animate.
  const skipHeroAnimRef = useRef(false);
  const handleSelectPeriod = useCallback((p: string) => {
    if (chartHover !== null && periods[chartHover]?.period === p) {
      skipHeroAnimRef.current = true;
    }
    if (granularity === 'month') {
      setCurrentMonth(new Date(+p.slice(0, 4), +p.slice(5, 7) - 1, 1));
    } else {
      setCurrentYear(+p);
    }
  }, [granularity, chartHover, periods]);

  // Switching granularity keeps the selection sensible: to year → year of the
  // month in view; back to month → currentMonth is untouched.
  const handleGranularityChange = useCallback((g: 'month' | 'year') => {
    setGranularity(g);
    setChartHover(null);
    if (g === 'year') setCurrentYear(currentMonth.getFullYear());
  }, [currentMonth]);

  const spendingCategories = useMemo(
    () => categories.filter((c) => c.groupType !== 'income' && c.groupType !== 'transfer'),
    [categories],
  );

  const incomeCategories = useMemo(
    () => categories.filter((c) => c.groupType === 'income'),
    [categories],
  );

  // Donut rows - expense GROUPS, always. The donut is a fixed group-level
  // visual (no toggle); the labeled category breakdown lives in the table below.
  const donutGroupRows = useMemo(
    () => buildRollupRows(spendingCategories, 'group'),
    [spendingCategories],
  );

  // DonutMini slices - viz palette, color assigned by SORTED position so the
  // largest slice always gets the same hue across renders. With a handful of
  // groups every slice renders; only when there are genuinely too many groups
  // to read do sub-5% rows roll into a single "Smaller groups" bin (preserving
  // 100% of the total).
  const donutSlices = useMemo(() => {
    const toSlice = (c: (typeof donutGroupRows)[number], i: number) => ({
      name: c.key,
      label: c.label,
      amount: c.total,
      color: colorForIndex(i),
    });
    // Below this count, render every group as its own slice.
    const MAX_SLICES = 10;
    if (donutGroupRows.length <= MAX_SLICES) {
      return donutGroupRows.map(toSlice);
    }
    const total = donutGroupRows.reduce((s, c) => s + c.total, 0);
    const SMALL_THRESHOLD = 0.05; // 5% of total
    const bigCount = total > 0
      ? donutGroupRows.filter((c) => c.total / total >= SMALL_THRESHOLD).length
      : donutGroupRows.length;
    if (donutGroupRows.length - bigCount < 2) {
      return donutGroupRows.map(toSlice);
    }
    const slices = donutGroupRows.slice(0, bigCount).map(toSlice);
    slices.push({
      name: '__tailbin__',
      label: 'Smaller groups',
      amount: donutGroupRows.slice(bigCount).reduce((s, c) => s + c.total, 0),
      color: TAIL_COLOR,
    });
    return slices;
  }, [donutGroupRows]);
  const donutTotal = useMemo(
    () => donutSlices.reduce((s, c) => s + c.amount, 0),
    [donutSlices],
  );

  // Top category (for lede).
  const topCategoryLabel = useMemo(() => {
    if (spendingCategories.length === 0) return null;
    const top = [...spendingCategories].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))[0];
    return top ? top.name : null;
  }, [spendingCategories]);

  // Breakdown table - its own Category/Group toggle (the one the user asked for).
  const [tableRollup, setTableRollup] = useState<'category' | 'group'>('category');
  const incomeRows = useMemo(
    () => buildRollupRows(incomeCategories, tableRollup),
    [incomeCategories, tableRollup],
  );
  const expenseRows = useMemo(
    () => buildRollupRows(spendingCategories, tableRollup),
    [spendingCategories, tableRollup],
  );

  // Group-mode expansion for the table (group id → open). All collapsed by
  // default; resets on the table's rollup toggle and on period change.
  const [openGroups, setOpenGroups] = useState<Set<string | null>>(() => new Set());
  useEffect(() => {
    setOpenGroups(new Set());
  }, [selectedPeriod, tableRollup]);
  const toggleGroup = useCallback((key: string | null) => {
    setOpenGroups((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const handleTableRollupChange = useCallback((r: 'category' | 'group') => {
    setTableRollup(r);
    setSelectedCategory(null);
  }, []);
  // Toggle a table row's category filter (click again to clear).
  const selectCategory = useCallback((key: string) => {
    setSelectedCategory((cur) => (cur === key ? null : key));
  }, []);

  // Prior-period spending (for Δ%) — from the cashflow periods if present.
  const priorPeriodDelta = useMemo(() => {
    if (periods.length < 2 || displaySpending === 0) return null;
    const idx = periods.findIndex((p) => p.period === selectedPeriod);
    if (idx < 1) return null;
    const prior = periods[idx - 1];
    if (!prior || prior.expenses === 0) return null;
    const pct = ((displaySpending - prior.expenses) / prior.expenses) * 100;
    return Math.round(pct);
  }, [periods, displaySpending, selectedPeriod]);

  const hasChart = periods.length > 0;

  const hoveredPeriod = chartHover !== null ? periods[chartHover] : null;
  const heroValue = hoveredPeriod ? hoveredPeriod.expenses : displaySpending;
  const heroCaption = hoveredPeriod
    ? periodLabel(hoveredPeriod.period, granularity)
    : periodDisplayLabel;

  const noData = !loadingSummary && totalSpending === 0 && totalIncome === 0;
  const spentMore = priorPeriodDelta !== null && priorPeriodDelta > 0;

  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Header — title/lede row, then a single non-wrapping controls
           row (desktop-only Sync keeps it to one line at 390px). */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
            Spending
          </h1>
          {hasLoadedSummary && (
            <p className="mt-1.5 hidden text-[14px] font-medium text-content-muted sm:block">
              {topCategoryLabel ? (
                <>Where your money went. Most went to <b className="font-bold text-content">{topCategoryLabel}</b>.</>
              ) : (
                <>Where your money went in {periodDisplayLabel}.</>
              )}
            </p>
          )}
        </div>

        {/* Granularity toggle + month stepper (+ sync when admin) */}
        <div className="flex items-center gap-2 sm:gap-2.5">
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
                className="ui-focus touch-target grid h-10 w-9 place-items-center rounded-ui-sm text-content-secondary transition-colors hover:bg-canvas-sunken hover:text-content sm:w-10"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="ui-tnum min-w-[76px] px-1 text-center font-editorial text-[13.5px] font-bold tracking-[-0.01em] text-content sm:min-w-[92px]">
                {currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
              <button
                type="button"
                onClick={nextMonth}
                disabled={atCurrentMonth}
                aria-label="Next month"
                className="ui-focus touch-target grid h-10 w-9 place-items-center rounded-ui-sm text-content-secondary transition-colors hover:bg-canvas-sunken hover:text-content disabled:opacity-35 disabled:hover:bg-transparent sm:w-10"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
          {!isDemo && user?.isAdmin && (
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
              // Desktop-only: another control overflows the one-row header at
              // 390px for admins. Admins sync from desktop.
              className="hidden sm:inline-flex"
            >
              <span className="hidden sm:inline">{syncing ? 'Syncing…' : 'Sync'}</span>
            </Button>
          )}
        </div>
      </header>

      {/* ════════ Loading skeleton ════════ */}
      {loadingSummary && !hasLoadedSummary && (
        <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
            <div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-12 w-56" />
              <Skeleton className="mt-3 h-7 w-44 rounded-full" />
            </div>
            <div className="flex flex-wrap gap-x-8">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="mt-3 h-6 w-20" />
                  <Skeleton className="mt-3 h-3 w-14" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="mt-6 h-[190px] w-full rounded-ui-md" />
        </div>
      )}

      {/* ════════ HERO — the one confident statement: spent + how it compares,
           with the three KPIs (income / net / savings) inline at the top and
           the interactive trend below — a single, complete answer. ════════ */}
      {hasLoadedSummary && !noData && (
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
          {/* No loading dim here — the hero derives from already-loaded chart
               data during a refetch, so its numbers are correct immediately. */}
          <div className="relative flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
            <div className="flex flex-col gap-1">
              <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
                Spent in {heroCaption}
              </div>
              {/* Keyed by period so switching months slides the new figure in;
                   hover swaps stay instant (same key, no re-animation). */}
              <motion.div
                key={`${granularity}:${selectedPeriod}`}
                initial={hasLoadedSummary && !skipHeroAnimRef.current ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="mt-2 font-editorial text-[40px] sm:text-[54px] font-extrabold leading-[0.98] tracking-[-0.035em] ui-tnum"
              >
                {formatCurrency(heroValue)}
              </motion.div>
              <div className="mt-3.5 flex min-h-7 flex-wrap items-center gap-2.5">
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

            {/* KPI cluster — the three summary numbers beside the Spent figure;
                 right-aligned on the same row on desktop, wrapping below the
                 Spent block on narrow screens. */}
            <div className="flex flex-wrap gap-x-8 gap-y-5 text-left">
              <StatCell label="Income" value={formatCurrency(displayIncome)} sub="received" />
              <StatCell
                label="Net flow"
                value={`${displayNet >= 0 ? '+' : ''}${formatCurrency(displayNet)}`}
                sub={displayNet >= 0 ? 'surplus' : 'deficit'}
                tone={displayNet >= 0 ? 'pos' : 'neg'}
              />
              <StatCell
                label="Savings rate"
                value={savingsRate !== null ? `${savingsRate < 0 ? '−' : ''}${Math.abs(savingsRate).toFixed(0)}%` : '—'}
                sub="of income"
                tone={savingsRate !== null && savingsRate < 0 ? 'neg' : undefined}
              />
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
                visibleCount={granularity === 'month' ? 6 : undefined}
              />
            </div>
          )}
        </section>
      )}

      {/* ════════ Estimated (linked but no transactions) ════════ */}
      {!loadingSummary && noData && hasLinkedAccounts && (
        <section className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-6">
          <Badge tone="caution">Estimated</Badge>
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

      {/* ════════ WHERE IT WENT - a fixed group-level spending donut: total-spend
           center, slice hover shows the group's dollar amount and %. A pure
           visual (no toggle, no click-to-filter). The labeled category breakdown
           and all transaction filtering live in the table below. ═══ */}
      {hasLoadedSummary && spendingCategories.length > 0 && (
        <section className="mt-10">
          <h2 className="pb-4 font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.018em]">Where it went</h2>
          <div className={cn(
            'mx-auto w-full max-w-[420px] rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-6 sm:p-7 transition-opacity duration-200',
            loadingSummary && 'opacity-50',
          )}>
            <div className="mx-auto w-full max-w-[280px]">
              <DonutMini
                cats={donutSlices}
                total={donutTotal}
                hovered={donutHover}
                onHoverChange={setDonutHover}
                fmtAmount={formatCurrency}
                centerLabel="Total spend"
                centerValue={formatCurrency(donutTotal)}
              />
            </div>
          </div>
        </section>
      )}

      {/* ════════ INCOME AND EXPENSES - full breakdown table, income and
           expenses each with their own % denominator. Its own Category/Group
           toggle (independent of the donut). Group mode expands to child
           categories. Expense and income category rows filter the transactions
           below. ═══ */}
      {hasLoadedSummary && !noData && (totalIncome > 0 || spendingCategories.length > 0) && (
        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pb-4">
            <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.018em]">Income and expenses</h2>
            <SegmentedControl
              aria-label="Break down by"
              value={tableRollup}
              onChange={handleTableRollupChange}
              options={[
                { value: 'category', label: 'Category' },
                { value: 'group', label: 'Group' },
              ]}
            />
          </div>
          <div className={cn(
            'overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm transition-opacity duration-200',
            loadingSummary && 'opacity-50',
          )}>
            <Table>
              {totalIncome > 0 && incomeRows.length > 0 && (
                <BreakdownSection
                  title="Income"
                  rows={incomeRows}
                  totalLabel="Total income"
                  colHead={tableRollup === 'group' ? 'Group' : 'Category'}
                  pctHead="% of income"
                  rollup={tableRollup}
                  openGroups={openGroups}
                  toggleGroup={toggleGroup}
                  selectedCategory={selectedCategory}
                  onSelectCategory={selectCategory}
                />
              )}
              {spendingCategories.length > 0 && (
                <BreakdownSection
                  title="Expenses"
                  rows={expenseRows}
                  totalLabel="Total expenses"
                  colHead={tableRollup === 'group' ? 'Group' : 'Category'}
                  pctHead="% of expenses"
                  rollup={tableRollup}
                  openGroups={openGroups}
                  toggleGroup={toggleGroup}
                  selectedCategory={selectedCategory}
                  onSelectCategory={selectCategory}
                />
              )}
            </Table>
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
          viewAllHref="/transactions"
          pageSize={5}
          showPagination={false}
          showSearch={false}
          showCategoryFilter={false}
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
