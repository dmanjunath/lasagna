import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Receipt,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
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

// Single hue for the ranked breakdown bars. A neutral data color (not brand
// green, which would read as "good") that stays legible in light and dark.
const BAR_FILL = 'var(--ui-viz-2)';

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

// A sortable column header. Clicking toggles the sort key/direction; the active
// column shows the direction arrow, inactive columns show a faint up/down hint.
function SortHead({ label, sortKey, sort, onSort, numeric }: {
  label: string;
  sortKey: 'label' | 'amount';
  sort: { key: 'label' | 'amount'; dir: 'asc' | 'desc' };
  onSort: (k: 'label' | 'amount') => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <TH numeric={numeric}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}`}
        className={cn(
          'ui-focus -mx-1 inline-flex items-center gap-1 rounded-ui-sm px-1 py-0.5 uppercase tracking-[0.08em] transition-colors hover:text-content',
          active ? 'text-content' : 'text-content-muted',
        )}
      >
        {label}
        {active
          ? (sort.dir === 'asc' ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />)
          : <ChevronsUpDown size={13} className="text-content-faint" aria-hidden />}
      </button>
    </TH>
  );
}

function BreakdownSection({
  title,
  rows,
  totalLabel,
  colHead,
  rollup,
  openGroups,
  toggleGroup,
  onDrill,
  sort,
  onSort,
}: {
  title: string;
  rows: RollupRow[];
  totalLabel: string;
  colHead: string;
  rollup: 'category' | 'group';
  openGroups: Set<string | null>;
  toggleGroup: (key: string | null) => void;
  // Navigate to the transactions behind a row, filtered to these category ids.
  onDrill: (categoryIds: string[]) => void;
  sort: { key: 'label' | 'amount'; dir: 'asc' | 'desc' };
  onSort: (k: 'label' | 'amount') => void;
}) {
  // Denominator = the section's own row sum. The ranked bar encodes each row's
  // SHARE of that total, so the bar replaces a separate "%" column.
  const denominator = rows.reduce((s, r) => s + r.total, 0) || 1;
  // A section with a single row already IS the whole section at 100%, so the
  // separate "Total" row would just repeat it. Skip it in that case.
  const showSectionTotal = rows.length > 1;
  // The category ids a row filters transactions by: the group's children in
  // group mode, the category itself in category mode. Uncategorized has none.
  const idsFor = (row: RollupRow): string[] =>
    rollup === 'group'
      ? row.children.map((c) => c.key).filter((k): k is string => k !== null)
      : row.key !== null ? [row.key] : [];
  const sorted = [...rows].sort((a, b) => {
    const cmp = sort.key === 'label' ? a.label.localeCompare(b.label) : a.total - b.total;
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  return (
    <TBody>
      <tr>
        <th
          colSpan={2}
          className="border-b border-line bg-canvas-sunken/50 px-4 pt-4 pb-2 text-left text-[13px] font-bold text-content"
        >
          {title}
        </th>
      </tr>
      {/* Column headers + sort only earn their space when there's more than one
           row to compare. */}
      {rows.length > 1 && (
        <TR>
          <SortHead label={colHead} sortKey="label" sort={sort} onSort={onSort} />
          <SortHead label="Amount" sortKey="amount" sort={sort} onSort={onSort} numeric />
        </TR>
      )}
      {sorted.map((row) => {
          // Null key = uncategorized ("Other"): inert, no transactions to filter.
          const expandable = rollup === 'group' && row.key !== null && row.children.length > 1;
          const isOpen = expandable && openGroups.has(row.key);
          const ids = idsFor(row);
          const drillable = ids.length > 0;
          // Bar = share of the section total (truthful: a tiny category reads
          // as a tiny bar).
          const barPct = (row.total / denominator) * 100;
          return (
            <React.Fragment key={row.key ?? `uncategorized-${title}`}>
              {/* Expandable group rows act as an accordion header: clicking the
                   row body toggles open/closed (mouse; the chevron is the
                   keyboard toggle). A dedicated trailing arrow is the ONE thing
                   that opens the transactions behind the row — so there's no
                   hidden "the text is a link" ambiguity. The row is not itself a
                   button, so the chevron + arrow stay the real controls (no
                   nested ARIA buttons). Names wrap on mobile, truncate desktop. */}
              <TR
                interactive={expandable}
                onClick={expandable ? () => toggleGroup(row.key) : undefined}
              >
                <TD>
                  <div className="flex items-center gap-2">
                    {expandable ? (
                      <button
                        type="button"
                        aria-label={isOpen ? 'Collapse group' : 'Expand group'}
                        aria-expanded={isOpen}
                        onClick={(e) => { e.stopPropagation(); toggleGroup(row.key); }}
                        className="ui-focus -ml-1 grid h-6 w-6 shrink-0 place-items-center rounded-ui-sm text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
                      >
                        <ChevronDown size={15} className={cn('transition-transform', isOpen && 'rotate-180')} aria-hidden />
                      </button>
                    ) : rollup === 'group' ? (
                      <span className="w-6 shrink-0" aria-hidden />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1 line-clamp-2 font-medium text-content" title={row.label}>{row.label}</span>
                        {drillable && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDrill(ids); }}
                            aria-label={`View ${row.label} transactions`}
                            className="ui-focus inline-flex shrink-0 items-center gap-1 rounded-ui-sm py-1 text-[12px] font-semibold text-content-muted transition-colors hover:text-[rgb(var(--ui-brand-ink))] hover:underline"
                          >
                            View Transactions
                            <ArrowRight size={13} aria-hidden />
                          </button>
                        )}
                      </div>
                      <span className="mt-1.5 block h-2 w-full overflow-hidden rounded-full bg-canvas-sunken" aria-hidden>
                        <span className="block h-full rounded-full" style={{ width: `${barPct}%`, background: BAR_FILL }} />
                      </span>
                    </div>
                  </div>
                </TD>
                <TD numeric className="align-top font-semibold">{formatCurrency(row.total)}</TD>
              </TR>
              {isOpen && row.children.map((child) => {
                const childDrillable = child.key !== null;
                // Disambiguate a child that shares its parent group's name (the
                // group's own direct category) so it doesn't read as a dup row.
                const childLabel = child.label === row.label ? `${child.label} (general)` : child.label;
                return (
                  <TR key={child.key ?? `uncategorized-${title}`} className="bg-canvas-sunken/40">
                    <TD className="pl-16">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1 line-clamp-2 font-medium text-content" title={childLabel}>{childLabel}</span>
                        {childDrillable && (
                          <button
                            type="button"
                            onClick={() => onDrill([child.key as string])}
                            aria-label={`View ${childLabel} transactions`}
                            className="ui-focus inline-flex shrink-0 items-center gap-1 rounded-ui-sm py-1 text-[12px] font-semibold text-content-muted transition-colors hover:text-[rgb(var(--ui-brand-ink))] hover:underline"
                          >
                            View Transactions
                            <ArrowRight size={13} aria-hidden />
                          </button>
                        )}
                      </div>
                    </TD>
                    <TD numeric className="align-top">{formatCurrency(child.total)}</TD>
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
  const [, navigate] = useLocation();

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

  // Linked account detection
  const [hasLinkedAccounts, setHasLinkedAccounts] = useState(false);
  const [creditCardTotal, setCreditCardTotal] = useState(0);


  // Trend-chart hover index (bubbles up to swap the hero value).
  const [chartHover, setChartHover] = useState<number | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);

  // Rules panel (optionally seeded from a transaction's "Create rule" prompt)
  const [rulesPanel, setRulesPanel] = useState<{ open: boolean; seed: { merchantText: string; category: string } | null }>({ open: false, seed: null });

  // Loading
  const [loadingSummary, setLoadingSummary] = useState(true);
  // The summary fetch failed — show a Retry card instead of the "connect an
  // account" empty state, so a network blip doesn't look like no data.
  const [summaryError, setSummaryError] = useState(false);
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
        setSummaryError(false);
        setCategories(data.categories);
        setTotalSpending(data.totalSpending);
        setTotalIncome(data.totalIncome);
        setNetCashFlow(data.netCashFlow);
      })
      .catch(() => {
        if (!active) return;
        setSummaryError(true);
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
  // While hovering a trend bar, the WHOLE hero (spent + income/net/savings)
  // reflects the hovered period, so the KPIs can never contradict the big
  // number. Off-hover, it's the selected period's totals.
  const hoveredPeriod = chartHover !== null ? periods[chartHover] ?? null : null;
  const baseSpending = instant ? selPeriodData.expenses : totalSpending;
  const baseIncome = instant ? selPeriodData.income : totalIncome;
  const baseNet = instant ? selPeriodData.net : netCashFlow;
  const displaySpending = hoveredPeriod ? hoveredPeriod.expenses : baseSpending;
  const displayIncome = hoveredPeriod ? hoveredPeriod.income : baseIncome;
  const displayNet = hoveredPeriod ? hoveredPeriod.net : baseNet;
  const savingsRate = displayIncome > 0 ? ((displayIncome - displaySpending) / displayIncome) * 100 : null;
  // The insights strip describes recent activity (the default landing period).
  // Hide it when browsing history so its month-specific copy never contradicts
  // the period in view.
  const defaultMonthPeriod = useMemo(() => {
    const d = new Date();
    const m = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const onDefaultPeriod = granularity === 'month' && selectedPeriod === defaultMonthPeriod;

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

  // Breakdown table - its own Category/Group toggle, plus a sort shared by both
  // the income and expense sections (default: largest amount first).
  const [tableRollup, setTableRollup] = useState<'category' | 'group'>('category');
  const [sort, setSort] = useState<{ key: 'label' | 'amount'; dir: 'asc' | 'desc' }>({ key: 'amount', dir: 'desc' });
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
  }, []);
  const handleSort = useCallback((key: 'label' | 'amount') => {
    setSort((cur) => cur.key === key
      ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'label' ? 'asc' : 'desc' });
  }, []);
  // Drill from a breakdown row to the transactions behind it, filtered to the
  // given category ids. The Transactions page hydrates its filter from the URL.
  const drillToTransactions = useCallback((categoryIds: string[]) => {
    if (categoryIds.length === 0) return;
    navigate(`/transactions?categories=${categoryIds.join(',')}`);
  }, [navigate]);

  // Prior-period spending (for Δ%) — from the cashflow periods if present.
  const priorPeriodDelta = useMemo(() => {
    if (periods.length < 2 || baseSpending === 0) return null;
    const idx = periods.findIndex((p) => p.period === selectedPeriod);
    if (idx < 1) return null;
    const prior = periods[idx - 1];
    if (!prior || prior.expenses === 0) return null;
    const pct = ((baseSpending - prior.expenses) / prior.expenses) * 100;
    return Math.round(pct);
  }, [periods, baseSpending, selectedPeriod]);

  const hasChart = periods.length > 0;

  const heroValue = displaySpending;
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
        </div>

        {/* Granularity toggle + month stepper (+ sync when admin). Wraps so the
             admin Sync control can appear on mobile without overflowing. */}
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-2.5">
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
              <span className="ui-tnum min-w-[76px] px-1 text-center text-[13.5px] font-bold tracking-[-0.01em] text-content sm:min-w-[92px]">
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
            >
              {/* Icon-only on mobile to save header width; labeled on desktop. */}
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

      {/* ════════ Load error — offer Retry, don't masquerade as an empty month ═══ */}
      {!loadingSummary && summaryError && (
        <div className="mt-7">
          <EmptyState
            icon={<RefreshCw size={22} />}
            title="Couldn't load your spending"
            description="Something went wrong fetching this period. Check your connection and try again."
            action={<Button variant="primary" onClick={loadData}>Retry</Button>}
          />
        </div>
      )}

      {/* ════════ Estimated (linked but no transactions) ════════ */}
      {!loadingSummary && noData && !summaryError && hasLinkedAccounts && (
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
      {!loadingSummary && noData && !summaryError && !hasLinkedAccounts && (
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
      {onDefaultPeriod && (
        <section className="mt-10">
          <PageActions types={['spending', 'behavioral']} />
        </section>
      )}

      {/* ════════ SPENDING BREAKDOWN - one card: a sortable income/expense ledger
           where each row is a ranked bar (self-labeled, so no separate legend).
           The Category/Group toggle drives both sections; a row click opens the
           transactions behind it, filtered. Income is its own section. ═══ */}
      {hasLoadedSummary && !noData && (totalIncome > 0 || spendingCategories.length > 0) && (
        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pb-4">
            <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.018em]">Spending breakdown</h2>
            <SegmentedControl
              aria-label="Break down by"
              value={tableRollup}
              onChange={handleTableRollupChange}
              stretch={false}
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
              {spendingCategories.length > 0 && (
                <BreakdownSection
                  title="Expenses"
                  rows={expenseRows}
                  totalLabel="Total expenses"
                  colHead={tableRollup === 'group' ? 'Group' : 'Category'}
                  rollup={tableRollup}
                  openGroups={openGroups}
                  toggleGroup={toggleGroup}
                  onDrill={drillToTransactions}
                  sort={sort}
                  onSort={handleSort}
                />
              )}
              {/* Income breakdown only when it spans multiple sources — a single
                   income row just restates the hero's Income KPI. */}
              {incomeRows.length > 1 && (
                <BreakdownSection
                  title="Income"
                  rows={incomeRows}
                  totalLabel="Total income"
                  colHead={tableRollup === 'group' ? 'Group' : 'Category'}
                  rollup={tableRollup}
                  openGroups={openGroups}
                  toggleGroup={toggleGroup}
                  onDrill={drillToTransactions}
                  sort={sort}
                  onSort={handleSort}
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
