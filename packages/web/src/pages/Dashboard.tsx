import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Loader2, TrendingUp, TrendingDown, ArrowRight, Plus, Target, ChevronRight } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { useChatStore } from '../lib/chat-store';
import { MetricTile } from '../components/common/metric-tile';
import { ActionItem } from '../components/common/action-item';
import { Section } from '../components/common/section';
import { SetupProgress, type SetupStep } from '../components/common/setup-progress';
import { generateActionItems, type ActionItemData, type FinancialState } from '../lib/action-generator';
import { cn } from '../lib/utils';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

interface BalanceEntry {
  accountId: string;
  name: string;
  type: string;
  mask: string | null;
  balance: string | null;
  available: string | null;
  currency: string;
  asOf: string | null;
}

const ASK_PROMPTS = [
  { emoji: '\uD83C\uDFAF', text: 'What should I focus on first?', prompt: 'What should I focus on financially right now?' },
  { emoji: '\uD83D\uDCB0', text: 'Am I on track for my age?', prompt: 'Am I saving enough for my age?' },
  { emoji: '\uD83D\uDCC8', text: 'How can I grow my net worth?', prompt: 'What are the best ways to grow my net worth?' },
];

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  income: { label: 'Income', icon: '💰', color: '#22c55e' },
  housing: { label: 'Housing', icon: '🏠', color: '#8b5cf6' },
  transportation: { label: 'Transport', icon: '🚗', color: '#f59e0b' },
  food_dining: { label: 'Dining', icon: '🍽️', color: '#ef4444' },
  groceries: { label: 'Groceries', icon: '🛒', color: '#10b981' },
  utilities: { label: 'Utilities', icon: '⚡', color: '#6366f1' },
  healthcare: { label: 'Health', icon: '🏥', color: '#ec4899' },
  insurance: { label: 'Insurance', icon: '🛡️', color: '#14b8a6' },
  entertainment: { label: 'Fun', icon: '🎬', color: '#f97316' },
  shopping: { label: 'Shopping', icon: '🛍️', color: '#a855f7' },
  subscriptions: { label: 'Subs', icon: '📱', color: '#d946ef' },
  savings_investment: { label: 'Savings', icon: '📈', color: '#22d3ee' },
  debt_payment: { label: 'Debt', icon: '💳', color: '#f43f5e' },
  transfer: { label: 'Transfers', icon: '↔️', color: '#94a3b8' },
  other: { label: 'Other', icon: '📋', color: '#78716c' },
};

// Financial Health Score calculation
function calculateHealthScore(data: {
  netWorth: number | null;
  totalDebt: number;
  emergencyFundMonths: number;
  hasProfile: boolean;
  hasAccounts: boolean;
  savingsRate: number | null;
}): { score: number; grade: string; color: string } {
  let score = 0;
  const max = 100;

  // Net worth positive (0-25 points)
  if (data.netWorth !== null) {
    if (data.netWorth > 0) score += Math.min(25, Math.floor(data.netWorth / 10000));
    else score += 0;
  }

  // Emergency fund (0-25 points)
  score += Math.min(25, data.emergencyFundMonths * 4);

  // Debt ratio (0-25 points) - lower is better
  if (data.netWorth !== null && data.netWorth > 0) {
    const debtRatio = data.totalDebt / (data.netWorth + data.totalDebt);
    score += Math.floor((1 - debtRatio) * 25);
  } else if (data.totalDebt === 0) {
    score += 25;
  }

  // Setup completeness (0-15 points)
  if (data.hasAccounts) score += 8;
  if (data.hasProfile) score += 7;

  // Savings rate bonus (0-10 points)
  if (data.savingsRate !== null && data.savingsRate > 0) {
    score += Math.min(10, Math.floor(data.savingsRate * 50));
  }

  score = Math.min(max, score);

  let grade: string;
  let color: string;
  if (score >= 80) { grade = 'Excellent'; color = '#22c55e'; }
  else if (score >= 65) { grade = 'Good'; color = '#84cc16'; }
  else if (score >= 50) { grade = 'Fair'; color = '#f59e0b'; }
  else if (score >= 35) { grade = 'Needs Work'; color = '#f97316'; }
  else { grade = 'Getting Started'; color = '#ef4444'; }

  return { score, grade, color };
}

