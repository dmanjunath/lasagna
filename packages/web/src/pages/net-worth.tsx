import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Building2 } from 'lucide-react';
import { cn, formatMoney } from '../lib/utils';
import { Section } from '../components/common/section';
import { AreaChart } from '../components/charts/area-chart';
import { DonutChart } from '../components/charts/pie-chart';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';

interface AccountCategory {
  category: string;
  value: number;
  color: string;
  accounts: Array<{
    name: string;
    balance: number;
    institution: string;
  }>;
}

// Color mapping for account types
const typeColors: Record<string, string> = {
  depository: '#4ade80',
  investment: '#60a5fa',
  credit: '#f87171',
  loan: '#f87171',
};

export function NetWorth() {
  const [, navigate] = useLocation();
  const [balances, setBalances] = useState<Array<{
    accountId: string;
    name: string;
    type: string;
    mask: string | null;
    balance: string | null;
    currency: string;
  }>>([]);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [historyData, setHistoryData] = useState<Array<{ date: string; value: number }>>([]);

  useEffect(() => {
    Promise.all([
      api.getBalances(),
      api.getNetWorthHistory().catch(() => ({ history: [] })),
    ])
      .then(([balanceData, historyRes]) => {
        setBalances(balanceData.balances);
        // Expand all by default
        const expanded: Record<string, boolean> = {};
        const types = new Set(balanceData.balances.map((b) => b.type));
        types.forEach((t) => { expanded[t] = true; });
        setExpandedCategories(expanded);

        // Format history for chart
        setHistoryData(historyRes.history);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  // Group accounts by type
  const categories: AccountCategory[] = Object.entries(
    balances.reduce<Record<string, { value: number; accounts: Array<{ name: string; balance: number; institution: string }> }>>(
      (acc, b) => {
        const type = b.type;
        if (!acc[type]) acc[type] = { value: 0, accounts: [] };
        const balance = parseFloat(b.balance || '0');
        acc[type].value += balance;
        acc[type].accounts.push({ name: b.name, balance, institution: 'Linked Account' });
        return acc;
      },
      {}
    )
  ).map(([category, data]) => ({
    category: category.charAt(0).toUpperCase() + category.slice(1),
    value: data.value,
    color: typeColors[category] || '#a8a29e',
    accounts: data.accounts,
  }));

  const totalNetWorth = categories.reduce((sum, c) => {
    return c.category.toLowerCase() === 'credit' || c.category.toLowerCase() === 'loan'
      ? sum - c.value
      : sum + c.value;
  }, 0);
  const assets = categories.filter((c) => c.value > 0);
  const totalAssets = assets.reduce((sum, c) => sum + c.value, 0);

  const pieData = assets.map((c) => ({
    name: c.category,
    value: c.value,
    color: c.color,
  }));

  // Compute change from history
  const change = historyData.length >= 2
    ? historyData[historyData.length - 1].value - historyData[0].value
    : null;
  const changePercent = change !== null && historyData[0].value !== 0
    ? (change / Math.abs(historyData[0].value)) * 100
    : null;

  // Format history for chart display
  const chartData = historyData.map((d) => {
    const date = new Date(d.date);
    return {
      month: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: d.value,
    };
  });

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  // Empty state when no accounts are linked
  if (balances.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center"
        >
          <Building2 className="w-16 h-16 text-text-muted mb-6" />
          <h2 className="font-display text-2xl md:text-3xl font-medium mb-3">
            No Accounts Linked
          </h2>
          <p className="text-text-muted max-w-md mb-8">
            Connect your bank accounts to track your net worth, view balances, and get personalized financial insights.
          </p>
          <Button onClick={() => navigate('/accounts')}>
            <Plus className="w-4 h-4 mr-2" />
            Link Your First Account
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      {/* Net Worth Over Time */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-4 md:p-8 mb-6 md:mb-8"
      >
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-4 md:mb-6 gap-4">
          <div>
            <p className="text-text-muted text-sm mb-2">Total Net Worth</p>
            <div className="font-display text-4xl md:text-5xl font-semibold tracking-tight tabular-nums">
              {formatMoney(totalNetWorth)}
            </div>
          </div>
          <div className="flex flex-col md:items-end gap-2">
            {change !== null && (
              <div className="text-left md:text-right">
                <div className={cn(
                  'text-xl md:text-2xl font-semibold tabular-nums',
                  change >= 0 ? 'text-success' : 'text-danger'
                )}>
                  {change >= 0 ? '+' : ''}{formatMoney(change)}
                </div>
                {changePercent !== null && (
                  <div className="text-sm text-text-muted mt-1">
                    {change >= 0 ? '+' : ''}{changePercent.toFixed(1)}% over period
                  </div>
                )}
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={() => navigate('/accounts')}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add Account
            </Button>
          </div>
        </div>
        {chartData.length > 1 ? (
          <AreaChart
            data={chartData}
            xKey="month"
            yKey="value"
            height={200}
          />
        ) : (
          <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">
            Sync your accounts again to build history over time
          </div>
        )}
      </motion.div>

      {/* Asset Allocation */}
      {pieData.length > 0 && (
        <Section title="Asset Allocation">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-2xl p-4 md:p-6"
          >
            <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8">
              <DonutChart data={pieData} size={200} />
              <div className="flex-1 grid grid-cols-2 gap-3 md:gap-4 w-full">
                {assets.map((item) => (
                  <div key={item.category} className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.category}</div>
                      <div className="text-xs text-text-muted tabular-nums">
                        {((item.value / totalAssets) * 100).toFixed(1)}% · {formatMoney(item.value, true)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </Section>
      )}

      {/* Accounts */}
      <Section title="Accounts">
        <div className="space-y-3">
          {categories.map((category, i) => (
            <motion.div
              key={category.category}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              className="glass-card rounded-2xl overflow-hidden"
            >
              <button
                onClick={() => toggleCategory(category.category)}
                className="w-full p-4 md:p-5 text-left hover:bg-surface-hover transition-all duration-200"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="font-medium">{category.category}</span>
                    <span className="text-sm text-text-muted px-2 py-0.5 rounded-full bg-surface-solid">
                      {category.accounts.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={cn(
                        'font-display text-lg md:text-xl font-semibold tabular-nums',
                        category.value < 0 && 'text-danger'
                      )}
                    >
                      {formatMoney(category.value)}
                    </span>
                    <motion.span
                      animate={{ rotate: expandedCategories[category.category] ? 180 : 0 }}
                      className="text-text-muted"
                    >
                      ▾
                    </motion.span>
                  </div>
                </div>
              </button>

              <AnimatePresence>
                {expandedCategories[category.category] && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-border bg-bg/30 overflow-hidden"
                  >
                    {category.accounts.map((account, j) => (
                      <motion.div
                        key={j}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: j * 0.05 }}
                        className="px-4 md:px-5 py-3 md:py-4 flex items-center justify-between hover:bg-surface-hover transition-colors"
                      >
                        <div className="flex items-center gap-3 md:gap-4 pl-4 md:pl-6">
                          <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-surface-solid flex items-center justify-center text-xs md:text-sm font-medium text-text-muted">
                            {account.institution.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-sm md:text-base">{account.name}</div>
                            <div className="text-xs md:text-sm text-text-muted">{account.institution}</div>
                          </div>
                        </div>
                        <span
                          className={cn(
                            'font-medium tabular-nums text-sm md:text-base',
                            account.balance < 0 && 'text-danger'
                          )}
                        >
                          {formatMoney(account.balance)}
                        </span>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </Section>
    </div>
  );
}
