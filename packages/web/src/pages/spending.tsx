import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';

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
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  income: { label: 'Income', icon: '\uD83D\uDCB0', color: '#22c55e' },
  housing: { label: 'Housing', icon: '\uD83C\uDFE0', color: '#8b5cf6' },
  transportation: { label: 'Transportation', icon: '\uD83D\uDE97', color: '#f59e0b' },
  food_dining: { label: 'Dining Out', icon: '\uD83C\uDF7D\uFE0F', color: '#ef4444' },
  groceries: { label: 'Groceries', icon: '\uD83D\uDED2', color: '#10b981' },
  utilities: { label: 'Utilities', icon: '\u26A1', color: '#6366f1' },
  healthcare: { label: 'Healthcare', icon: '\uD83C\uDFE5', color: '#ec4899' },
  insurance: { label: 'Insurance', icon: '\uD83D\uDEE1\uFE0F', color: '#14b8a6' },
  entertainment: { label: 'Entertainment', icon: '\uD83C\uDFAC', color: '#f97316' },
  shopping: { label: 'Shopping', icon: '\uD83D\uDECD\uFE0F', color: '#a855f7' },
  personal_care: { label: 'Personal Care', icon: '\uD83D\uDC87', color: '#06b6d4' },
  education: { label: 'Education', icon: '\uD83D\uDCDA', color: '#84cc16' },
  travel: { label: 'Travel', icon: '\u2708\uFE0F', color: '#0ea5e9' },
  subscriptions: { label: 'Subscriptions', icon: '\uD83D\uDCF1', color: '#d946ef' },
  savings_investment: { label: 'Savings & Investment', icon: '\uD83D\uDCC8', color: '#22d3ee' },
  debt_payment: { label: 'Debt Payment', icon: '\uD83D\uDCB3', color: '#f43f5e' },
  gifts_donations: { label: 'Gifts & Donations', icon: '\uD83C\uDF81', color: '#fb923c' },
  taxes: { label: 'Taxes', icon: '\uD83C\uDFDB\uFE0F', color: '#64748b' },
  transfer: { label: 'Transfers', icon: '\u2194\uFE0F', color: '#94a3b8' },
  other: { label: 'Other', icon: '\uD83D\uDCCB', color: '#78716c' },
};

