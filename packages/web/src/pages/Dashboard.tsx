import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { SetupProgress, type SetupStep } from '../components/common/setup-progress';
import { LayerHomeScreen } from '../components/layer-home/LayerHomeScreen';
import { getDefaultMockPersona } from '../components/layer-home/layer-mocks';
import type { PriorityStep, PrioritySummary, MockInsight, MockDebt } from '../components/layer-home/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function calcHealthScore(data: {
  netWorth: number | null;
  totalDebt: number;
  emergencyFundMonths: number;
  hasProfile: boolean;
  hasAccounts: boolean;
  savingsRate: number | null;
}): { score: number; grade: string; color: string } {
  let score = 0;
  if (data.netWorth !== null && data.netWorth > 0)
    score += Math.min(25, Math.floor(data.netWorth / 10_000));
  score += Math.min(25, data.emergencyFundMonths * 4);
  if (data.netWorth !== null && data.netWorth > 0) {
    const debtRatio = data.totalDebt / (data.netWorth + data.totalDebt);
    score += Math.floor((1 - debtRatio) * 25);
  } else if (data.totalDebt === 0) {
    score += 25;
  }
  if (data.hasAccounts) score += 8;
  if (data.hasProfile) score += 7;
  if (data.savingsRate !== null && data.savingsRate > 0)
    score += Math.min(10, Math.floor(data.savingsRate * 50));
  score = Math.min(100, Math.round(score));

  if (score >= 80) return { score, grade: 'Excellent', color: 'var(--lf-pos)' };
  if (score >= 65) return { score, grade: 'Good', color: 'var(--lf-cheese)' };
  if (score >= 50) return { score, grade: 'Fair', color: 'var(--lf-noodle)' };
  return { score, grade: 'Needs Work', color: 'var(--lf-sauce)' };
}

// ── interfaces ─────────────────────────────────────────────────────────────

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

interface Insight {
  id: string;
  category: string;
  urgency: string;
  type: string | null;
  title: string;
  description: string;
  impact: string | null;
  chatPrompt: string | null;
  dismissedAt: string | null;
  actedOnAt: string | null;
}

interface DebtAccount {
  id: string;
  name: string;
  balance: number;
  type: 'credit' | 'loan';
  subtype: string | null;
  apr: number;
  minPayment: number;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { tenant } = useAuth();
  const { setPageContext } = usePageContext();
  const [, navigate] = useLocation();