export function Dashboard() {
  const { tenant } = useAuth();
  const { setPageContext } = usePageContext();
  const { openChat } = useChatStore();
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(true);
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [netWorthChange, setNetWorthChange] = useState<number | null>(null);
  const [totalDebt, setTotalDebt] = useState<number>(0);
  const [emergencyFund, setEmergencyFund] = useState<number>(0);
  const [monthlySpend, setMonthlySpend] = useState<number | null>(null);
  const [runwayMonths, setRunwayMonths] = useState<number | null>(null);
  const [accountCount, setAccountCount] = useState(0);
  const [institutionCount, setInstitutionCount] = useState(0);
  const [debtFreeDate, setDebtFreeDate] = useState<string | null>(null);
  const [employerMatch, setEmployerMatch] = useState<number | null>(null);
  const [actionItems, setActionItems] = useState<ActionItemData[]>([]);
  const [setupSteps, setSetupSteps] = useState<SetupStep[]>([]);
  const [nwHistory, setNwHistory] = useState<Array<{ date: string; value: number }>>([]);
  const [spendingCategories, setSpendingCategories] = useState<Array<{ category: string; total: number; count: number; percentage: number }>>([]);
  const [totalSpending, setTotalSpending] = useState(0);
  const [totalIncome, setTotalIncome] = useState(0);
  const [goals, setGoals] = useState<Array<{ id: string; name: string; targetAmount: string; currentAmount: string; deadline: string | null; category: string; status: string; icon: string | null }>>([]);
  const [healthScore, setHealthScore] = useState<{ score: number; grade: string; color: string } | null>(null);
  const [hasPlaidAccounts, setHasPlaidAccounts] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] as BalanceEntry[] })),
      api.getItems().catch(() => ({ items: [] as Array<{ id: string }> })),
      api.getDebts().catch(() => ({ debts: [] as Array<{ id: string; name: string; balance: number; interestRate: number | null; minimumPayment: number }>, totalDebt: 0, monthlyInterest: 0 })),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getNetWorthHistory().catch(() => ({ history: [] as Array<{ date: string; value: number }> })),
      api.getPlans().catch(() => ({ plans: [] as Array<{ id: string }> })),
      api.getInsights().catch(() => ({ insights: [] as Array<{ id: string; category: string; urgency: string; title: string; description: string; impact: string | null; impactColor: string | null; chatPrompt: string | null; generatedBy: string; createdAt: string }> })),
      api.getSpendingSummary().catch(() => ({ categories: [], totalSpending: 0, totalIncome: 0, netCashFlow: 0, period: { start: '', end: '' } })),
      api.getGoals().catch(() => ({ goals: [] })),
    ]).then(([balanceData, itemData, debtData, profileData, historyData, plansData, insightsData, spendingData, goalsData]) => {
      // Redirect to onboarding if user has no data at all (and hasn't completed it)
      const onboardingDone = localStorage.getItem('lasagna_onboarding_done');
      if (balanceData.balances.length === 0 && !profileData.financialProfile && !onboardingDone) {
        navigate('/onboarding', { replace: true });
        return;
      }

      const balances = balanceData.balances;

      let totalAssets = 0;
      let totalLiabilities = 0;
      let depositoryTotal = 0;
      let investmentTotal = 0;
      let creditTotal = 0;

      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        if (b.type === 'credit' || b.type === 'loan') {
          totalLiabilities += val;
          if (b.type === 'credit') creditTotal += val;
        } else {
          totalAssets += val;
          if (b.type === 'depository') depositoryTotal += val;
          if (b.type === 'investment') investmentTotal += val;
        }
      }

      if (balances.length > 0) {
        setNetWorth(totalAssets - totalLiabilities);
      }
      setTotalDebt(totalLiabilities);
      setEmergencyFund(depositoryTotal);
      setAccountCount(balances.length);

      // Only set monthlySpend from real transaction data, not credit card balances
      // Credit card balance != monthly spend (it's outstanding debt)

      const realPlaidItems = itemData.items.filter((item: { institutionId: string | null }) => item.institutionId && item.institutionId !== 'manual');
      setHasPlaidAccounts(realPlaidItems.length > 0);
      setInstitutionCount(itemData.items.length);

      // Net worth history
      const nwHist = historyData.history;
      setNwHistory(nwHist);
      if (nwHist.length >= 2) {
        const latest = nwHist[nwHist.length - 1].value;
        const previous = nwHist[nwHist.length - 2].value;
        setNetWorthChange(latest - previous);
      }

      // Profile
      const profile = profileData.financialProfile;
      const profileExists = profile !== null && profile !== undefined;
      const hasProfile = profileExists && profile.annualIncome !== null;
      if (profile?.employerMatchPercent !== undefined) {
        setEmployerMatch(profile.employerMatchPercent);
      }

      // Spending data
      setSpendingCategories(spendingData.categories.filter((c: { category: string }) => c.category !== 'income'));
      setTotalSpending(spendingData.totalSpending);
      setTotalIncome(spendingData.totalIncome);

      // Goals
      setGoals(goalsData.goals);

      // Debt-free date
      const debtsForCalc = debtData.debts;
      const totalDebtAmount = debtData.totalDebt;
      if (totalDebtAmount > 0 && debtsForCalc.length > 0) {
        const totalMinPayment = debtsForCalc.reduce((sum: number, d: { minimumPayment: number }) => sum + (d.minimumPayment || 0), 0);
        let weightedAprSum = 0;
        let totalBalance = 0;
        for (const d of debtsForCalc) {
          const isMortgage = d.name?.toLowerCase().includes('mortgage');
          const apr = d.interestRate ?? (d.type === 'credit' ? 21.99 : isMortgage ? 6.5 : 8.0);
          weightedAprSum += apr * d.balance;
          totalBalance += d.balance;
        }
        const avgApr = totalBalance > 0 ? weightedAprSum / totalBalance : 0;
        const monthlyRate = avgApr / 100 / 12;

        if (totalMinPayment > 0) {
          let months: number;
          if (monthlyRate > 0 && totalMinPayment > totalDebtAmount * monthlyRate) {
            months = Math.ceil(-Math.log(1 - (totalDebtAmount * monthlyRate) / totalMinPayment) / Math.log(1 + monthlyRate));
          } else if (monthlyRate === 0) {
            months = Math.ceil(totalDebtAmount / totalMinPayment);
          } else {
            months = -1;
          }
          if (months > 0) {
            const target = new Date();
            target.setMonth(target.getMonth() + months);
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            setDebtFreeDate(`${monthNames[target.getMonth()]} ${target.getFullYear()}`);
          }
        }
      }

      // Health score
      const emergencyMonths = creditTotal > 0 ? depositoryTotal / creditTotal : (depositoryTotal > 0 ? 12 : 0);
      const savingsRate = totalIncome > 0 ? (spendingData.totalIncome - spendingData.totalSpending) / spendingData.totalIncome : null;
      setHealthScore(calculateHealthScore({
        netWorth: totalAssets - totalLiabilities,
        totalDebt: totalLiabilities,
        emergencyFundMonths: emergencyMonths,
        hasProfile: profileExists && profile.annualIncome !== null,
        hasAccounts: itemData.items.length > 0,
        savingsRate,
      }));

      // Action items
      const debts = debtData.debts;
      let highestApr: number | null = null;
      let highestAprCreditor: string | null = null;
      for (const d of debts) {
        if (d.interestRate !== null && (highestApr === null || d.interestRate > highestApr)) {
          highestApr = d.interestRate;
          highestAprCreditor = d.name;
        }
      }

      const financialState: FinancialState = {
        totalDebt: debtData.totalDebt || totalLiabilities,
        totalDepository: depositoryTotal,
        totalInvestment: investmentTotal,
        monthlyExpenses: creditTotal,
        hasLinkedAccounts: itemData.items.length > 0,
        employerMatchPercent: profile?.employerMatchPercent ?? null,
        annualIncome: profile?.annualIncome ?? null,
        riskTolerance: profile?.riskTolerance ?? null,
        debtCount: debts.length,
        highestApr,
        highestAprCreditor,
      };

      const apiInsights = insightsData.insights;
      if (apiInsights.length > 0) {
        setActionItems(apiInsights.map((ins) => ({
          title: ins.title,
          tag: (ins.type || ins.category || 'general').toUpperCase(),
          description: ins.description,
          impact: ins.impact || '',
          impactColor: (ins.impactColor as 'green' | 'amber' | 'red') || 'green',
          chatPrompt: ins.chatPrompt || ins.title,
          insightId: ins.id,
        })));
      } else {
        setActionItems(generateActionItems(financialState));
      }

      // Setup steps
      const hasLinked = itemData.items.length > 0;
      const hasProfileBasics = profileExists && profile.age !== null && profile.annualIncome !== null;

      setSetupSteps([
        { id: 'link-account', label: 'Link a bank account', description: 'Connect your bank to see balances and transactions', completed: hasLinked, action: '/accounts' },
        { id: 'complete-profile', label: 'Complete your profile', description: 'Add your age and income for personalized advice', completed: hasProfileBasics, action: '/profile' },
        { id: 'set-income', label: 'Set income & employment', description: 'Help us understand your earnings', completed: profileExists && profile.annualIncome !== null, action: '/profile' },
        { id: 'set-filing-status', label: 'Set filing status', description: 'Used for tax optimization recommendations', completed: profileExists && profile.filingStatus !== null, action: '/profile' },
        { id: 'set-risk-tolerance', label: 'Set risk tolerance', description: 'Tailor investment recommendations to your comfort', completed: profileExists && profile.riskTolerance !== null, action: '/profile' },
        { id: 'set-employer-match', label: 'Set employer match', description: 'Maximize your 401(k) contributions', completed: profileExists && profile.employerMatchPercent !== null, action: '/profile' },
        { id: 'review-plan', label: 'Review your financial plan', description: 'Generate a personalized financial plan', completed: plansData.plans.length > 0, action: '/plans' },
      ]);
    }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Page context for floating chat
  useEffect(() => {
    if (!loading) {
      setPageContext({
        pageId: 'dashboard',
        pageTitle: 'Dashboard',
        description: 'Overview of financial health including net worth, accounts, and plans.',
        data: { netWorth, netWorthChange, accountCount, institutionCount, monthlySpend, runwayMonths, totalDebt, emergencyFund, debtFreeDate, employerMatch },
      });
    }
  }, [loading, netWorth, netWorthChange, accountCount, institutionCount, monthlySpend, runwayMonths, totalDebt, emergencyFund, debtFreeDate, employerMatch, setPageContext]);

  // Use first word of tenant name, but skip "Seed" prefix from seed data
  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'there' : (rawName.split(' ')[0] || 'there');
  const completedSteps = setupSteps.filter(s => s.completed).length;
  const allSetupComplete = completedSteps === setupSteps.length;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-medium tracking-tight">
          {getGreeting()} <span className="capitalize">{firstName}</span>
        </h2>
      </motion.div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-muted py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : (
        <>
          {/* Setup Progress - only show if incomplete */}
          {!allSetupComplete && (
            <SetupProgress steps={setupSteps} />
          )}

          {/* Link accounts nudge */}
          {!hasPlaidAccounts && accountCount > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.4 }}
              className="mb-4 bg-accent/5 border border-accent/20 rounded-xl px-4 py-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">🔗</span>
                <div>
                  <p className="text-sm font-medium">Link your bank for automatic updates</p>
                  <p className="text-xs text-text-muted">Your balances are manual snapshots. Connect via Plaid for real-time tracking.</p>
                </div>
              </div>
              <a href="/accounts" className="flex-shrink-0 px-3 py-1.5 bg-accent text-bg text-xs font-semibold rounded-lg hover:bg-accent/90 transition-colors">
                Link Account
              </a>
            </motion.div>
          )}

          {/* Net Worth Hero */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.4 }}
            className="mb-8"
          >
            <p className="text-sm text-text-muted mb-1">Net Worth</p>
            <div className="flex items-baseline gap-3">
              <p className="font-display text-4xl md:text-5xl lg:text-6xl font-semibold tabular-nums tracking-tight">
                {netWorth !== null ? formatCurrency(netWorth) : '—'}
              </p>
              {netWorthChange !== null && (
                <span className={cn('text-sm font-medium', netWorthChange >= 0 ? 'text-success' : 'text-danger')}>
                  {netWorthChange >= 0 ? '+' : ''}{formatCurrency(netWorthChange)}
                </span>
              )}
            </div>
            {nwHistory.length > 1 && (
              <div className="h-28 mt-3 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={nwHistory} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <defs>
                      <linearGradient id="nwGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34c759" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#34c759" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: '#666' }}
                      tickFormatter={(d: string) => {
                        const date = new Date(d + 'T00:00:00');
                        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }}
                      interval="preserveStartEnd"
                      minTickGap={40}
                    />
                    <YAxis domain={['dataMin - 1000', 'dataMax + 1000']} hide />
                    <Area type="monotone" dataKey="value" stroke="#34c759" strokeWidth={1.5} fill="url(#nwGradient)" dot={false} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          const date = new Date(label + 'T00:00:00');
                          return (
                            <div className="bg-bg-elevated border border-border rounded-lg px-3 py-1.5 text-xs shadow-lg">
                              <div className="text-text-muted mb-0.5">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                              <span className="font-semibold">{formatCurrency(payload[0].value as number)}</span>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </motion.div>

          {/* Key Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {totalDebt > 0 && (
              <MetricTile
                label="TOTAL DEBT"
                value={formatCurrency(totalDebt)}
                subtitle={debtFreeDate ? `Debt-free by ${debtFreeDate}` : 'Active liabilities'}
                status="danger"
                delay={0.04}
              />
            )}
            <MetricTile
              label="CASH & SAVINGS"
              value={emergencyFund > 0 ? formatCurrency(emergencyFund) : '—'}
              subtitle={
                emergencyFund > 0 && totalSpending > 0
                  ? `${Math.round((emergencyFund / totalSpending) * 10) / 10} months saved`
                  : 'Cash in depository accounts'
              }
              status={
                emergencyFund > 0 && totalSpending > 0 && emergencyFund / totalSpending >= 6
                  ? 'success'
                  : emergencyFund > 0
                    ? 'warning'
                    : 'default'
              }
              delay={0.08}
            />
            <MetricTile
              label="MONTHLY INCOME"
              value={totalIncome > 0 ? formatCurrency(totalIncome) : '—'}
              subtitle={totalIncome > 0 && totalSpending > 0 ? `${Math.round((1 - totalSpending / totalIncome) * 100)}% savings rate` : 'From linked accounts'}
              status={totalIncome > 0 ? 'success' : 'default'}
              delay={0.12}
            />
            <MetricTile
              label="MONTHLY SPEND"
              value={totalSpending > 0 ? formatCurrency(totalSpending) : '—'}
              subtitle={totalSpending > 0 ? `Across ${spendingCategories.length} categories` : 'Link accounts to track'}
              delay={0.16}
            />
          </div>

          {/* Spending Breakdown + Goals Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Spending Breakdown */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="bg-bg-elevated border border-border rounded-xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm uppercase tracking-wider text-text-secondary font-semibold">This Month&apos;s Spending</h3>
                <button
                  onClick={() => navigate('/spending')}
                  className="text-xs text-text-muted hover:text-accent transition-colors flex items-center gap-1"
                >
                  Details <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {spendingCategories.length > 0 ? (
                <div className="flex gap-4">
                  <div className="w-24 h-24 flex-shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={spendingCategories.slice(0, 6)}
                          dataKey="total"
                          nameKey="category"
                          innerRadius={25}
                          outerRadius={42}
                          strokeWidth={0}
                        >
                          {spendingCategories.slice(0, 6).map((entry) => (
                            <Cell key={entry.category} fill={CATEGORY_CONFIG[entry.category]?.color || '#78716c'} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-2 min-w-0">
                    {spendingCategories.slice(0, 5).map((cat) => {
                      const config = CATEGORY_CONFIG[cat.category] || CATEGORY_CONFIG.other;
                      return (
                        <div key={cat.category} className="flex items-center gap-2">
                          <span className="text-sm flex-shrink-0">{config.icon}</span>
                          <span className="text-xs text-text-secondary truncate flex-1">{config.label}</span>
                          <span className="text-xs font-semibold tabular-nums">{formatCompact(cat.total)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-text-muted py-4 text-center">
                  No spending data yet. Link accounts to track spending.
                </div>
              )}
            </motion.div>

            {/* Goals Progress */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4 }}
              className="bg-bg-elevated border border-border rounded-xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm uppercase tracking-wider text-text-secondary font-semibold">Goals</h3>
                <button
                  onClick={() => navigate('/goals')}
                  className="text-xs text-text-muted hover:text-accent transition-colors flex items-center gap-1"
                >
                  {goals.length > 0 ? 'View all' : 'Set goals'} <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {goals.length > 0 ? (
                <div className="space-y-3">
                  {goals.slice(0, 3).map((goal) => {
                    const target = parseFloat(goal.targetAmount);
                    const current = parseFloat(goal.currentAmount);
                    const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                    return (
                      <div key={goal.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium flex items-center gap-1.5">
                            {goal.icon || '🎯'} {goal.name}
                          </span>
                          <span className="text-xs text-text-muted tabular-nums">{Math.round(pct)}%</span>
                        </div>
                        <div className="h-2 bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: pct >= 100 ? '#22c55e' : pct >= 50 ? '#84cc16' : '#f59e0b',
                            }}
                          />
                        </div>
                        <div className="flex justify-between mt-0.5">
                          <span className="text-xs text-text-muted">{formatCompact(current)}</span>
                          <span className="text-xs text-text-muted">{formatCompact(target)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4">
                  <Target className="w-8 h-8 text-text-muted mx-auto mb-2" />
                  <p className="text-sm text-text-muted mb-3">Set financial goals to track your progress</p>
                  <button
                    onClick={() => navigate('/goals')}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent/80 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Create a goal
                  </button>
                </div>
              )}
            </motion.div>
          </div>

          {/* empty - removed low-value metrics */}

          {/* Insights / Action Items */}
          {actionItems.length > 0 && (
            <Section
              title="Insights"
              actions={
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate('/insights')}
                    className="text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    View all →
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.generateInsights();
                      const { insights: fresh } = await api.getInsights();
                      if (fresh.length > 0) {
                        const categoryToTag: Record<string, string> = { portfolio: 'INVEST', debt: 'DEBT', tax: 'TAX', savings: 'SAVINGS', general: 'SETUP' };
                        setActionItems(fresh.map((ins) => ({
                          title: ins.title, tag: (ins.type || ins.category || 'general').toUpperCase(),
                          description: ins.description, impact: ins.impact || '', impactColor: (ins.impactColor as 'green' | 'amber' | 'red') || 'green',
                          chatPrompt: ins.chatPrompt || ins.title, insightId: ins.id,
                        })));
                      }
                    }}
                    className="text-xs text-text-muted hover:text-accent transition-colors"
                  >
                    ↻ Refresh
                  </button>
                </div>
              }
            >
              <div className="bg-bg-elevated border border-border rounded-xl px-4">
                {actionItems.map((item, i) => (
                  <ActionItem
                    key={item.insightId || item.title}
                    title={item.title}
                    tag={item.tag}
                    description={item.description}
                    impact={item.impact}
                    impactColor={item.impactColor}
                    chatPrompt={item.chatPrompt}
                    defaultOpen={i === 0}
                    onDismiss={item.insightId ? async () => {
                      await api.dismissInsight(item.insightId!);
                      setActionItems(prev => prev.filter(a => a.insightId !== item.insightId));
                    } : undefined}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Ask Lasagna — mobile only */}
          <Section title="Ask Lasagna" className="md:hidden">
            <div className="grid grid-cols-1 gap-2">
              {ASK_PROMPTS.map((p) => (
                <button
                  key={p.prompt}
                  type="button"
                  onClick={() => openChat(p.prompt)}
                  className="flex items-center gap-3 bg-bg-elevated border border-border rounded-xl px-4 py-3 text-left hover:border-accent/40 transition-colors"
                >
                  <span className="text-lg">{p.emoji}</span>
                  <span className="text-sm text-text-secondary font-medium">{p.text}</span>
                </button>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
