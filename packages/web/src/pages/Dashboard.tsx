import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { MetricTile } from '../components/common/metric-tile';
import { ActionItem } from '../components/common/action-item';
import { Section } from '../components/common/section';
import { SetupProgress, type SetupStep } from '../components/common/setup-progress';
import { generateActionItems, type ActionItemData, type FinancialState } from '../lib/action-generator';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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
  {
    emoji: '\uD83C\uDFAF',
    text: 'What should I focus on first?',
    prompt: 'What should I focus on financially right now?',
  },
  {
    emoji: '\uD83D\uDCB0',
    text: 'Am I on track for my age?',
    prompt: 'Am I saving enough for my age?',
  },
  {
    emoji: '\uD83D\uDCC8',
    text: 'How can I grow my net worth?',
    prompt: 'What are the best ways to grow my net worth?',
  },
];

export function Dashboard() {
  const { tenant } = useAuth();
  const { setPageContext, openChat } = usePageContext();
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

  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] as BalanceEntry[] })),
      api.getItems().catch(() => ({ items: [] as Array<{ id: string }> })),
      api.getDebts().catch(() => ({ debts: [] as Array<{ id: string; name: string; balance: number; interestRate: number | null; minimumPayment: number }>, totalDebt: 0, monthlyInterest: 0 })),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getNetWorthHistory().catch(() => ({ history: [] as Array<{ date: string; value: number }> })),
      api.getPlans().catch(() => ({ plans: [] as Array<{ id: string }> })),
      api.getInsights().catch(() => ({ insights: [] as Array<{ id: string; category: string; urgency: string; title: string; description: string; impact: string | null; impactColor: string | null; chatPrompt: string | null; generatedBy: string; createdAt: string }> })),
    ]).then(([balanceData, itemData, debtData, profileData, historyData, plansData, insightsData]) => {
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

      if (creditTotal > 0) {
        setMonthlySpend(creditTotal);
        if (depositoryTotal > 0) {
          setRunwayMonths(Math.floor(depositoryTotal / creditTotal));
        }
      }

      setInstitutionCount(itemData.items.length);

      // Net worth monthly change from history
      const nwHistory = historyData.history;
      if (nwHistory.length >= 2) {
        const latest = nwHistory[nwHistory.length - 1].value;
        const previous = nwHistory[nwHistory.length - 2].value;
        setNetWorthChange(latest - previous);
      }

      // Employer match from financial profile
      const profile = profileData.financialProfile;
      if (profile?.employerMatchPercent !== undefined) {
        setEmployerMatch(profile.employerMatchPercent);
      }

      // Debt-free date calculation
      const debtsForCalc = debtData.debts;
      const totalDebtAmount = debtData.totalDebt;
      if (totalDebtAmount > 0 && debtsForCalc.length > 0) {
        const totalMinPayment = debtsForCalc.reduce((sum, d) => sum + (d.minimumPayment || 0), 0);
        // Weighted average APR
        let weightedAprSum = 0;
        let balanceWithRate = 0;
        for (const d of debtsForCalc) {
          if (d.interestRate !== null && d.interestRate > 0) {
            weightedAprSum += d.interestRate * d.balance;
            balanceWithRate += d.balance;
          }
        }
        const avgApr = balanceWithRate > 0 ? weightedAprSum / balanceWithRate : 0;
        const monthlyRate = avgApr / 100 / 12;

        if (totalMinPayment > 0) {
          let months: number;
          if (monthlyRate > 0 && totalMinPayment > totalDebtAmount * monthlyRate) {
            // Standard amortization formula: n = -log(1 - B*r/P) / log(1+r)
            months = Math.ceil(
              -Math.log(1 - (totalDebtAmount * monthlyRate) / totalMinPayment) /
              Math.log(1 + monthlyRate)
            );
          } else if (monthlyRate === 0) {
            // No interest — simple division
            months = Math.ceil(totalDebtAmount / totalMinPayment);
          } else {
            // Payment too low to cover interest — show nothing
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

      // Compute financial state for action items
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

      // AI-generated insights take priority, fallback to rule-based actions
      const apiInsights = insightsData.insights;
      if (apiInsights.length > 0) {
        const categoryToTag: Record<string, string> = {
          portfolio: 'INVEST',
          debt: 'DEBT',
          tax: 'TAX',
          savings: 'SAVINGS',
          general: 'SETUP',
        };
        setActionItems(apiInsights.map((ins) => ({
          title: ins.title,
          tag: categoryToTag[ins.category] || ins.category.toUpperCase(),
          description: ins.description,
          impact: ins.impact || '',
          impactColor: (ins.impactColor as 'green' | 'amber' | 'red') || 'green',
          chatPrompt: ins.chatPrompt || ins.title,
          insightId: ins.id,
        })));
      } else {
        setActionItems(generateActionItems(financialState));
      }

      // Compute setup completion steps
      const hasLinked = itemData.items.length > 0;
      const profileExists = profile !== null && profile !== undefined;
      const hasProfileBasics = profileExists && profile.age !== null && profile.annualIncome !== null;

      setSetupSteps([
        {
          id: 'link-account',
          label: 'Link a bank account',
          description: 'Connect your bank to see balances and transactions',
          completed: hasLinked,
          action: '/accounts',
        },
        {
          id: 'complete-profile',
          label: 'Complete your profile',
          description: 'Add your age and income for personalized advice',
          completed: hasProfileBasics,
          action: '/profile',
        },
        {
          id: 'set-income',
          label: 'Set income & employment',
          description: 'Help us understand your earnings',
          completed: profileExists && profile.annualIncome !== null,
          action: '/profile',
        },
        {
          id: 'set-filing-status',
          label: 'Set filing status',
          description: 'Used for tax optimization recommendations',
          completed: profileExists && profile.filingStatus !== null,
          action: '/profile',
        },
        {
          id: 'set-risk-tolerance',
          label: 'Set risk tolerance',
          description: 'Tailor investment recommendations to your comfort',
          completed: profileExists && profile.riskTolerance !== null,
          action: '/profile',
        },
        {
          id: 'set-employer-match',
          label: 'Set employer match',
          description: 'Maximize your 401(k) contributions',
          completed: profileExists && profile.employerMatchPercent !== null,
          action: '/profile',
        },
        {
          id: 'review-plan',
          label: 'Review your financial plan',
          description: 'Generate a personalized financial plan',
          completed: plansData.plans.length > 0,
          action: '/plans',
        },
      ]);
    }).finally(() => setLoading(false));
  }, []);

  // Set page context for floating chat
  useEffect(() => {
    if (!loading) {
      setPageContext({
        pageId: 'dashboard',
        pageTitle: 'Dashboard',
        description: 'Overview of financial health including net worth, accounts, and plans.',
        data: {
          netWorth,
          netWorthChange,
          accountCount,
          institutionCount,
          monthlySpend,
          runwayMonths,
          totalDebt,
          emergencyFund,
          debtFreeDate,
          employerMatch,
        },
      });
    }
  }, [loading, netWorth, netWorthChange, accountCount, institutionCount, monthlySpend, runwayMonths, totalDebt, emergencyFund, debtFreeDate, employerMatch, setPageContext]);

  const firstName = tenant?.name?.split(' ')[0] || 'there';

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
          {/* Setup Progress */}
          <SetupProgress steps={setupSteps.length > 0 ? setupSteps : [
            { id: 'link-account', label: 'Link a bank account', description: 'Connect your bank to see balances', completed: false, action: '/accounts' },
            { id: 'complete-profile', label: 'Complete your profile', description: 'Add your age and income', completed: false, action: '/profile' },
            { id: 'set-income', label: 'Set income & employment', description: 'Help us understand your earnings', completed: false, action: '/profile' },
            { id: 'set-filing-status', label: 'Set filing status', description: 'For tax optimization', completed: false, action: '/profile' },
            { id: 'set-risk-tolerance', label: 'Set risk tolerance', description: 'Tailor investment advice', completed: false, action: '/profile' },
            { id: 'set-employer-match', label: 'Set employer match', description: 'Maximize 401(k) contributions', completed: false, action: '/profile' },
            { id: 'review-plan', label: 'Create a financial plan', description: 'Get a personalized plan', completed: false, action: '/plans' },
          ]} />

          {/* Metric Tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
            <MetricTile
              label="NET WORTH"
              value={netWorth !== null ? formatCurrency(netWorth) : '\u2014'}
              subtitle={
                netWorthChange !== null
                  ? `${netWorthChange >= 0 ? '+' : ''}${formatCurrency(netWorthChange)} this month`
                  : netWorth !== null
                    ? `Across ${accountCount} account${accountCount !== 1 ? 's' : ''}`
                    : 'Link accounts to track'
              }
              status={netWorth !== null && netWorth > 0 ? 'success' : 'default'}
              delay={0}
            />
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
              label="EMERGENCY FUND"
              value={emergencyFund > 0 ? formatCurrency(emergencyFund) : '\u2014'}
              subtitle={
                emergencyFund > 0 && monthlySpend
                  ? `${Math.round((emergencyFund / monthlySpend) * 10) / 10} months saved`
                  : 'Cash in depository accounts'
              }
              status={
                emergencyFund > 0 && monthlySpend && emergencyFund / monthlySpend >= 6
                  ? 'success'
                  : emergencyFund > 0
                    ? 'warning'
                    : 'default'
              }
              delay={0.08}
            />
            <MetricTile
              label="MONTHLY SPEND"
              value={monthlySpend !== null ? formatCurrency(monthlySpend) : '\u2014'}
              subtitle={monthlySpend !== null ? 'From credit card balances' : 'Link a credit card'}
              delay={0.12}
            />
            <MetricTile
              label="RUNWAY"
              value={runwayMonths !== null ? `${runwayMonths} mo` : '\u2014'}
              subtitle={runwayMonths !== null ? 'Months of expenses covered' : 'Based on cash & spending'}
              status={
                runwayMonths !== null && runwayMonths >= 6
                  ? 'success'
                  : runwayMonths !== null
                    ? 'warning'
                    : 'default'
              }
              delay={0.16}
            />
            <MetricTile
              label="LINKED ACCOUNTS"
              value={String(institutionCount)}
              subtitle={
                institutionCount > 0
                  ? `${accountCount} account${accountCount !== 1 ? 's' : ''} total`
                  : 'No accounts linked'
              }
              status={institutionCount > 0 ? 'success' : 'warning'}
              delay={0.2}
            />
            <MetricTile
              label="401(K) MATCH"
              value={employerMatch !== null ? `${employerMatch}%` : '\u2014'}
              subtitle={employerMatch !== null ? `${employerMatch}% available` : 'Not set'}
              status={employerMatch !== null && employerMatch > 0 ? 'success' : 'default'}
              delay={0.24}
            />
          </div>

          {/* Insights / Action Items */}
          {actionItems.length > 0 && (
            <Section
              title="Insights"
              actions={
                <button
                  type="button"
                  onClick={async () => {
                    await api.generateInsights();
                    const { insights: fresh } = await api.getInsights();
                    if (fresh.length > 0) {
                      const categoryToTag: Record<string, string> = { portfolio: 'INVEST', debt: 'DEBT', tax: 'TAX', savings: 'SAVINGS', general: 'SETUP' };
                      setActionItems(fresh.map((ins) => ({
                        title: ins.title, tag: categoryToTag[ins.category] || ins.category.toUpperCase(),
                        description: ins.description, impact: ins.impact || '', impactColor: (ins.impactColor as 'green' | 'amber' | 'red') || 'green',
                        chatPrompt: ins.chatPrompt || ins.title, insightId: ins.id,
                      })));
                    }
                  }}
                  className="text-xs text-text-muted hover:text-accent transition-colors"
                >
                  ↻ Refresh
                </button>
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