function getCategoryDisplay(key: string) {
  return CATEGORY_CONFIG[key] ?? { label: key, icon: '\uD83D\uDCCB', color: '#78716c' };
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
// Custom Recharts Tooltip
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      {payload.map((entry: { name: string; value: number; color: string }) => (
        <p key={entry.name} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PieTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const data = payload[0];
  const cat = getCategoryDisplay(data.name);
  return (
    <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-sm font-medium text-text-primary">
        {cat.icon} {cat.label}
      </p>
      <p className="text-sm text-text-secondary">{formatCurrency(data.value)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spending Page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

export function Spending() {
  const { setPageContext } = usePageContext();

  // Month navigation
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

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

  // Loading
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingTrend, setLoadingTrend] = useState(true);
  const [loadingTx, setLoadingTx] = useState(true);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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
  }, [currentMonth]);

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
  }, [currentMonth, txPage, selectedCategory, debouncedSearch]);

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

  const prevMonth = useCallback(() => {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    setTxPage(1);
  }, []);
  const nextMonth = useCallback(() => {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    setTxPage(1);
  }, []);

  const spendingCategories = useMemo(
    () => categories.filter((c) => c.category !== 'income'),
    [categories],
  );

  // Donut chart data
  const donutData = useMemo(
    () =>
      spendingCategories.map((c) => ({
        name: c.category,
        value: Math.abs(c.total),
      })),
    [spendingCategories],
  );

  const donutColors = useMemo(
    () => spendingCategories.map((c) => getCategoryDisplay(c.category).color),
    [spendingCategories],
  );

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <h2 className="font-display text-3xl md:text-4xl font-medium tracking-tight">
          Spending
        </h2>
        <p className="text-text-muted text-sm mt-1">
          Track where your money goes each month
        </p>
      </motion.div>

      {/* Month Selector */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="flex items-center gap-3 mb-6"
      >
        <button
          onClick={prevMonth}
          className="p-2 rounded-lg border border-border hover:bg-bg-elevated transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-text-secondary" />
        </button>
        <span className="text-lg font-semibold text-text-primary min-w-[180px] text-center">
          {monthLabel(currentMonth)}
        </span>
        <button
          onClick={nextMonth}
          className="p-2 rounded-lg border border-border hover:bg-bg-elevated transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-text-secondary" />
        </button>
      </motion.div>

      {/* Quick Stats */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8"
      >
        <div className="bg-bg-elevated border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownRight className="w-4 h-4 text-danger" />
            <span className="text-xs uppercase tracking-wider text-text-muted font-semibold">
              Total Spent
            </span>
          </div>
          <p className="text-2xl font-bold text-danger">
            {loadingSummary ? '\u2014' : formatCurrency(totalSpending)}
          </p>
        </div>
        <div className="bg-bg-elevated border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpRight className="w-4 h-4 text-success" />
            <span className="text-xs uppercase tracking-wider text-text-muted font-semibold">
              Total Income
            </span>
          </div>
          <p className="text-2xl font-bold text-success">
            {loadingSummary ? '\u2014' : formatCurrency(totalIncome)}
          </p>
        </div>
        <div className="bg-bg-elevated border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-text-secondary" />
            <span className="text-xs uppercase tracking-wider text-text-muted font-semibold">
              Net Cash Flow
            </span>
          </div>
          <p
            className={`text-2xl font-bold ${
              netCashFlow >= 0 ? 'text-success' : 'text-danger'
            }`}
          >
            {loadingSummary
              ? '\u2014'
              : `${netCashFlow >= 0 ? '+' : ''}${formatCurrency(netCashFlow)}`}
          </p>
        </div>
      </motion.div>

      {/* Spending by Category + Monthly Trend — side by side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Spending by Category */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="bg-bg-elevated border border-border rounded-xl p-5"
        >
          <h3 className="text-lg font-semibold text-text-primary mb-4">
            Spending by Category
          </h3>
          {loadingSummary ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : spendingCategories.length === 0 ? (
            <p className="text-sm text-text-muted py-12 text-center">
              No spending data for this month
            </p>
          ) : (
            <>
              {/* Donut chart */}
              <div className="h-48 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {donutData.map((_, i) => (
                        <Cell key={i} fill={donutColors[i]} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Category list */}
              <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
                {spendingCategories.map((cat) => {
                  const display = getCategoryDisplay(cat.category);
                  const isSelected = selectedCategory === cat.category;
                  return (
                    <button
                      key={cat.category}
                      onClick={() =>
                        setSelectedCategory(isSelected ? null : cat.category)
                      }
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                        isSelected
                          ? 'bg-accent/10 border border-accent/20'
                          : 'hover:bg-bg-surface border border-transparent'
                      }`}
                    >
                      <span className="text-lg flex-shrink-0">{display.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-text-primary truncate">
                            {display.label}
                          </span>
                          <span className="text-sm font-semibold text-text-primary ml-2 flex-shrink-0">
                            {formatCurrency(Math.abs(cat.total))}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-bg-surface rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${cat.percentage}%`,
                                backgroundColor: display.color,
                              }}
                            />
                          </div>
                          <span className="text-xs text-text-muted flex-shrink-0 w-16 text-right">
                            {cat.percentage.toFixed(1)}% &middot; {cat.count}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </motion.div>

        {/* Monthly Trend */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="bg-bg-elevated border border-border rounded-xl p-5"
        >
          <h3 className="text-lg font-semibold text-text-primary mb-4">
            Monthly Trend
          </h3>
          {loadingTrend ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : trendData.length === 0 ? (
            <p className="text-sm text-text-muted py-12 text-center">
              No trend data available
            </p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    width={48}
                  />
                  <Tooltip content={<TrendTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="income"
                    name="Income"
                    stroke="#22c55e"
                    strokeWidth={2}
                    fill="url(#incomeGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    name="Expenses"
                    stroke="#ef4444"
                    strokeWidth={2}
                    fill="url(#expenseGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="net"
                    name="Net"
                    stroke="#60a5fa"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    fill="none"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Legend */}
          {trendData.length > 0 && (
            <div className="flex items-center gap-5 mt-4 justify-center">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
                <span className="text-xs text-text-muted">Income</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ef4444]" />
                <span className="text-xs text-text-muted">Expenses</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 border-t-2 border-dashed border-[#60a5fa]" />
                <span className="text-xs text-text-muted">Net</span>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Transaction List */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.25 }}
        className="bg-bg-elevated border border-border rounded-xl p-5 mb-8"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-semibold text-text-primary">Transactions</h3>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Category filter */}
            <select
              value={selectedCategory || ''}
              onChange={(e) => setSelectedCategory(e.target.value || null)}
              className="bg-bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none cursor-pointer"
            >
              <option value="">All Categories</option>
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>
                  {cfg.icon} {cfg.label}
                </option>
              ))}
            </select>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                placeholder="Search merchants..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-bg-surface border border-border rounded-lg pl-9 pr-8 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 w-52"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Active filters */}
        {(selectedCategory || debouncedSearch) && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {selectedCategory && (
              <span className="inline-flex items-center gap-1 bg-accent/10 text-accent text-xs font-medium px-2.5 py-1 rounded-full">
                {getCategoryDisplay(selectedCategory).icon}{' '}
                {getCategoryDisplay(selectedCategory).label}
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="ml-0.5 hover:text-accent/70"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {debouncedSearch && (
              <span className="inline-flex items-center gap-1 bg-bg-surface text-text-secondary text-xs font-medium px-2.5 py-1 rounded-full">
                Search: &ldquo;{debouncedSearch}&rdquo;
                <button
                  onClick={() => setSearchQuery('')}
                  className="ml-0.5 hover:text-text-primary"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        )}

        {/* Transaction rows */}
        {loadingTx ? (
          <div className="flex items-center justify-center py-12 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading transactions...</span>
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-text-muted py-12 text-center">
            No transactions found
          </p>
        ) : (
          <div className="divide-y divide-border">
            {transactions.map((tx) => {
              const amount = parseFloat(tx.amount);
              const isIncome = amount > 0;
              const display = getCategoryDisplay(tx.category);
              const dateStr = new Date(tx.date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });

              return (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 py-3 px-1 hover:bg-bg-surface/50 rounded-lg transition-colors"
                >
                  {/* Icon */}
                  <span className="text-lg flex-shrink-0 w-8 text-center">
                    {display.icon}
                  </span>

                  {/* Name + details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {tx.merchantName || tx.name}
                    </p>
                    <p className="text-xs text-text-muted truncate">
                      {dateStr}
                    </p>
                  </div>

                  {/* Category badge */}
                  <span
                    className="hidden sm:inline-flex text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: `${display.color}15`,
                      color: display.color,
                    }}
                  >
                    {display.label}
                  </span>

                  {/* Amount */}
                  <span
                    className={`text-sm font-semibold flex-shrink-0 ${
                      isIncome ? 'text-success' : 'text-danger'
                    }`}
                  >
                    {isIncome ? '+' : ''}
                    {formatCurrencyExact(amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {txTotal > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
            <p className="text-xs text-text-muted">
              Showing {(txPage - 1) * PAGE_SIZE + 1}&ndash;
              {Math.min(txPage * PAGE_SIZE, txTotal)} of {txTotal}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                disabled={txPage <= 1}
                className="p-2 rounded-lg border border-border text-text-secondary hover:bg-bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-text-secondary px-3">
                {txPage} / {totalPages}
              </span>
              <button
                onClick={() => setTxPage((p) => Math.min(totalPages, p + 1))}
                disabled={txPage >= totalPages}
                className="p-2 rounded-lg border border-border text-text-secondary hover:bg-bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