  const [loading, setLoading] = useState(true);
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [netWorthChange, setNetWorthChange] = useState<number | null>(null);
  const [nwHistory, setNwHistory] = useState<Array<{ date: string; value: number }>>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalLiabilities, setTotalLiabilities] = useState(0);
  const [emergencyFund, setEmergencyFund] = useState(0);
  const [runwayMonths, setRunwayMonths] = useState<number | null>(null);
  const [spendingCategories, setSpendingCategories] = useState<Array<{ category: string; total: number; count: number; percentage: number }>>([]);
  const [totalSpending, setTotalSpending] = useState(0);
  const [totalIncome, setTotalIncome] = useState(0);
  const [healthScore, setHealthScore] = useState<{ score: number; grade: string; color: string } | null>(null);
  const [setupSteps, setSetupSteps] = useState<SetupStep[]>([]);
  const [goals, setGoals] = useState<Array<{ id: string; name: string; targetAmount: string; currentAmount: string; deadline: string | null; category: string; status: string; icon: string | null }>>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [prioritySteps, setPrioritySteps] = useState<PriorityStep[]>([]);
  const [prioritySummary, setPrioritySummary] = useState<PrioritySummary | null>(null);
  const [debts, setDebts] = useState<DebtAccount[]>([]);
  const [hasPlaidAccounts, setHasPlaidAccounts] = useState(true);
  const [accountCount, setAccountCount] = useState(0);
  const [lastActionsGeneratedAt, setLastActionsGeneratedAt] = useState<Date | null>(null);

  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] as BalanceEntry[] })),
      api.getItems().catch(() => ({ items: [] as Array<{ id: string; institutionId: string | null }> })),
      api.getDebts().catch(() => ({ debts: [] as Array<{ id: string; name: string; type: string; subtype: string | null; balance: number; interestRate: number | null; minimumPayment: number }>, totalDebt: 0, monthlyInterest: 0 })),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getGoals().catch(() => ({ goals: [] })),
      api.getInsights().catch(() => ({ insights: [], lastActionsGeneratedAt: null as string | null })),
      api.getPriorities().catch(() => ({ steps: [], currentStepId: '', summary: {} })),
      api.getNetWorthHistory().catch(() => ({ history: [] as Array<{ date: string; value: number }> })),
      api.getSpendingSummary().catch(() => ({ categories: [] as Array<{ category: string; total: number; count: number; percentage: number }>, totalSpending: 0, totalIncome: 0, netCashFlow: 0, period: { start: '', end: '' } })),
    ]).then(([balanceData, itemData, debtData, profileData, goalsData, insightsData, prioritiesData, historyData, spendingData]) => {
      const balances = balanceData.balances;
      let assets = 0, liabilities = 0, depository = 0, creditTotal = 0;

      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        if (b.type === 'credit' || b.type === 'loan') {
          liabilities += Math.abs(val);
          if (b.type === 'credit') creditTotal += Math.abs(val);
        } else {
          assets += val;
          if (b.type === 'depository') depository += val;
        }
      }

      setTotalAssets(assets);
      setTotalLiabilities(liabilities);
      if (balances.length > 0) setNetWorth(assets - liabilities);
      setEmergencyFund(depository);
      setAccountCount(balances.length);

      // Net worth history
      const nwHist = historyData.history || [];
      setNwHistory(nwHist);
      if (nwHist.length >= 2) {
        setNetWorthChange(nwHist[nwHist.length - 1].value - nwHist[nwHist.length - 2].value);
      }

      const realPlaidItems = itemData.items.filter(item => item.institutionId && item.institutionId !== 'manual');
      setHasPlaidAccounts(realPlaidItems.length > 0);

      const profile = profileData.financialProfile;
      const profileExists = profile !== null && profile !== undefined;
      const hasProfile = profileExists && profile.annualIncome !== null;

      // Spending
      const spendCats = spendingData.categories.filter((c: { category: string }) => c.category !== 'income' && c.category !== 'transfer');
      setSpendingCategories(spendCats);
      setTotalSpending(spendingData.totalSpending);
      setTotalIncome(spendingData.totalIncome);

      // Runway months
      if (depository > 0 && spendingData.totalSpending > 0) {
        setRunwayMonths(depository / spendingData.totalSpending);
      }

      setGoals(goalsData.goals);

      const hasLinked = itemData.items.length > 0;
      setSetupSteps([
        { id: 'link-account', label: 'Link a bank account', description: 'Connect your bank to see balances and transactions', completed: hasLinked, action: '/accounts' },
        { id: 'set-income', label: 'Set annual income', description: 'Help us understand your earnings', completed: profileExists && profile.annualIncome !== null, action: '/profile' },
        { id: 'set-filing-status', label: 'Set filing status', description: 'Used for tax optimization recommendations', completed: profileExists && profile.filingStatus !== null, action: '/profile' },
        { id: 'set-risk-tolerance', label: 'Set risk tolerance', description: 'Tailor investment recommendations to your comfort', completed: profileExists && profile.riskTolerance !== null, action: '/profile' },
        { id: 'set-employer-match', label: 'Set employer match', description: 'Maximize your 401(k) contributions', completed: profileExists && profile.employerMatchPercent !== null, action: '/profile' },
        { id: 'create-goal', label: 'Create a financial goal', description: 'Set a target to work toward', completed: goalsData.goals.length > 0, action: '/goals' },
      ]);

      setInsights((insightsData.insights || []) as Insight[]);
      setLastActionsGeneratedAt(
        insightsData.lastActionsGeneratedAt ? new Date(insightsData.lastActionsGeneratedAt) : null
      );

      // Priority steps from backend
      const apiSteps = (prioritiesData.steps || []) as PriorityStep[];
      const apiSummary = prioritiesData.summary as PrioritySummary | null;
      setPrioritySteps(apiSteps);
      setPrioritySummary(apiSummary);

      // Debts mapping
      const apiDebts = debtData.debts || [];
      const mappedDebts: DebtAccount[] = apiDebts.map((d) => {
        const apr = d.interestRate ?? (d.type === 'credit' ? 21.99 : 8.0);
        return {
          id: d.id,
          name: d.name,
          balance: d.balance,
          type: (d.type === 'credit' ? 'credit' : 'loan') as 'credit' | 'loan',
          subtype: d.subtype ?? null,
          apr: Math.round(apr * 100) / 100,
          minPayment: d.minimumPayment,
        };
      });
      setDebts(mappedDebts);

      // Health score
      const emergencyMonths = creditTotal > 0 ? depository / creditTotal : (depository > 0 ? 12 : 0);
      const savingsRate = spendingData.totalIncome > 0 ? (spendingData.totalIncome - spendingData.totalSpending) / spendingData.totalIncome : null;
      setHealthScore(calcHealthScore({
        netWorth: assets - liabilities,
        totalDebt: liabilities,
        emergencyFundMonths: emergencyMonths,
        hasProfile: profileExists && profile.annualIncome !== null,
        hasAccounts: itemData.items.length > 0,
        savingsRate,
      }));
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loading) {
      setPageContext({
        pageId: 'dashboard',
        pageTitle: 'Home',
        description: 'Your current financial layer and highest-impact next move.',
      });
    }
  }, [loading, setPageContext]);

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'there' : (rawName.split(' ')[0] || 'there');
  const completedSteps = setupSteps.filter(s => s.completed).length;
  const allSetupComplete = completedSteps === setupSteps.length;

  // Build data for LayerHomeScreen
  const { layerSteps, layerSummary, layerInsights, layerDebts } = useMemo(() => {
    const hasRealData = prioritySteps.length > 0 && prioritySummary !== null;

    if (hasRealData) {
      // Convert real insights to mock format for display
      const realInsightsAsMock: MockInsight[] = insights
        .filter(i => !i.dismissedAt)
        .sort((a, b) => {
          const urgRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
          return (urgRank[a.urgency] ?? 4) - (urgRank[b.urgency] ?? 4);
        })
        .slice(0, 5)
        .map((i, idx) => ({
          id: i.id,
          layerId: i.type || 'general',
          urgency: (i.urgency as 'critical' | 'high' | 'medium' | 'low') || 'medium',
          title: i.title,
          description: i.description,
          impact: i.impact || '',
          actionText: i.title,
        }));

      return {
        layerSteps: prioritySteps,
        layerSummary: prioritySummary!,
        layerInsights: realInsightsAsMock,
        layerDebts: debts,
      };
    }

    // Only show mock data in demo mode
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      const persona = getDefaultMockPersona();
      return {
        layerSteps: persona.steps,
        layerSummary: persona.summary,
        layerInsights: persona.insights,
        layerDebts: persona.debts,
      };
    }

    // Non-demo fallback: empty state
    const emptySummary: PrioritySummary = {
      monthlyIncome: 0,
      monthlyExpenses: null,
      monthlySurplus: null,
      totalCash: 0,
      totalInvested: 0,
      totalHighInterestDebt: 0,
      totalMediumInterestDebt: 0,
      age: null,
      retirementAge: 0,
      filingStatus: null,
    };

    return {
      layerSteps: [],
      layerSummary: emptySummary,
      layerInsights: [],
      layerDebts: [],
    };
  }, [prioritySteps, prioritySummary, insights, debts]);

  if (loading) return null;

  return (
    <div>
      {/* Setup progress — only if incomplete */}
      {!allSetupComplete && (
        <div style={{ padding: '24px clamp(16px, 4vw, 40px) 0', maxWidth: 1200, margin: '0 auto' }}>
          <SetupProgress steps={setupSteps} />
        </div>
      )}

      {/* Link accounts nudge */}
      {!hasPlaidAccounts && accountCount > 0 && (
        <div style={{
          padding: '0 clamp(16px, 4vw, 40px)',
          maxWidth: 1200,
          margin: '0 auto',
        }}>
          <div style={{
            marginBottom: 20, background: 'rgba(201,84,58,0.06)',
            border: '1px solid rgba(201,84,58,0.2)', borderRadius: 14,
            padding: '14px 20px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 16,
          }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>Link your bank for automatic updates</div>
              <div style={{ color: 'var(--lf-muted)', fontSize: 13, marginTop: 2 }}>Your balances are manual snapshots. Connect via Plaid for real-time tracking.</div>
            </div>
            <button
              onClick={() => navigate('/accounts')}
              style={{ padding: '8px 16px', background: 'var(--lf-sauce)', color: 'var(--lf-paper)', border: 0, borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Link Account
            </button>
          </div>
        </div>
      )}

      {/* Phase 1: Layer Home Screen */}
      <LayerHomeScreen
        steps={layerSteps}
        summary={layerSummary}
        insights={layerInsights}
        debts={layerDebts}
        netWorth={netWorth}
        netWorthChange={netWorthChange}
        netWorthHistory={nwHistory}
        totalAssets={totalAssets}
        totalLiabilities={totalLiabilities}
        healthScore={healthScore}
        spendingCategories={spendingCategories}
        totalSpending={totalSpending}
        totalIncome={totalIncome}
        lastActionsGeneratedAt={lastActionsGeneratedAt}
        greeting={`Good ${getGreeting()}, ${firstName}`}
        onNavigate={(path) => navigate(path)}
      />
    </div>
  );
}
